-- ============================================================
-- CORREÇÃO DOS BLOQUEADORES DO TESTE FIM A FIM
--
-- Rode no Supabase SQL Editor. Idempotente.
-- ============================================================

-- ── 1. DIAGNÓSTICO — rode primeiro e olhe o resultado ──────
--
-- Se a agenda pública mostra "Nenhum serviço disponível" mesmo
-- com serviços ativos, o problema está aqui: a política que
-- permite o cliente anônimo ler os serviços.

SELECT
  tablename,
  policyname,
  cmd,
  roles::text AS para_quem,
  qual        AS condicao
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('services','tenants','subscription_plans','customers','service_orders')
ORDER BY tablename, policyname;

-- Confira também se os serviços estão realmente ativos:
-- SELECT id, name, is_active, tenant_id FROM services ORDER BY name;


-- ============================================================
-- 2. POLÍTICAS DA AGENDA PÚBLICA
--
-- O cliente final NÃO tem login. Acessa com a chave anônima.
-- Sem estas políticas ele vê a tela carregar e nenhum dado.
--
-- Importante: políticas do PostgreSQL são somadas (OR). Adicionar
-- uma permissiva para `anon` não afeta o isolamento entre tenants
-- para usuários logados — aquela continua valendo.
-- ============================================================

DROP POLICY IF EXISTS "public_read_tenant" ON tenants;
CREATE POLICY "public_read_tenant" ON tenants
  FOR SELECT TO anon USING (is_active = true);

DROP POLICY IF EXISTS "public_read_services" ON services;
CREATE POLICY "public_read_services" ON services
  FOR SELECT TO anon USING (is_active = true);

DROP POLICY IF EXISTS "public_read_plans" ON subscription_plans;
CREATE POLICY "public_read_plans" ON subscription_plans
  FOR SELECT TO anon USING (is_active = true);

DROP POLICY IF EXISTS "public_insert_customer" ON customers;
CREATE POLICY "public_insert_customer" ON customers
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "public_read_own_customer" ON customers;
CREATE POLICY "public_read_own_customer" ON customers
  FOR SELECT TO anon USING (cpf_cnpj IS NOT NULL);

DROP POLICY IF EXISTS "public_insert_vehicle" ON vehicles;
CREATE POLICY "public_insert_vehicle" ON vehicles
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "public_read_vehicles" ON vehicles;
CREATE POLICY "public_read_vehicles" ON vehicles
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "public_insert_order" ON service_orders;
CREATE POLICY "public_insert_order" ON service_orders
  FOR INSERT TO anon WITH CHECK (status IN ('pending','confirmed'));

DROP POLICY IF EXISTS "public_read_busy_slots" ON service_orders;
CREATE POLICY "public_read_busy_slots" ON service_orders
  FOR SELECT TO anon
  USING (status IN ('pending','confirmed','in_progress'));

DROP POLICY IF EXISTS "public_insert_order_items" ON service_order_items;
CREATE POLICY "public_insert_order_items" ON service_order_items
  FOR INSERT TO anon WITH CHECK (true);

-- Assinaturas: o cliente precisa ver a própria e o sistema precisa
-- poder criar quando ele contrata pela agenda pública.
DROP POLICY IF EXISTS "public_read_active_subs" ON customer_subscriptions;
CREATE POLICY "public_read_active_subs" ON customer_subscriptions
  FOR SELECT TO anon USING (status = 'active');

DROP POLICY IF EXISTS "public_insert_sub" ON customer_subscriptions;
CREATE POLICY "public_insert_sub" ON customer_subscriptions
  FOR INSERT TO anon WITH CHECK (status = 'pending');

DROP POLICY IF EXISTS "public_insert_sub_usage" ON subscription_usage;
CREATE POLICY "public_insert_sub_usage" ON subscription_usage
  FOR INSERT TO anon WITH CHECK (true);


-- ============================================================
-- 3. TOGGLE DE PAGAMENTO ONLINE
--
-- A estética não precisa saber de comissão nem de percentual.
-- Para ela existe uma decisão só: aceitar pagamento pela agenda
-- pública, sim ou não.
-- ============================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS online_payments_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tenants.online_payments_enabled IS
  'Liga/desliga a opção "Pagar agora" na agenda pública. Só tem efeito
   se a conta Connect estiver com charges_enabled = true.';


-- ============================================================
-- 4. DADOS BANCÁRIOS VISÍVEIS NO PAINEL (modelo híbrido)
--
-- O dinheiro continua indo direto para a conta Connect da estética
-- — você não toca nele, não vira intermediário financeiro. Mas os
-- dados bancários que ela cadastrou no Stripe ficam espelhados aqui
-- para você ter a visão consolidada no Super Admin.
--
-- Preenchidos pela Edge Function stripe-connect (ação 'sync'),
-- que lê da API do Stripe. Nunca digitados à mão.
-- ============================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bank_last4        TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bank_name         TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bank_routing      TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bank_holder_name  TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bank_synced_at    TIMESTAMPTZ;

COMMENT ON COLUMN tenants.bank_last4 IS
  'Últimos 4 dígitos da conta. NUNCA armazenamos o número completo —
   ele fica só no Stripe. Isso mantém o sistema fora do escopo de
   dados bancários sensíveis.';


-- ============================================================
-- 5. VISÃO CONSOLIDADA PARA O SUPER ADMIN
-- ============================================================

CREATE OR REPLACE VIEW tenant_payment_overview AS
SELECT
  t.id                       AS tenant_id,
  t.name                     AS tenant_name,
  t.plan_type,
  t.online_payments_enabled,
  t.stripe_account_id,
  t.stripe_account_status,
  t.stripe_charges_enabled,
  t.stripe_payouts_enabled,
  t.bank_name,
  t.bank_last4,
  t.bank_holder_name,
  t.bank_synced_at,
  COALESCE(get_tenant_commission(t.id), 2.00) AS commission_pct,
  COALESCE(rev.paid_transactions, 0)          AS paid_transactions,
  COALESCE(rev.gross_volume, 0)               AS gross_volume,
  COALESCE(rev.platform_revenue, 0)           AS platform_revenue,
  COALESCE(rev.tenant_revenue, 0)             AS tenant_revenue,
  rev.last_sale_at,
  -- Pronto para receber?
  CASE
    WHEN t.stripe_charges_enabled AND t.online_payments_enabled THEN 'recebendo'
    WHEN t.stripe_charges_enabled AND NOT t.online_payments_enabled THEN 'pronto_desligado'
    WHEN t.stripe_account_id IS NOT NULL THEN 'cadastro_incompleto'
    ELSE 'nao_conectado'
  END AS situacao
FROM tenants t
LEFT JOIN platform_revenue_by_tenant rev ON rev.tenant_id = t.id;
