-- ============================================
-- MIGRATION: products, services, message_templates
-- AutoDetail Pro - 2026-08-13
-- ============================================

-- TABELA: products (estoque de produtos avulsos)
CREATE TABLE IF NOT EXISTS products (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'outros',  -- limpeza, polimento, ceramica, peliculas, outros
  description text,
  sku text,
  unit text NOT NULL DEFAULT 'un',          -- un, ml, l, kg, g
  cost_price numeric(10,2) DEFAULT 0,
  sale_price numeric(10,2) NOT NULL DEFAULT 0,
  stock_quantity numeric(10,2) NOT NULL DEFAULT 0,
  min_stock numeric(10,2) DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_products" ON products
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE INDEX idx_products_active ON products(tenant_id, active);

-- TABELA: services (catálogo de serviços)
CREATE TABLE IF NOT EXISTS services (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'estetica',    -- lavagem, polimento, ceramica, peliculas, higienizacao, estetica, outros
  description text,
  duration_minutes integer NOT NULL DEFAULT 60,
  price numeric(10,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_services" ON services
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX idx_services_tenant ON services(tenant_id);
CREATE INDEX idx_services_active ON services(tenant_id, active);

-- TABELA: message_templates (templates de mensagem)
CREATE TABLE IF NOT EXISTS message_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = template global/padrão
  name text NOT NULL,
  category text NOT NULL DEFAULT 'geral',  -- confirmacao, lembrete, reativacao, aniversario, promocao, geral
  content text NOT NULL,
  variables text[] DEFAULT '{}',           -- ex: {nome}, {veiculo}, {data}
  is_global boolean NOT NULL DEFAULT false, -- templates padrão do sistema
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_templates" ON message_templates
  USING (
    tenant_id IS NULL  -- templates globais visíveis para todos
    OR tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE INDEX idx_templates_tenant ON message_templates(tenant_id);
CREATE INDEX idx_templates_global ON message_templates(is_global) WHERE is_global = true;

-- TABELA: campaign_segments (condições de envio de campanha)
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS segment_type text DEFAULT 'all_active';
-- all_active | inactive_30d | inactive_45d | inactive_60d | inactive_90d | birthday | custom
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS segment_conditions jsonb DEFAULT '{}';
-- ex: {"min_visits": 2, "avg_ticket_min": 100, "vehicle_type": "carro"}
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES message_templates(id);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS estimated_recipients integer DEFAULT 0;

-- SEED: templates globais padrão
INSERT INTO message_templates (tenant_id, name, category, content, variables, is_global) VALUES
(NULL, 'Confirmação de Agendamento', 'confirmacao',
 'Olá {nome}! 🚗 Seu agendamento na *{empresa}* foi confirmado para {data} às {hora}. Seu veículo {veiculo} estará em boas mãos! Qualquer dúvida, estamos aqui. ✨',
 ARRAY['{nome}','{empresa}','{data}','{hora}','{veiculo}'], true),

(NULL, 'Lembrete de Agendamento', 'lembrete',
 'Oi {nome}! 😊 Lembrete: amanhã às {hora} você tem um serviço agendado na *{empresa}*. Confirme sua presença respondendo *SIM*. Até lá! 🚗✨',
 ARRAY['{nome}','{hora}','{empresa}'], true),

(NULL, 'Reativação de Cliente Inativo', 'reativacao',
 'Sentimos sua falta, {nome}! 😢 Faz um tempo que não vemos o seu {veiculo} por aqui. Que tal dar uma passada na *{empresa}*? Temos novidades especiais esperando por você! 🚗✨',
 ARRAY['{nome}','{veiculo}','{empresa}'], true),

(NULL, 'Aniversário do Cliente', 'aniversario',
 '🎂 Feliz aniversário, {nome}! A equipe da *{empresa}* deseja um dia incrível! Como presente, preparamos um desconto especial para você. Venha nos visitar este mês! 🎉🚗',
 ARRAY['{nome}','{empresa}'], true),

(NULL, 'Promoção Especial', 'promocao',
 'Oi {nome}! 🔥 Promoção especial na *{empresa}*! {mensagem_promocao}. Aproveite e agende já: {link_agendamento}. Vagas limitadas! 🚗✨',
 ARRAY['{nome}','{empresa}','{mensagem_promocao}','{link_agendamento}'], true),

(NULL, 'OS Finalizada - Veículo Pronto', 'geral',
 '✅ Olá {nome}! O seu *{veiculo}* está pronto para retirada na *{empresa}*! Serviço realizado: {servico}. Valor: R$ {valor}. Aguardamos você! 🚗',
 ARRAY['{nome}','{veiculo}','{empresa}','{servico}','{valor}'], true),

(NULL, 'Pesquisa de Satisfação', 'geral',
 'Olá {nome}! 😊 Esperamos que tenha gostado do serviço na *{empresa}*! Sua opinião é muito importante. Como você avalia o atendimento de 1 a 5? Responda aqui mesmo! ⭐',
 ARRAY['{nome}','{empresa}'], true)
ON CONFLICT DO NOTHING;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_services_updated_at ON services;
CREATE TRIGGER trg_services_updated_at BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_templates_updated_at ON message_templates;
CREATE TRIGGER trg_templates_updated_at BEFORE UPDATE ON message_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();

