-- ============================================================
-- TEMPLATES PRONTOS + AUTOMAÇÕES DE REATIVAÇÃO
--
-- Idempotente. Rode no SQL Editor do Supabase.
-- ============================================================


-- ============================================================
-- 1. AJUSTES EM message_templates
--
-- A tabela já existe. Faltam campos para o modelo "pronto para
-- usar": um template global precisa ser identificável, ordenável
-- e clonável pelo tenant sem perder o vínculo com a origem.
-- ============================================================

ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS slug          TEXT;
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS description   TEXT;
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS sort_order    INT NOT NULL DEFAULT 100;
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS source_slug   TEXT;
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS enabled       BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN message_templates.slug IS
  'Identificador estavel do template global. Permite atualizar o texto
   padrao sem duplicar registro e sem quebrar quem ja clonou.';

COMMENT ON COLUMN message_templates.source_slug IS
  'Quando o tenant clona um template global, guarda a origem. E assim
   que sabemos se ele personalizou o texto ou ainda usa o padrao.';

COMMENT ON COLUMN message_templates.enabled IS
  'Diferente de "active". Um template pode existir e estar correto
   sem que o tenant queira usa-lo. Habilitar e uma decisao dele.';

-- Um slug global e unico; slug de tenant e unico dentro do tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_slug_global
  ON message_templates(slug) WHERE tenant_id IS NULL AND slug IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_slug_tenant
  ON message_templates(tenant_id, slug) WHERE tenant_id IS NOT NULL AND slug IS NOT NULL;


-- ============================================================
-- 2. BIBLIOTECA DE TEMPLATES PRONTOS
--
-- Estes sao globais (tenant_id NULL). O tenant ve todos, habilita
-- os que quiser, e so vira copia propria quando ele edita o texto.
--
-- Sobre a redacao: mensagem de estetica automotiva no WhatsApp
-- concorre com a atencao de alguem no transito, no trabalho, com
-- o filho no colo. Por isso: primeira linha resolve, emoji marca
-- o assunto sem enfeitar, e sempre existe uma acao clara. Texto
-- longo nao e mais educado, e mais ignorado.
-- ============================================================

INSERT INTO message_templates
  (tenant_id, slug, name, description, category, content, variables, is_global, active, enabled, sort_order)
VALUES

-- ── Operacionais: acompanham o servico ──────────────────────
(NULL, 'confirmacao_agendamento',
 'Confirmação de agendamento',
 'Enviada assim que o cliente agenda. Reduz falta porque cria compromisso.',
 'confirmacao',
 E'✅ *Agendamento confirmado!*\n\nOlá, *{nome}*! Seu horário na *{empresa}* está reservado.\n\n🚗 {veiculo}\n🧼 {servico}\n📅 {data} às {hora}\n\nQualquer imprevisto, é só responder esta mensagem.\n\nAté lá! 👋',
 ARRAY['nome','empresa','veiculo','servico','data','hora'], true, true, true, 10),

(NULL, 'lembrete_24h',
 'Lembrete 24h antes',
 'O maior redutor de falta que existe. Cliente esquece, não desiste.',
 'lembrete',
 E'⏰ *Lembrete do seu horário*\n\nOi, *{nome}*! Passando para lembrar do seu atendimento amanhã.\n\n📅 {data} às {hora}\n🚗 {veiculo}\n🧼 {servico}\n\nConfirma que está tudo certo? Se precisar remarcar, é só avisar. 😉',
 ARRAY['nome','data','hora','veiculo','servico'], true, true, true, 20),

(NULL, 'veiculo_pronto',
 'Veículo pronto para retirada',
 'Fecha o ciclo do serviço e antecipa a retirada.',
 'operacional',
 E'🎉 *Seu carro está pronto!*\n\n*{nome}*, o {veiculo} ficou um brinco! ✨\n\nPode passar para retirar quando quiser.\n\n📍 {empresa}\n\nQualquer dúvida, estamos aqui!',
 ARRAY['nome','veiculo','empresa'], true, true, true, 30),

(NULL, 'pos_atendimento',
 'Agradecimento pós-atendimento',
 'Enviada 1 dia depois. Momento certo para pedir indicação.',
 'pos_venda',
 E'Obrigado pela confiança, *{nome}*! 🙏\n\nEsperamos que tenha gostado do resultado no {veiculo}.\n\nSe puder, conta pra gente como foi — e se conhecer alguém que precisa, é só indicar. 😊\n\n*{empresa}*',
 ARRAY['nome','veiculo','empresa'], true, true, false, 40),

