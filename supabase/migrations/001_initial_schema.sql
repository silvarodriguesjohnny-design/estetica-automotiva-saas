-- ============================================================
-- SISTEMA DE GESTÃO - ESTÉTICA AUTOMOTIVA
-- Schema inicial com Row Level Security (OWASP A01)
-- ============================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TENANTS (Multi-tenant SaaS)
-- ============================================================
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  plan_type TEXT NOT NULL DEFAULT 'starter' CHECK (plan_type IN ('starter','pro','enterprise')),
  subscription_type TEXT NOT NULL DEFAULT 'trial' CHECK (subscription_type IN ('trial','active','past_due','cancelled')),
  subscription_id TEXT, -- ID do gateway de pagamento (Stripe/Asaas)
  trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  whatsapp_phone TEXT,
  whatsapp_instance TEXT, -- nome da instância Evolution API
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  -- Dados do negócio
  full_name TEXT,
  email TEXT,
  phone TEXT,
  cpf_cnpj TEXT,
  cep TEXT,
  rua TEXT,
  numero TEXT,
  complemento TEXT,
  bairro TEXT,
  cidade TEXT,
  estado TEXT,
  horario_funcionamento JSONB DEFAULT '{}',
  numero_vagas INTEGER DEFAULT 3 CHECK (numero_vagas >= 1),
  quantidade_tecnicos INTEGER DEFAULT 1 CHECK (quantidade_tecnicos >= 1)
);

-- ============================================================
-- PROFILES (Usuários do sistema)
-- ============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','operator','viewer')),
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- CLIENTES
-- ============================================================
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  cpf TEXT,
  birthday DATE,
  communication_preferences TEXT[] DEFAULT '{}',
  discount_percentage NUMERIC(5,2) DEFAULT 0 CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  last_visit_at TIMESTAMPTZ
);

