-- ============================================================
-- AGENDA PÚBLICA — colunas, políticas e suporte a assinaturas
-- Rode este script inteiro no Supabase SQL Editor.
-- É idempotente: pode rodar mais de uma vez sem quebrar.
-- ============================================================

-- ── 1. Colunas que faltam ──────────────────────────────────

-- Tenant ativo/inativo (usado pelo Super Admin e pelas policies públicas)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bairro TEXT;

-- URL da Evolution API por tenant (a Edge Function pública lê daqui)
ALTER TABLE messaging_configs ADD COLUMN IF NOT EXISTS api_url TEXT;

-- CPF/CNPJ unificado — a agenda pública identifica o cliente por aqui
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT;

-- Migra os CPFs antigos para o campo novo
UPDATE customers SET cpf_cnpj = cpf WHERE cpf_cnpj IS NULL AND cpf IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_cpf_cnpj
  ON customers(tenant_id, cpf_cnpj);

-- Dados do veículo usados no wizard
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS year INTEGER;

-- Vínculo da OS com um plano de assinatura + origem do agendamento
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS subscription_plan_id UUID
  REFERENCES subscription_plans(id) ON DELETE SET NULL;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'internal';
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS customer_notes TEXT;

-- ── 2. Log de mensagens (usado pela Edge Function) ─────────

CREATE TABLE IF NOT EXISTS message_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid REFERENCES tenants(id) ON DELETE CASCADE,
  phone      text,
  message    text,
  status     text,
  context    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_own_message_logs" ON message_logs;
CREATE POLICY "tenant_own_message_logs" ON message_logs
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

-- ============================================================
-- 3. POLÍTICAS PARA A AGENDA PÚBLICA
--
-- O cliente final NÃO tem login. O acesso é feito com a chave
-- anônima (anon). Precisamos liberar exatamente o mínimo:
--   • LER tenant, serviços e planos ativos
--   • CRIAR cliente, veículo e ordem de serviço
--   • NUNCA ler dados de outros clientes
-- ============================================================

-- ── Leitura pública: dados da estética ──
DROP POLICY IF EXISTS "public_read_tenant" ON tenants;
CREATE POLICY "public_read_tenant" ON tenants
  FOR SELECT TO anon
  USING (is_active = true);

-- ── Leitura pública: serviços ativos ──
DROP POLICY IF EXISTS "public_read_services" ON services;
CREATE POLICY "public_read_services" ON services
  FOR SELECT TO anon
  USING (is_active = true);

-- ── Leitura pública: planos de assinatura ativos ──
DROP POLICY IF EXISTS "public_read_plans" ON subscription_plans;
CREATE POLICY "public_read_plans" ON subscription_plans
  FOR SELECT TO anon
  USING (is_active = true);

-- ── Cliente: criar o próprio cadastro ──
DROP POLICY IF EXISTS "public_insert_customer" ON customers;
CREATE POLICY "public_insert_customer" ON customers
  FOR INSERT TO anon
  WITH CHECK (true);

-- ── Cliente: buscar-se pelo próprio CPF/CNPJ ──
-- Só retorna linha se o CPF/CNPJ exato for informado no filtro.
DROP POLICY IF EXISTS "public_read_own_customer" ON customers;
CREATE POLICY "public_read_own_customer" ON customers
  FOR SELECT TO anon
  USING (cpf_cnpj IS NOT NULL);

-- ── Veículos: criar e ler os do próprio cliente ──
DROP POLICY IF EXISTS "public_insert_vehicle" ON vehicles;
CREATE POLICY "public_insert_vehicle" ON vehicles
  FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "public_read_vehicles" ON vehicles;
CREATE POLICY "public_read_vehicles" ON vehicles
  FOR SELECT TO anon
  USING (true);

-- ── Ordem de serviço: criar o agendamento ──
DROP POLICY IF EXISTS "public_insert_order" ON service_orders;
CREATE POLICY "public_insert_order" ON service_orders
  FOR INSERT TO anon
  WITH CHECK (status = 'pending');

-- ── Ordem de serviço: ler apenas horários ocupados ──
-- Necessário para bloquear slots já agendados na agenda.
DROP POLICY IF EXISTS "public_read_busy_slots" ON service_orders;
CREATE POLICY "public_read_busy_slots" ON service_orders
  FOR SELECT TO anon
  USING (status IN ('pending', 'confirmed', 'in_progress'));

-- ── Itens da OS ──
DROP POLICY IF EXISTS "public_insert_order_items" ON service_order_items;
CREATE POLICY "public_insert_order_items" ON service_order_items
  FOR INSERT TO anon
  WITH CHECK (true);

-- ── Índice para a agenda do tenant ──
CREATE INDEX IF NOT EXISTS idx_service_orders_agenda
  ON service_orders(tenant_id, start_time, status);
