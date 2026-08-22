-- ============================================================
-- STRIPE CONNECT — marketplace com comissão de 2%
--
-- MODELO: Destination Charge com application_fee
--
--   Cliente da estética paga R$ 150
--        ↓
--   Stripe processa na SUA plataforma
--        ↓
--   ├─ R$ 147,00 → conta da estética (destination)
--   └─ R$   3,00 → sua conta (application_fee, 2%)
--
-- POR QUE ASSIM: o dinheiro nunca fica retido na sua conta.
-- Você não é o vendedor do serviço, só o intermediário — o que
-- mantém a responsabilidade fiscal com quem prestou o serviço.
--
-- Rode no Supabase SQL Editor. Idempotente.
-- ============================================================

-- ── 1. Campos de Connect no tenant ─────────────────────────

-- ID da conta Express da estética (acct_...)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;

-- Estado do onboarding
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_account_status TEXT
  NOT NULL DEFAULT 'not_connected';

-- Flags que a Stripe devolve — determinam se já pode receber
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_charges_enabled  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_payouts_enabled  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_details_submitted BOOLEAN NOT NULL DEFAULT FALSE;

-- O que ainda falta o dono preencher (vem do requirements da Stripe)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_requirements JSONB;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_connected_at TIMESTAMPTZ;

-- Assinatura do SaaS
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_price_id        TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS current_period_end     TIMESTAMPTZ;

-- Comissão efetiva deste tenant.
-- NULL = usa a do plano. Preenchido = negociação individual,
-- útil para dar condição especial a um cliente âncora.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS commission_pct_override NUMERIC(5,2);

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_stripe_account_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_stripe_account_status_check
  CHECK (stripe_account_status IN (
    'not_connected',  -- nunca iniciou
    'onboarding',     -- criou a conta, não terminou o cadastro
    'pending',        -- enviou dados, Stripe analisando
    'active',         -- pode receber
    'restricted',     -- faltou documento / bloqueado
    'rejected'        -- reprovado
  ));

CREATE INDEX IF NOT EXISTS idx_tenants_stripe_account
  ON tenants(stripe_account_id) WHERE stripe_account_id IS NOT NULL;

-- ── 2. Comissão por plano (tabela de referência) ───────────
-- Fica no banco para você ajustar sem redeploy.

CREATE TABLE IF NOT EXISTS plan_commissions (
  plan_type      TEXT PRIMARY KEY,
  commission_pct NUMERIC(5,2) NOT NULL CHECK (commission_pct >= 0 AND commission_pct <= 30),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO plan_commissions (plan_type, commission_pct) VALUES
  ('starter',    2.00),
  ('pro',        2.00),
  ('enterprise', 2.00)
ON CONFLICT (plan_type) DO UPDATE
  SET commission_pct = EXCLUDED.commission_pct, updated_at = now();

ALTER TABLE plan_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_plan_commissions" ON plan_commissions;
CREATE POLICY "read_plan_commissions" ON plan_commissions
  FOR SELECT USING (true);   -- transparente: a estética vê quanto paga

-- ── 3. Registro de cada transação com comissão ─────────────
-- É o seu extrato de receita de marketplace.

CREATE TABLE IF NOT EXISTS platform_earnings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid REFERENCES tenants(id) ON DELETE SET NULL,
  service_order_id   uuid REFERENCES service_orders(id) ON DELETE SET NULL,

  stripe_session_id       TEXT,
  stripe_payment_intent   TEXT,
  stripe_account_id       TEXT,

  gross_amount       NUMERIC(10,2) NOT NULL,   -- o que o cliente pagou
  commission_pct     NUMERIC(5,2)  NOT NULL,   -- % aplicado
  platform_fee       NUMERIC(10,2) NOT NULL,   -- sua parte
  tenant_amount      NUMERIC(10,2) NOT NULL,   -- parte da estética

  status             TEXT NOT NULL DEFAULT 'pending',
  currency           TEXT NOT NULL DEFAULT 'brl',
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform_earnings DROP CONSTRAINT IF EXISTS platform_earnings_status_check;
ALTER TABLE platform_earnings ADD CONSTRAINT platform_earnings_status_check
  CHECK (status IN ('pending', 'paid', 'refunded', 'failed'));

CREATE INDEX IF NOT EXISTS idx_platform_earnings_tenant
  ON platform_earnings(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_earnings_status
  ON platform_earnings(status, created_at DESC);

ALTER TABLE platform_earnings ENABLE ROW LEVEL SECURITY;

-- A estética vê só as próprias; o super admin vê tudo
DROP POLICY IF EXISTS "earnings_visibility" ON platform_earnings;
CREATE POLICY "earnings_visibility" ON platform_earnings
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    OR (SELECT is_super_admin FROM profiles WHERE id = auth.uid()) = true
  );

-- ── 4. Função que resolve a comissão de um tenant ──────────
-- Precedência: override individual → comissão do plano → 2%

CREATE OR REPLACE FUNCTION get_tenant_commission(p_tenant_id uuid)
RETURNS NUMERIC AS $$
DECLARE
  v_override NUMERIC;
  v_plan     TEXT;
  v_pct      NUMERIC;
BEGIN
  SELECT commission_pct_override, plan_type
    INTO v_override, v_plan
    FROM tenants WHERE id = p_tenant_id;

  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;

  SELECT commission_pct INTO v_pct
    FROM plan_commissions WHERE plan_type = v_plan;

  RETURN COALESCE(v_pct, 2.00);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ── 5. Vínculo do pagamento na ordem de serviço ────────────

ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS stripe_session_id     TEXT;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS paid_at               TIMESTAMPTZ;

-- ── 6. Visões de receita ───────────────────────────────────

-- Extrato consolidado por tenant (para o Super Admin)
CREATE OR REPLACE VIEW platform_revenue_by_tenant AS
SELECT
  t.id                                   AS tenant_id,
  t.name                                 AS tenant_name,
  t.plan_type,
  t.stripe_account_status,
  COUNT(pe.id) FILTER (WHERE pe.status = 'paid')          AS paid_transactions,
  COALESCE(SUM(pe.gross_amount)  FILTER (WHERE pe.status = 'paid'), 0) AS gross_volume,
  COALESCE(SUM(pe.platform_fee)  FILTER (WHERE pe.status = 'paid'), 0) AS platform_revenue,
  COALESCE(SUM(pe.tenant_amount) FILTER (WHERE pe.status = 'paid'), 0) AS tenant_revenue,
  MAX(pe.paid_at)                                          AS last_sale_at
FROM tenants t
LEFT JOIN platform_earnings pe ON pe.tenant_id = t.id
GROUP BY t.id, t.name, t.plan_type, t.stripe_account_status;

-- Receita da plataforma mês a mês
CREATE OR REPLACE VIEW platform_revenue_monthly AS
SELECT
  date_trunc('month', paid_at)::date AS month,
  COUNT(*)                            AS transactions,
  SUM(gross_amount)                   AS gross_volume,
  SUM(platform_fee)                   AS platform_revenue,
  AVG(commission_pct)                 AS avg_commission_pct
FROM platform_earnings
WHERE status = 'paid' AND paid_at IS NOT NULL
GROUP BY 1
ORDER BY 1 DESC;