-- ============================================================
-- VEÍCULOS (entidade central da estética automotiva)
-- ============================================================
CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER CHECK (year >= 1900 AND year <= EXTRACT(YEAR FROM NOW()) + 2),
  color TEXT,
  plate TEXT,
  vin TEXT,
  fuel_type TEXT CHECK (fuel_type IN ('gasolina','etanol','flex','diesel','eletrico','hibrido')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- TÉCNICOS / PROFISSIONAIS
-- ============================================================
CREATE TABLE technicians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  specialty TEXT[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- SERVIÇOS
-- ============================================================
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  category TEXT CHECK (category IN ('lavagem','polimento','vitrificacao','ppf','higienizacao','funilaria','pelicula','cristalizacao','detailing','outros')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- ORDENS DE SERVIÇO (OS)
-- ============================================================
CREATE SEQUENCE service_order_number_seq;

CREATE TABLE service_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_number INTEGER NOT NULL DEFAULT nextval('service_order_number_seq'),
  customer_id UUID NOT NULL REFERENCES customers(id),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  technician_id UUID REFERENCES technicians(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','in_progress','completed','cancelled')),
  start_time TIMESTAMPTZ NOT NULL,
  estimated_end_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  notes TEXT,
  internal_notes TEXT,
  total_amount NUMERIC(10,2) DEFAULT 0,
  payment_method TEXT CHECK (payment_method IN ('dinheiro','pix','credito','debito','transferencia','boleto')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','partial','cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (tenant_id, order_number)
);

-- ============================================================
-- ITENS DA OS
-- ============================================================
CREATE TABLE service_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- FOTOS DAS OS (before/after)
-- ============================================================
CREATE TABLE service_order_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'before' CHECK (type IN ('before','during','after')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- TRANSAÇÕES FINANCEIRAS
-- ============================================================
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  description TEXT,
  category TEXT,
  payment_method TEXT,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  service_order_id UUID REFERENCES service_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- CAMPANHAS DE MARKETING
-- ============================================================
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  discount_percentage NUMERIC(5,2) DEFAULT 0,
  start_date DATE,
  end_date DATE,
  auto_trigger BOOLEAN DEFAULT FALSE,
  trigger_days_inactive INTEGER,
  message_template TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- CONFIGURAÇÃO MESSAGING (Evolution API / WhatsApp)
-- ============================================================
CREATE TABLE messaging_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  instance_name TEXT,
  api_key TEXT, -- OWASP A02: armazenado encriptado na aplicação
  webhook_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- ALERTAS DE INATIVIDADE
-- ============================================================
CREATE TABLE inactivity_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  days INTEGER NOT NULL DEFAULT 30 CHECK (days > 0),
  message TEXT NOT NULL,
  channels TEXT[] DEFAULT '{whatsapp}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- PENDING TENANTS (pré-cadastro antes do pagamento)
-- ============================================================
CREATE TABLE pending_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  cpf_cnpj TEXT,
  nome_negocio TEXT NOT NULL,
  plan_type TEXT NOT NULL DEFAULT 'starter',
  cep TEXT,
  rua TEXT,
  numero TEXT,
  complemento TEXT,
  bairro TEXT,
  cidade TEXT,
  estado TEXT,
  numero_vagas INTEGER DEFAULT 3,
  quantidade_tecnicos INTEGER DEFAULT 1,
  horario_funcionamento TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','converted')),
  payment_session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- AUDIT LOGS (OWASP A09 - Security Logging)
-- ============================================================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- ÍNDICES de performance
-- ============================================================
CREATE INDEX idx_profiles_tenant_id ON profiles(tenant_id);
CREATE INDEX idx_customers_tenant_id ON customers(tenant_id);
CREATE INDEX idx_customers_phone ON customers(tenant_id, phone);
CREATE INDEX idx_vehicles_tenant_id ON vehicles(tenant_id);
CREATE INDEX idx_vehicles_customer_id ON vehicles(customer_id);
CREATE INDEX idx_vehicles_plate ON vehicles(tenant_id, plate);
CREATE INDEX idx_technicians_tenant_id ON technicians(tenant_id);
CREATE INDEX idx_services_tenant_id ON services(tenant_id);
CREATE INDEX idx_service_orders_tenant_id ON service_orders(tenant_id);
CREATE INDEX idx_service_orders_status ON service_orders(tenant_id, status);
CREATE INDEX idx_service_orders_start_time ON service_orders(tenant_id, start_time);
CREATE INDEX idx_service_orders_customer ON service_orders(customer_id);
CREATE INDEX idx_service_order_items_order ON service_order_items(service_order_id);
CREATE INDEX idx_transactions_tenant_id ON transactions(tenant_id);
CREATE INDEX idx_transactions_created_at ON transactions(tenant_id, created_at DESC);
CREATE INDEX idx_audit_logs_tenant_id ON audit_logs(tenant_id, created_at DESC);

-- ============================================================
-- TRIGGER: updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_service_orders_updated_at BEFORE UPDATE ON service_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TRIGGER: auto-criar profile após signup
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- TRIGGER: atualiza last_visit_at no cliente após OS completada
-- ============================================================
CREATE OR REPLACE FUNCTION update_customer_last_visit()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    UPDATE customers SET last_visit_at = NOW()
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_service_order_completed
  AFTER UPDATE ON service_orders
  FOR EACH ROW EXECUTE FUNCTION update_customer_last_visit();

-- ============================================================
-- ROW LEVEL SECURITY (OWASP A01 - Broken Access Control)
-- ============================================================
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_order_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE inactivity_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_tenants ENABLE ROW LEVEL SECURITY;

-- Helper function: tenant_id do usuário atual
CREATE OR REPLACE FUNCTION auth.tenant_id() RETURNS UUID AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper function: é super admin?
CREATE OR REPLACE FUNCTION auth.is_super_admin() RETURNS BOOLEAN AS $$
  SELECT COALESCE(is_super_admin, FALSE) FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper function: role do usuário
CREATE OR REPLACE FUNCTION auth.user_role() RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- TENANTS: usuário vê apenas seu tenant
CREATE POLICY tenant_isolation ON tenants
  FOR ALL USING (id = auth.tenant_id() OR auth.is_super_admin());

-- PROFILES: usuário vê perfis do mesmo tenant
CREATE POLICY profiles_tenant_isolation ON profiles
  FOR ALL USING (tenant_id = auth.tenant_id() OR id = auth.uid() OR auth.is_super_admin());

-- CUSTOMERS: isolamento por tenant
CREATE POLICY customers_tenant_isolation ON customers
  FOR ALL USING (tenant_id = auth.tenant_id());

-- VEHICLES: isolamento por tenant
CREATE POLICY vehicles_tenant_isolation ON vehicles
  FOR ALL USING (tenant_id = auth.tenant_id());

-- TECHNICIANS: isolamento por tenant
CREATE POLICY technicians_tenant_isolation ON technicians
  FOR ALL USING (tenant_id = auth.tenant_id());

-- SERVICES: isolamento por tenant
CREATE POLICY services_tenant_isolation ON services
  FOR ALL USING (tenant_id = auth.tenant_id());

-- SERVICE ORDERS: isolamento por tenant
CREATE POLICY service_orders_tenant_isolation ON service_orders
  FOR ALL USING (tenant_id = auth.tenant_id());

-- SERVICE ORDER ITEMS: isolamento por tenant
CREATE POLICY service_order_items_tenant_isolation ON service_order_items
  FOR ALL USING (tenant_id = auth.tenant_id());

-- SERVICE ORDER PHOTOS: isolamento por tenant
CREATE POLICY service_order_photos_tenant_isolation ON service_order_photos
  FOR ALL USING (tenant_id = auth.tenant_id());

-- TRANSACTIONS: isolamento por tenant
CREATE POLICY transactions_tenant_isolation ON transactions
  FOR ALL USING (tenant_id = auth.tenant_id());

-- CAMPAIGNS: isolamento por tenant
CREATE POLICY campaigns_tenant_isolation ON campaigns
  FOR ALL USING (tenant_id = auth.tenant_id());

-- MESSAGING CONFIGS: isolamento por tenant
CREATE POLICY messaging_configs_tenant_isolation ON messaging_configs
  FOR ALL USING (tenant_id = auth.tenant_id());

-- INACTIVITY ALERTS: isolamento por tenant
CREATE POLICY inactivity_alerts_tenant_isolation ON inactivity_alerts
  FOR ALL USING (tenant_id = auth.tenant_id());

-- AUDIT LOGS: apenas leitura para admins do tenant
CREATE POLICY audit_logs_read ON audit_logs
  FOR SELECT USING (tenant_id = auth.tenant_id() OR auth.is_super_admin());

CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT WITH CHECK (TRUE); -- inserção via service role

-- PENDING TENANTS: apenas super admin
CREATE POLICY pending_tenants_super_admin ON pending_tenants
  FOR ALL USING (auth.is_super_admin());

CREATE POLICY pending_tenants_insert ON pending_tenants
  FOR INSERT WITH CHECK (TRUE); -- público pode criar

-- ============================================================
-- DADOS INICIAIS: Serviços padrão para novos tenants
-- (inseridos via Edge Function no onboarding)
-- ============================================================
-- Os serviços serão criados automaticamente pela Edge Function
-- create-tenant, baseados no plano contratado.

-- ============================================================
-- FUNÇÃO: criar tenant completo (usada na Edge Function)
-- ============================================================
CREATE OR REPLACE FUNCTION create_tenant_for_user(
  p_user_id UUID,
  p_tenant_name TEXT,
  p_plan_type TEXT,
  p_email TEXT,
  p_full_name TEXT,
  p_phone TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_tenant_id UUID;
  v_slug TEXT;
BEGIN
  -- Gerar slug único
  v_slug := lower(regexp_replace(p_tenant_name, '[^a-zA-Z0-9]', '-', 'g'));
  v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 8);

  -- Criar tenant
  INSERT INTO tenants (name, slug, plan_type, owner_id, email, full_name, phone)
  VALUES (p_tenant_name, v_slug, p_plan_type, p_user_id, p_email, p_full_name, p_phone)
  RETURNING id INTO v_tenant_id;

  -- Vincular profile ao tenant como admin
  UPDATE profiles
  SET tenant_id = v_tenant_id, role = 'admin'
  WHERE id = p_user_id;

  -- Criar serviços padrão do setor
  INSERT INTO services (tenant_id, name, description, price, duration_minutes, category) VALUES
    (v_tenant_id, 'Lavagem Simples', 'Lavagem externa completa', 50.00, 60, 'lavagem'),
    (v_tenant_id, 'Lavagem Completa', 'Lavagem externa + interna', 120.00, 120, 'lavagem'),
    (v_tenant_id, 'Higienização Interna', 'Limpeza profunda do interior', 250.00, 180, 'higienizacao'),
    (v_tenant_id, 'Polimento Simples', 'Remoção de riscos leves', 300.00, 240, 'polimento'),
    (v_tenant_id, 'Polimento Técnico', 'Correção de pintura com 3 estágios', 800.00, 480, 'polimento'),
    (v_tenant_id, 'Vitrificação de Pintura', 'Proteção cerâmica da pintura', 1200.00, 480, 'vitrificacao'),
    (v_tenant_id, 'Cristalização de Vidros', 'Tratamento hidrofóbico nos vidros', 200.00, 120, 'cristalizacao'),
    (v_tenant_id, 'Detailing Completo', 'Pacote completo de detalhamento', 2500.00, 720, 'detailing');

  -- Log de auditoria
  INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, new_values)
  VALUES (v_tenant_id, p_user_id, 'CREATE_TENANT', 'tenants', v_tenant_id::text,
    jsonb_build_object('name', p_tenant_name, 'plan_type', p_plan_type));

  RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