-- ── Reativacao: onde o dinheiro esta ────────────────────────
-- Tres estagios, com tons diferentes de proposito. Mandar a mesma
-- mensagem tres vezes treina o cliente a ignorar; mandar a mesma
-- oferta tres vezes treina ele a esperar o desconto.

(NULL, 'reativacao_30d',
 'Sentimos sua falta — 30 dias',
 'Primeiro toque. Sem desconto: quem sumiu há 30 dias não precisa de oferta, precisa de lembrança.',
 'reativacao',
 E'Oi, *{nome}*! Tudo bem? 😊\n\nFaz um tempinho que o {veiculo} não passa por aqui. A gente sabe que a rotina corre, mas seu carro merece aquele cuidado.\n\nQuer agendar? É rapidinho:\n{link}\n\n*{empresa}*',
 ARRAY['nome','veiculo','link','empresa'], true, true, true, 50),

(NULL, 'reativacao_60d',
 'Oferta de retorno — 60 dias',
 'Segundo toque, agora com incentivo. Aqui o desconto tem função: vencer a inércia.',
 'reativacao',
 E'*{nome}*, preparamos algo para você! 🎁\n\nO {veiculo} está há um tempo sem passar aqui, e queremos você de volta.\n\n💧 *{desconto}% de desconto* no seu próximo serviço\nVálido até {validade}\n\nAgende aqui:\n{link}\n\n*{empresa}*',
 ARRAY['nome','veiculo','desconto','validade','link','empresa'], true, true, false, 60),

(NULL, 'reativacao_90d',
 'Último contato — 90 dias',
 'Terceiro e último. Honesto sobre ser o último — respeitar o silêncio protege sua reputação e seu número.',
 'reativacao',
 E'Oi, *{nome}*.\n\nEste é nosso último contato para não te incomodar. 🙂\n\nSe um dia o {veiculo} precisar, a porta está aberta — e a gente lembra do seu carro.\n\nAgende quando quiser:\n{link}\n\nUm abraço,\n*{empresa}*',
 ARRAY['nome','veiculo','link','empresa'], true, true, false, 70),

-- ── Relacionamento ──────────────────────────────────────────
(NULL, 'aniversario',
 'Aniversário do cliente',
 'Alta taxa de resposta. Ninguém ignora parabéns.',
 'aniversario',
 E'🎂 *Feliz aniversário, {nome}!*\n\nQue seu dia seja tão brilhante quanto seu {veiculo} saindo daqui! ✨\n\nPreparamos um mimo: *{desconto}% de desconto* para usar este mês.\n\nAgende:\n{link}\n\n*{empresa}*',
 ARRAY['nome','veiculo','desconto','link','empresa'], true, true, false, 80),

(NULL, 'assinatura_sessoes',
 'Assinatura com sessões sobrando',
 'Cliente que não usa o que pagou cancela. Este template protege sua receita recorrente.',
 'assinatura',
 E'Oi, *{nome}*! 👋\n\nVocê ainda tem *{sessoes} sessões* disponíveis no seu plano {plano} este mês.\n\nO ciclo renova em {renovacao} — que tal aproveitar?\n\nAgende:\n{link}\n\n*{empresa}*',
 ARRAY['nome','sessoes','plano','renovacao','link','empresa'], true, true, false, 90),

(NULL, 'promocao_ociosidade',
 'Promoção para horário vago',
 'Transforma agenda vazia em receita. Custo marginal quase zero.',
 'promocao',
 E'⚡ *Vaga de última hora!*\n\n*{nome}*, abriu um horário {data} às {hora}.\n\nCom *{desconto}% de desconto* para quem confirmar hoje.\n\nQuer? Responde aqui que já reservo. 🚗💨\n\n*{empresa}*',
 ARRAY['nome','data','hora','desconto','empresa'], true, true, false, 100)

ON CONFLICT (slug) WHERE tenant_id IS NULL DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  category    = EXCLUDED.category,
  content     = EXCLUDED.content,
  variables   = EXCLUDED.variables,
  sort_order  = EXCLUDED.sort_order,
  updated_at  = now();
  -- Repare: NAO sobrescrevemos `enabled`. Se o tenant desligou um
  -- template, uma atualizacao nossa do texto padrao nao pode
  -- religa-lo pelas costas dele.


-- ============================================================
-- 3. AUTOMAÇÕES DE CAMPANHA
--
-- O tenant configura uma vez e esquece. Esse é o ponto: ele não
-- vai lembrar de rodar campanha toda semana — se depender disso,
-- não acontece.
-- ============================================================

