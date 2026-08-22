-- ============================================================
-- ASSINATURAS DE CLIENTES FINAIS
--
-- O terceiro fluxo de dinheiro do produto:
--
--   1. Estética → Plataforma    (SaaS, 100% seu)
--   2. Cliente  → Estética      (agendamento avulso, % seu)
--   3. Cliente  → Estética      (assinatura recorrente, % seu)  ← AQUI
--
-- A diferença crítica entre 2 e 3: uma assinatura não é um
-- pagamento caro, é um SALDO. O cliente paga R$ 200/mês e tem
-- direito a 4 lavagens. Sem controlar quantas ele já usou, a
-- estética não sabe se está tendo lucro ou prejuízo naquele
-- contrato.
--
-- Rode no Supabase SQL Editor. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  plan_id       uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  vehicle_id    uuid REFERENCES vehicles(id) ON DELETE SET NULL,

  -- Estado do contrato
  status        text NOT NULL DEFAULT 'pending',
  -- pending | active | past_due | paused | cancelled | expired

  -- Valores congelados no momento da contratação.
  -- Se a estética reajustar o plano depois, quem já assinou
  -- continua no preço antigo — mesma lógica do Stripe.
  price         numeric(10,2) NOT NULL,
  interval      text NOT NULL DEFAULT 'monthly',
  sessions_total integer,                    -- NULL = ilimitado

  -- Controle do ciclo atual
  sessions_used  integer NOT NULL DEFAULT 0,
  cycle_start    timestamptz,
  cycle_end      timestamptz,

  -- Stripe
  stripe_subscription_id text,
  stripe_customer_id     text,
  stripe_session_id      text,

  -- Comissão da plataforma vigente neste contrato
  commission_pct numeric(5,2),

  -- Ciclo de vida
  started_at    timestamptz,
  cancelled_at  timestamptz,
  cancel_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_subscriptions DROP CONSTRAINT IF EXISTS customer_subscriptions_status_check;
ALTER TABLE customer_subscriptions ADD CONSTRAINT customer_subscriptions_status_check
  CHECK (status IN ('pending','active','past_due','paused','cancelled','expired'));

CREATE INDEX IF NOT EXISTS idx_cust_subs_tenant   ON customer_subscriptions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_cust_subs_customer ON customer_subscriptions(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_cust_subs_stripe   ON customer_subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_cust_subs_cycle    ON customer_subscriptions(cycle_end) WHERE status = 'active';

ALTER TABLE customer_subscriptions ENABLE ROW LEVEL SECURITY;

-- A estética vê as assinaturas dela
DROP POLICY IF EXISTS "tenant_own_customer_subs" ON customer_subscriptions;
CREATE POLICY "tenant_own_customer_subs" ON customer_subscriptions
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    OR (SELECT is_super_admin FROM profiles WHERE id = auth.uid()) = true
  );

-- A agenda pública precisa consultar se o cliente tem assinatura ativa
DROP POLICY IF EXISTS "public_read_active_subs" ON customer_subscriptions;
CREATE POLICY "public_read_active_subs" ON customer_subscriptions
  FOR SELECT TO anon
  USING (status = 'active');

-- ── Histórico de uso das sessões ───────────────────────────
-- Auditoria: quando o cliente diz "eu não usei 4 vezes", há prova.

CREATE TABLE IF NOT EXISTS subscription_usage (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  service_order_id uuid REFERENCES service_orders(id) ON DELETE SET NULL,
  cycle_start     timestamptz,
  used_at         timestamptz NOT NULL DEFAULT now(),
  note            text
);

CREATE INDEX IF NOT EXISTS idx_sub_usage_subscription
  ON subscription_usage(subscription_id, used_at DESC);

ALTER TABLE subscription_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_own_sub_usage" ON subscription_usage;
CREATE POLICY "tenant_own_sub_usage" ON subscription_usage
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    OR (SELECT is_super_admin FROM profiles WHERE id = auth.uid()) = true
  );

DROP POLICY IF EXISTS "public_insert_sub_usage" ON subscription_usage;
CREATE POLICY "public_insert_sub_usage" ON subscription_usage
  FOR INSERT TO anon WITH CHECK (true);

-- ── Vínculo na ordem de serviço ────────────────────────────

ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS customer_subscription_id UUID
  REFERENCES customer_subscriptions(id) ON DELETE SET NULL;

-- Marca se a OS foi paga com crédito de assinatura
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS covered_by_subscription BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Stripe Price por plano de assinatura ───────────────────
-- Cada combo criado pela estética vira um Price na conta Connect dela.

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS stripe_product_id TEXT;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS active_subscribers INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- FUNÇÕES DE NEGÓCIO
-- ============================================================

-- ── Quantas sessões restam no ciclo atual ──────────────────
CREATE OR REPLACE FUNCTION subscription_remaining(p_subscription_id uuid)
RETURNS integer AS $$
DECLARE
  v_total integer;
  v_used  integer;
BEGIN
  SELECT sessions_total, sessions_used INTO v_total, v_used
    FROM customer_subscriptions WHERE id = p_subscription_id;

  IF v_total IS NULL THEN
    RETURN 9999;   -- ilimitado
  END IF;

  RETURN GREATEST(0, v_total - COALESCE(v_used, 0));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ── Consome uma sessão ─────────────────────────────────────
-- Retorna TRUE se conseguiu consumir, FALSE se o saldo acabou.
CREATE OR REPLACE FUNCTION consume_subscription_session(
  p_subscription_id uuid,
  p_order_id        uuid DEFAULT NULL
) RETURNS boolean AS $$
DECLARE
  v_sub    customer_subscriptions%ROWTYPE;
  v_remain integer;
