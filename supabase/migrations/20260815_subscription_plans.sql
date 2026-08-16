-- ── Subscription Plans (Combos) ──────────────────────────────────────────────
-- Cada tenant pode criar seus próprios combos/planos de assinatura
-- que aparecem na agenda pública para o cliente contratar

create table if not exists subscription_plans (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  name          text not null,
  description   text,
  price         decimal(10,2) not null default 0,
  interval      text not null default 'monthly', -- monthly | quarterly | yearly | single
  services      jsonb,             -- array de service IDs incluídos
  sessions      int,               -- nº de sessões (ex: 4 lavagens/mês)
  stripe_price_id text,            -- Stripe Price ID quando integrado
  is_active     boolean not null default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table subscription_plans enable row level security;

create policy "tenant_read_own_plans" on subscription_plans
  for select using (
    tenant_id = (select tenant_id from profiles where id = auth.uid())
    or true  -- planos públicos são lidos sem auth pelo booking link
  );

create policy "tenant_manage_own_plans" on subscription_plans
  for all using (
    tenant_id = (select tenant_id from profiles where id = auth.uid())
  );

-- Coluna cpf_cnpj na tabela customers (se ainda não existir)
alter table customers add column if not exists cpf_cnpj text;
alter table customers add column if not exists email    text;

-- Index para busca rápida
create index if not exists idx_customers_cpf_cnpj on customers(cpf_cnpj, tenant_id);
create index if not exists idx_subscription_plans_tenant on subscription_plans(tenant_id, is_active);

-- Color/model na vehicles
alter table vehicles add column if not exists color text;
alter table vehicles add column if not exists year  int;