CREATE TABLE IF NOT EXISTS campaign_automations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name             TEXT NOT NULL,
  trigger_type     TEXT NOT NULL DEFAULT 'inactivity',
                   -- inactivity | birthday | subscription_idle | post_service
  template_id      UUID REFERENCES message_templates(id) ON DELETE SET NULL,
  template_slug    TEXT,

  -- Gatilho de inatividade
  inactive_days    INT NOT NULL DEFAULT 45,

  -- Não reenviar para o mesmo cliente antes disso.
  -- Sem esta trava, um cliente inativo há 200 dias receberia a
  -- mensagem TODA execução do job. É o caminho mais rápido para
  -- ser bloqueado no WhatsApp e queimar o número da estética.
  cooldown_days    INT NOT NULL DEFAULT 30,

  -- Janela de envio. Mensagem comercial às 23h não converte,
  -- irrita — e irritação vira denúncia, que vira número banido.
  send_hour_start  INT NOT NULL DEFAULT 9,
  send_hour_end    INT NOT NULL DEFAULT 19,
  send_weekdays    INT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6],  -- 0=dom

  -- Teto diário: protege contra o disparo em massa acidental
  -- (ex.: base de 3.000 clientes importada de uma vez).
  daily_limit      INT NOT NULL DEFAULT 50,

  discount_pct     NUMERIC(5,2),
  is_active        BOOLEAN NOT NULL DEFAULT FALSE,

  last_run_at      TIMESTAMPTZ,
  next_run_at      TIMESTAMPTZ,
  total_sent       INT NOT NULL DEFAULT 0,
  total_returned   INT NOT NULL DEFAULT 0,   -- clientes que voltaram após receber

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automations_tenant ON campaign_automations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_automations_active ON campaign_automations(is_active) WHERE is_active;

ALTER TABLE campaign_automations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_own_automations" ON campaign_automations;
CREATE POLICY "tenant_own_automations" ON campaign_automations
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );


-- ============================================================
-- 4. REGISTRO DE ENVIOS DA AUTOMAÇÃO
--
-- Existe para responder duas perguntas:
--   "já mandei para este cliente?" (cooldown)
--   "isso trouxe alguém de volta?" (ROI)
--
-- A segunda é a que justifica a mensalidade da estética.
-- ============================================================