BEGIN
  SELECT * INTO v_sub FROM customer_subscriptions
   WHERE id = p_subscription_id FOR UPDATE;   -- trava a linha

  IF NOT FOUND OR v_sub.status <> 'active' THEN
    RETURN FALSE;
  END IF;

  -- Ciclo vencido? Zera o contador antes de consumir.
  IF v_sub.cycle_end IS NOT NULL AND v_sub.cycle_end < now() THEN
    UPDATE customer_subscriptions
       SET sessions_used = 0,
           cycle_start = now(),
           cycle_end = now() + CASE interval
             WHEN 'monthly'   THEN INTERVAL '1 month'
             WHEN 'quarterly' THEN INTERVAL '3 months'
             WHEN 'yearly'    THEN INTERVAL '1 year'
             ELSE INTERVAL '1 month'
           END
     WHERE id = p_subscription_id;
    v_sub.sessions_used := 0;
  END IF;

  IF v_sub.sessions_total IS NOT NULL
     AND COALESCE(v_sub.sessions_used, 0) >= v_sub.sessions_total THEN
    RETURN FALSE;   -- saldo esgotado neste ciclo
  END IF;

  UPDATE customer_subscriptions
     SET sessions_used = COALESCE(sessions_used, 0) + 1,
         updated_at = now()
   WHERE id = p_subscription_id;

  INSERT INTO subscription_usage (subscription_id, tenant_id, service_order_id, cycle_start)
  VALUES (p_subscription_id, v_sub.tenant_id, p_order_id, v_sub.cycle_start);

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Assinatura ativa de um cliente ─────────────────────────
-- Usada pela agenda pública logo após a identificação por CPF.
CREATE OR REPLACE FUNCTION get_active_subscription(
  p_tenant_id   uuid,
  p_customer_id uuid
) RETURNS TABLE (
  id             uuid,
  plan_id        uuid,
  plan_name      text,
  sessions_total integer,
  sessions_used  integer,
  remaining      integer,
  cycle_end      timestamptz,
  services       jsonb
) AS $$
  SELECT
    cs.id,
    cs.plan_id,
    sp.name,
    cs.sessions_total,
    cs.sessions_used,
    CASE WHEN cs.sessions_total IS NULL THEN 9999
         ELSE GREATEST(0, cs.sessions_total - COALESCE(cs.sessions_used, 0)) END,
    cs.cycle_end,
    sp.services
  FROM customer_subscriptions cs
  JOIN subscription_plans sp ON sp.id = cs.plan_id
  WHERE cs.tenant_id = p_tenant_id
    AND cs.customer_id = p_customer_id
    AND cs.status = 'active'
  ORDER BY cs.created_at DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ── Contador de assinantes por plano ───────────────────────
CREATE OR REPLACE FUNCTION refresh_plan_subscriber_count() RETURNS trigger AS $$
BEGIN
  UPDATE subscription_plans sp
     SET active_subscribers = (
       SELECT COUNT(*) FROM customer_subscriptions
        WHERE plan_id = sp.id AND status = 'active'
     )
   WHERE sp.id = COALESCE(NEW.plan_id, OLD.plan_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plan_subscriber_count ON customer_subscriptions;
CREATE TRIGGER trg_plan_subscriber_count
  AFTER INSERT OR UPDATE OF status OR DELETE ON customer_subscriptions
  FOR EACH ROW EXECUTE FUNCTION refresh_plan_subscriber_count();

-- ============================================================
-- VISÕES DE NEGÓCIO
-- ============================================================

-- MRR real da estética (só assinaturas ativas, normalizado p/ mês)
CREATE OR REPLACE VIEW tenant_subscription_mrr AS
SELECT
  cs.tenant_id,
  COUNT(*)                                        AS active_subscribers,
  SUM(CASE cs.interval
        WHEN 'monthly'   THEN cs.price
        WHEN 'quarterly' THEN cs.price / 3
        WHEN 'yearly'    THEN cs.price / 12
        ELSE 0
      END)                                        AS mrr,
  SUM(cs.price)                                   AS contracted_value,
  AVG(COALESCE(cs.sessions_used, 0))              AS avg_sessions_used
FROM customer_subscriptions cs
WHERE cs.status = 'active'
GROUP BY cs.tenant_id;

-- Assinantes com detalhe, para o painel da estética
CREATE OR REPLACE VIEW subscriber_details AS
SELECT
  cs.id,
  cs.tenant_id,
  cs.status,
  cs.price,
  cs.interval,
  cs.sessions_total,
  cs.sessions_used,
  CASE WHEN cs.sessions_total IS NULL THEN NULL
       ELSE GREATEST(0, cs.sessions_total - COALESCE(cs.sessions_used, 0)) END AS remaining,
  cs.cycle_start,
  cs.cycle_end,
  cs.started_at,
  cs.cancelled_at,
  c.id     AS customer_id,
  c.name   AS customer_name,
  c.phone  AS customer_phone,
  c.cpf_cnpj,
  sp.id    AS plan_id,
  sp.name  AS plan_name,
  -- Quem paga e não usa é o contrato mais lucrativo,
  -- mas também o de maior risco de cancelamento.
  CASE
    WHEN cs.sessions_total IS NULL THEN NULL
    WHEN COALESCE(cs.sessions_used, 0) = 0 THEN 'nao_usou'
    WHEN COALESCE(cs.sessions_used, 0) >= cs.sessions_total THEN 'esgotou'
    ELSE 'em_uso'
  END AS usage_status
FROM customer_subscriptions cs
JOIN customers c          ON c.id = cs.customer_id
JOIN subscription_plans sp ON sp.id = cs.plan_id;
