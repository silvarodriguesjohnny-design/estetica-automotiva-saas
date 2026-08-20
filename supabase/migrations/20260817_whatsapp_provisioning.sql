-- ============================================================
-- PROVISIONAMENTO AUTOMÁTICO DE WHATSAPP POR TENANT
--
-- Transforma messaging_configs de "registro estático" para uma
-- máquina de estados observável:
--
--   provisioning → qr_pending → connected ⇄ disconnected → expired
--                      ↓
--                    error (com retry)
--
-- Rode este script inteiro no Supabase SQL Editor. É idempotente.
-- ============================================================

-- ── 1. Colunas de estado ───────────────────────────────────

ALTER TABLE messaging_configs ADD COLUMN IF NOT EXISTS api_url TEXT;

-- Estado atual da instância
ALTER TABLE messaging_configs ADD COLUMN IF NOT EXISTS status TEXT
  NOT NULL DEFAULT 'not_provisioned';

-- Número realmente conectado (vem do WhatsApp após o scan do QR)
ALTER TABLE messaging_configs ADD COLUMN IF NOT EXISTS connected_number TEXT;

-- Controle do QR Code (expira em ~60s na Evolution)
ALTER TABLE messaging_configs ADD COLUMN IF NOT EXISTS qr_code TEXT;
ALTER TABLE messaging_configs ADD COLUMN IF NOT EXISTS qr_expires_at TIMESTAMPTZ;

-- Timestamps do ciclo de vida
ALTER TABLE messaging_configs ADD COLUMN IF NOT EXISTS provisioned_at   TIMESTAMPTZ;
ALTER TABLE messaging_configs ADD COLUMN IF NOT EXISTS disconnected_at  TIMESTAMPTZ;
ALTER TABLE messaging_configs ADD COLUMN IF NOT EXISTS last_check_at    TIMESTAMPTZ;

-- Retry com backoff
ALTER TABLE messaging_configs ADD COLUMN IF NOT EXISTS retry_count   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messaging_configs ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
ALTER TABLE messaging_configs ADD COLUMN IF NOT EXISTS last_error    TEXT;

-- Token secreto por tenant — usado para validar o webhook da Evolution.
-- Sem isso qualquer um poderia forjar um CONNECTION_UPDATE.
ALTER TABLE messaging_configs ADD COLUMN IF NOT EXISTS webhook_token TEXT
  DEFAULT encode(gen_random_bytes(24), 'hex');

-- Preenche token nas linhas que já existem
UPDATE messaging_configs
   SET webhook_token = encode(gen_random_bytes(24), 'hex')
 WHERE webhook_token IS NULL;

-- ── 2. Constraint de estados válidos ───────────────────────

ALTER TABLE messaging_configs DROP CONSTRAINT IF EXISTS messaging_configs_status_check;
ALTER TABLE messaging_configs ADD CONSTRAINT messaging_configs_status_check
  CHECK (status IN (
    'not_provisioned',  -- ainda não tem instância
    'provisioning',     -- criando na Evolution
    'qr_pending',       -- aguardando o dono escanear
    'connected',        -- funcionando
    'disconnected',     -- caiu, tentando reconectar
    'expired',          -- desconectado há muito tempo → usa fallback global
    'error'             -- falha no provisionamento
  ));

-- Normaliza registros antigos: quem já estava ativo vira 'connected'
UPDATE messaging_configs
   SET status = CASE
     WHEN is_active = true AND instance_name IS NOT NULL THEN 'connected'
     WHEN instance_name IS NOT NULL                      THEN 'disconnected'
     ELSE 'not_provisioned'
   END
 WHERE status = 'not_provisioned';

-- ── 3. Índices ─────────────────────────────────────────────

-- Um tenant só pode ter uma config
CREATE UNIQUE INDEX IF NOT EXISTS idx_messaging_configs_tenant_unique
  ON messaging_configs(tenant_id);

-- Busca rápida pelo nome da instância (usada pelo webhook)
CREATE INDEX IF NOT EXISTS idx_messaging_configs_instance
  ON messaging_configs(instance_name);

-- Job de saúde varre por status + próxima tentativa
CREATE INDEX IF NOT EXISTS idx_messaging_configs_health
  ON messaging_configs(status, next_retry_at);

-- ── 4. Histórico de eventos ────────────────────────────────
-- Sem isso, quando o dono reclama que "parou de funcionar",
-- não há como saber o que aconteceu.

CREATE TABLE IF NOT EXISTS whatsapp_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  instance    text,
  event_type  text NOT NULL,   -- provisioned | qr_generated | connected | disconnected | error | retry
  from_status text,
  to_status   text,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_events_tenant
  ON whatsapp_events(tenant_id, created_at DESC);

ALTER TABLE whatsapp_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_own_whatsapp_events" ON whatsapp_events;
CREATE POLICY "tenant_own_whatsapp_events" ON whatsapp_events
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    OR (SELECT is_super_admin FROM profiles WHERE id = auth.uid()) = true
  );

-- ── 5. Função de transição de estado ───────────────────────
-- Centraliza a mudança de status + o log do evento, para que
-- nenhuma Edge Function esqueça de registrar o histórico.

CREATE OR REPLACE FUNCTION set_whatsapp_status(
  p_tenant_id  uuid,
  p_status     text,
  p_detail     text DEFAULT NULL,
  p_event_type text DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_from   text;
  v_inst   text;
BEGIN
  SELECT status, instance_name INTO v_from, v_inst
    FROM messaging_configs WHERE tenant_id = p_tenant_id;

  UPDATE messaging_configs
     SET status          = p_status,
         is_active       = (p_status = 'connected'),
         last_check_at   = now(),
         connected_at    = CASE WHEN p_status = 'connected'    THEN now() ELSE connected_at    END,
         disconnected_at = CASE WHEN p_status = 'disconnected' THEN now() ELSE disconnected_at END,
         last_error      = CASE WHEN p_status = 'error' THEN p_detail ELSE NULL END,
         retry_count     = CASE WHEN p_status = 'connected' THEN 0 ELSE retry_count END
   WHERE tenant_id = p_tenant_id;

  INSERT INTO whatsapp_events (tenant_id, instance, event_type, from_status, to_status, detail)
  VALUES (p_tenant_id, v_inst, COALESCE(p_event_type, p_status), v_from, p_status, p_detail);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 6. View de saúde da frota (Super Admin) ────────────────

CREATE OR REPLACE VIEW whatsapp_fleet_health AS
SELECT
  mc.tenant_id,
  t.name              AS tenant_name,
  t.plan_type,
  mc.instance_name,
  mc.status,
  mc.connected_number,
  mc.connected_at,
  mc.disconnected_at,
  mc.retry_count,
  mc.last_error,
  mc.last_check_at,
  CASE
    WHEN mc.status = 'disconnected'
      THEN EXTRACT(EPOCH FROM (now() - COALESCE(mc.disconnected_at, now()))) / 86400
    ELSE 0
  END AS days_disconnected
FROM messaging_configs mc
JOIN tenants t ON t.id = mc.tenant_id;