CREATE TABLE IF NOT EXISTS automation_sends (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id  UUID NOT NULL REFERENCES campaign_automations(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  phone          TEXT,
  content        TEXT,
  status         TEXT NOT NULL DEFAULT 'sent',   -- sent | failed | skipped
  error          TEXT,

  -- Preenchido quando o cliente agenda depois de receber.
  -- É a métrica que transforma "mandei 200 mensagens" em
  -- "recuperei R$ 4.800".
  returned_at    TIMESTAMPTZ,
  order_id       UUID REFERENCES service_orders(id) ON DELETE SET NULL,

  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sends_automation ON automation_sends(automation_id);
CREATE INDEX IF NOT EXISTS idx_sends_customer   ON automation_sends(customer_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sends_tenant     ON automation_sends(tenant_id, sent_at DESC);

ALTER TABLE automation_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_own_sends" ON automation_sends;
CREATE POLICY "tenant_own_sends" ON automation_sends
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );


-- ============================================================
-- 5. QUEM ESTÁ ELEGÍVEL PARA RECEBER
--
-- Toda a regra de negócio da campanha mora aqui, no banco, e não
-- na Edge Function. Motivo: assim ela é testável com um SELECT.
-- Você consegue ver a lista exata de quem receberia ANTES de
-- disparar — e o dono da estética também.
-- ============================================================

CREATE OR REPLACE FUNCTION get_automation_targets(p_automation_id UUID)
RETURNS TABLE (
  customer_id    UUID,
  customer_name  TEXT,
  phone          TEXT,
  last_visit     TIMESTAMPTZ,
  days_inactive  INT,
  vehicle_desc   TEXT,
  ticket_medio   NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a campaign_automations%ROWTYPE;
BEGIN
  SELECT * INTO a FROM campaign_automations WHERE id = p_automation_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  WITH ultima_visita AS (
    SELECT so.customer_id AS cid,
           MAX(so.start_time) AS last_at,
           AVG(NULLIF(so.total_amount, 0)) AS ticket
    FROM service_orders so
    WHERE so.tenant_id = a.tenant_id
      AND so.status NOT IN ('cancelled','no_show')
    GROUP BY so.customer_id
  ),
  ultimo_envio AS (
    SELECT s.customer_id AS cid, MAX(s.sent_at) AS sent_at
    FROM automation_sends s
    WHERE s.automation_id = p_automation_id
    GROUP BY s.customer_id
  )
  SELECT
    c.id,
    c.name,
    c.phone,
    uv.last_at,
    EXTRACT(DAY FROM now() - uv.last_at)::INT,
    COALESCE(
      (SELECT v.brand || ' ' || COALESCE(v.model,'')
       FROM vehicles v WHERE v.customer_id = c.id
       ORDER BY v.created_at LIMIT 1),
      'seu veículo'
    ),
    ROUND(COALESCE(uv.ticket, 0), 2)
  FROM customers c
  JOIN ultima_visita uv ON uv.cid = c.id
  LEFT JOIN ultimo_envio ue ON ue.cid = c.id
  WHERE c.tenant_id = a.tenant_id
    -- Sem telefone não há o que fazer
    AND c.phone IS NOT NULL
    AND length(regexp_replace(c.phone, '\D', '', 'g')) >= 10
    -- Passou do período de inatividade configurado
    AND uv.last_at < now() - (a.inactive_days || ' days')::INTERVAL
    -- Respeita o cooldown: ou nunca recebeu, ou já passou o prazo
    AND (ue.sent_at IS NULL OR ue.sent_at < now() - (a.cooldown_days || ' days')::INTERVAL)
    -- Não incomoda quem já tem horário marcado
    AND NOT EXISTS (
      SELECT 1 FROM service_orders f
      WHERE f.customer_id = c.id
        AND f.start_time > now()
        AND f.status IN ('pending','confirmed')
    )
  -- Quem gasta mais primeiro: se o limite diário cortar a lista,
  -- que corte pelo fim, não pelo começo.
  ORDER BY COALESCE(uv.ticket, 0) DESC, uv.last_at ASC
  LIMIT a.daily_limit;
END;
$$;


-- ============================================================
-- 6. RECEITA EM RISCO E RETORNO DA AUTOMAÇÃO
-- ============================================================

CREATE OR REPLACE VIEW automation_performance AS
SELECT
  a.id                AS automation_id,
  a.tenant_id,
  a.name,
  a.is_active,
  a.inactive_days,
  a.last_run_at,
  COUNT(s.id)                                        AS enviados,
  COUNT(s.returned_at)                               AS retornaram,
  CASE WHEN COUNT(s.id) > 0
       THEN ROUND(COUNT(s.returned_at)::NUMERIC / COUNT(s.id) * 100, 1)
       ELSE 0 END                                    AS taxa_retorno_pct,
  COALESCE(SUM(o.total_amount), 0)                   AS receita_recuperada
FROM campaign_automations a
LEFT JOIN automation_sends s   ON s.automation_id = a.id
LEFT JOIN service_orders  o    ON o.id = s.order_id
GROUP BY a.id, a.tenant_id, a.name, a.is_active, a.inactive_days, a.last_run_at;


-- ============================================================
-- 7. MARCA O RETORNO AUTOMATICAMENTE
--
-- Quando um cliente que recebeu a mensagem cria um agendamento
-- dentro de 30 dias, o trigger amarra a OS ao envio. Sem isso, a
-- atribuição dependeria de alguém marcar na mão — ou seja, não
-- aconteceria, e a estética nunca veria o retorno do que paga.
-- ============================================================

CREATE OR REPLACE FUNCTION mark_automation_return()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE automation_sends s
  SET returned_at = now(),
      order_id    = NEW.id
  WHERE s.customer_id = NEW.customer_id
    AND s.returned_at IS NULL
    AND s.status = 'sent'
    AND s.sent_at > now() - INTERVAL '30 days';

  UPDATE campaign_automations a
  SET total_returned = total_returned + 1
  WHERE a.id IN (
    SELECT s.automation_id FROM automation_sends s
    WHERE s.order_id = NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_automation_return ON service_orders;
CREATE TRIGGER trg_automation_return
  AFTER INSERT ON service_orders
  FOR EACH ROW
  EXECUTE FUNCTION mark_automation_return();


-- ============================================================
-- 8. AUTOMAÇÃO PADRÃO PARA QUEM JÁ EXISTE
--
-- Criada DESLIGADA de propósito. Disparar mensagem para a base
-- de alguém sem que essa pessoa tenha pedido é o tipo de
-- "ajuda" que gera reclamação no WhatsApp e desconfiança no
-- produto. Ela aparece pronta, com um botão para ligar.
-- ============================================================

INSERT INTO campaign_automations
  (tenant_id, name, trigger_type, template_slug, inactive_days,
   cooldown_days, discount_pct, is_active, daily_limit)
SELECT
  t.id,
  'Reativar clientes inativos',
  'inactivity',
  'reativacao_30d',
  45, 30, NULL, FALSE, 50
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM campaign_automations a
  WHERE a.tenant_id = t.id AND a.trigger_type = 'inactivity'
);
