# Especificação — Pagamentos do "na régua"

> Documento para a IA que desenvolve o sistema no Skip.
> Descreve a arquitetura de pagamentos completa: assinatura do SaaS,
> marketplace com comissão e assinaturas dos clientes finais.
> Essa arquitetura já roda em produção num produto irmão (estética
> automotiva) — o que está aqui é o desenho validado, não hipótese.

---

## 1. Os três fluxos de dinheiro

O sistema tem três movimentações distintas. Confundi-las é o erro
mais comum e o mais caro de corrigir depois.

| # | Quem paga | Quem recebe | Recorrência | Comissão |
|---|---|---|---|---|
| **A** | Barbearia | Plataforma | Mensal | 100% da plataforma |
| **B** | Cliente final | Barbearia | Uma vez | 2% da plataforma |
| **C** | Cliente final | Barbearia | Mensal/trimestral/anual | 2% da plataforma |

**Fluxo A** — a barbearia assina o software. Dinheiro 100% da plataforma.

**Fluxo B** — o cliente paga o corte antecipadamente ao agendar. O dinheiro
vai para a conta da barbearia; a plataforma retém 2%.

**Fluxo C** — o cliente assina um plano da barbearia (ex: "4 cortes/mês por
R$ 120"). Cobrança recorrente na conta da barbearia, 2% retidos a cada
cobrança, inclusive nas renovações.

---

## 2. Modelo técnico: Stripe Connect com Destination Charge

```
Cliente paga R$ 60 pelo corte
        │
        ▼
Stripe processa na conta da PLATAFORMA
        │
        ├─ R$ 58,80 → conta Connect da barbearia (transfer_data.destination)
        └─ R$  1,20 → plataforma (application_fee_amount = 2%)
```

**Por que Destination Charge e não receber tudo e repassar:**
o dinheiro nunca fica retido na conta da plataforma. Quem prestou o
serviço é a barbearia, então a receita é dela e a responsabilidade
fiscal também. Receber tudo e repassar depois transformaria a
plataforma em intermediária financeira, com obrigação de emitir nota
sobre receita que não é dela.

**Tipo de conta Connect: Express.** O Stripe cuida do KYC, dos dados
bancários e do painel do barbeiro. O cadastro leva ~5 minutos. Standard
exigiria que o barbeiro criasse uma conta Stripe completa — barreira
alta demais para o público.

---

## 3. Ambiente Stripe: Sandbox dedicada

O na régua roda em **Sandbox própria**, separada do produto de estética.
Isolamento total: chaves, produtos, clientes, webhooks e contas Connect
independentes.

### Criar a Sandbox

1. Stripe Dashboard → canto superior esquerdo → seletor de conta
2. **Sandboxes** → **Create sandbox**
3. Nome: `na regua` → **Create**
4. Entre nela — a barra superior fica laranja indicando sandbox

### Dentro da Sandbox

| Item | Onde pegar |
|---|---|
| `sk_test_...` | Developers → API keys → Secret key |
| `pk_test_...` | Developers → API keys → Publishable key |
| Connect | Menu Connect → Get started → "Platform or marketplace" |

> Cada sandbox tem chaves próprias. A `sk_test_` da sandbox do na régua
> **não é** a mesma do outro produto. Misturar as duas é a origem mais
> provável de "o webhook não dispara" e "o produto não aparece".

### Produtos criados pelo script

Rodar `node scripts/setup-stripe-barbearia.mjs` com a chave da sandbox
do na régua cria:

| Plano | Valor | Barbeiros | lookup_key |
|---|---|---|---|
| Essential | R$ 97,90/mês | 2 | `nrg_essential_monthly` |
| Pro | R$ 117,90/mês | 3 | `nrg_pro_monthly` |
| Elite | R$ 297,90/mês | ilimitados | `nrg_elite_monthly` |

- **Trial: 30 dias**, no próprio Price (`trial_period_days`)
- **Metadata:** `app: 'na-regua'`, `commission_pct: '2'`, `max_barbers`

### ✅ IDs já criados (Sandbox "na regua")

```ts
// src/config/plans.ts
export const STRIPE_PRICE_IDS_TEST = {
  essential: 'price_1U76PvKWb4rRtejTp0DM4SjX',
  pro:       'price_1U76PwKWb4rRtejTHuizF5xd',
  elite:     'price_1U76PxKWb4rRtejT0yvNfJGE',
}
```

| Plano | product_id | price_id |
|---|---|---|
| Essential | `prod_V7L6KezpjIAT7N` | `price_1U76PvKWb4rRtejTp0DM4SjX` |
| Pro | `prod_V7L60wrinXoko7` | `price_1U76PwKWb4rRtejTHuizF5xd` |
| Elite | `prod_V7L61kgsu1VJrU` | `price_1U76PxKWb4rRtejT0yvNfJGE` |

**Configuração dos planos no sistema:**

```ts
export const PLANS = [
  {
    id: 'essential', name: 'Essential', price: 97.90,
    priceId: 'price_1U76PvKWb4rRtejTp0DM4SjX',
    maxBarbers: 2, commissionPct: 2,
    features: [
      'Agendamento automatizado',
      'CRM de clientes',
      'Controle financeiro básico',
      '2 barbeiros inclusos',
    ],
  },
  {
    id: 'pro', name: 'Pro', price: 117.90, badge: 'Mais Popular',
    priceId: 'price_1U76PwKWb4rRtejTHuizF5xd',
    maxBarbers: 3, commissionPct: 2,
    features: [
      'Tudo do Essential',
      'Programa de fidelidade',
      'Campanhas automatizadas',
      '3 barbeiros inclusos',
      'Relatórios avançados',
    ],
  },
  {
    id: 'elite', name: 'Elite', price: 297.90,
    priceId: 'price_1U76PxKWb4rRtejT0yvNfJGE',
    maxBarbers: null, commissionPct: 2,
    features: [
      'Tudo do Pro',
      'Barbeiros ilimitados',
      'Gestão multi-unidades',
      'Suporte prioritário',
      'White-label',
    ],
  },
]

export const TRIAL_DAYS = 30
```

> **Limite de barbeiros:** ao cadastrar um barbeiro, valide contra
> `maxBarbers` do plano do tenant. `null` significa ilimitado.
> Sem essa validação, o Essential vira Elite de graça.

> A metadata continua útil mesmo com sandbox separada: quando migrar
> para produção, ela permite conferir de onde veio cada assinatura sem
> depender do ambiente.

### Quando for para produção

Repita a estrutura numa **conta Stripe separada** (não sandbox):
novo cadastro, novo Connect, nova conta bancária de repasse. O mesmo
script roda com a `sk_live_` dessa conta.

Isso significa dois processos de aprovação do Connect e dois pontos de
conciliação financeira — é o custo do isolamento que você escolheu, e
ele se paga quando os produtos crescerem em ritmos diferentes ou se um
deles for vendido separadamente um dia.

---

## 4. Schema do banco (PostgreSQL / Supabase)

### 4.1 Campos na tabela de barbearias (`tenants` ou equivalente)

```sql
-- Conta Connect da barbearia
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_account_status TEXT NOT NULL DEFAULT 'not_connected';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_charges_enabled   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_payouts_enabled   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_details_submitted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_requirements JSONB;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_connected_at TIMESTAMPTZ;

-- Assinatura do SaaS
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_price_id        TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS current_period_end     TIMESTAMPTZ;

-- Comissão individual (NULL = usa a do plano)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS commission_pct_override NUMERIC(5,2);

ALTER TABLE tenants ADD CONSTRAINT tenants_stripe_account_status_check
  CHECK (stripe_account_status IN (
    'not_connected','onboarding','pending','active','restricted','rejected'
  ));
```

**Estados da conta Connect:**

| Estado | Significado |
|---|---|
| `not_connected` | Nunca iniciou o cadastro |
| `onboarding` | Criou a conta, não terminou |
| `pending` | Enviou dados, Stripe analisando |
| `active` | Pode receber pagamentos |
| `restricted` | Faltou documento ou foi bloqueado |
| `rejected` | Reprovado pelo Stripe |

### 4.2 Comissão por plano

```sql
CREATE TABLE IF NOT EXISTS plan_commissions (
  plan_type      TEXT PRIMARY KEY,
  commission_pct NUMERIC(5,2) NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO plan_commissions (plan_type, commission_pct)
VALUES ('essential', 2.00), ('pro', 2.00), ('elite', 2.00)
ON CONFLICT (plan_type) DO UPDATE SET commission_pct = EXCLUDED.commission_pct;

ALTER TABLE plan_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_plan_commissions" ON plan_commissions FOR SELECT USING (true);
```

> A taxa fica no banco, não no código: ajustar não exige redeploy.
> A policy é pública de propósito — a barbearia deve poder ver quanto paga.

### 4.3 Extrato de comissões

```sql
CREATE TABLE IF NOT EXISTS platform_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  stripe_session_id TEXT,
  stripe_payment_intent TEXT,
  stripe_account_id TEXT,
  gross_amount   NUMERIC(10,2) NOT NULL,   -- o que o cliente pagou
  commission_pct NUMERIC(5,2)  NOT NULL,
  platform_fee   NUMERIC(10,2) NOT NULL,   -- parte da plataforma
  tenant_amount  NUMERIC(10,2) NOT NULL,   -- parte da barbearia
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|paid|refunded|failed
  currency TEXT NOT NULL DEFAULT 'brl',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform_earnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "earnings_visibility" ON platform_earnings FOR SELECT USING (
  tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  OR (SELECT is_super_admin FROM profiles WHERE id = auth.uid()) = true
);
```

### 4.4 Assinaturas dos clientes finais

Este é o pedaço que costuma ser subestimado. **Uma assinatura não é um
pagamento caro — é um saldo.** O cliente paga R$ 120/mês e tem direito a
4 cortes. Sem controlar quantos já usou, a barbearia não sabe se aquele
contrato dá lucro ou prejuízo.

```sql
CREATE TABLE IF NOT EXISTS customer_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  plan_id     uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  barber_id   uuid REFERENCES barbers(id) ON DELETE SET NULL,  -- barbeiro preferido

  status text NOT NULL DEFAULT 'pending',
  -- pending|active|past_due|paused|cancelled|expired

  -- Valores congelados na contratação: se a barbearia reajustar o
  -- plano depois, quem já assinou continua no preço antigo.
  price numeric(10,2) NOT NULL,
  interval text NOT NULL DEFAULT 'monthly',
  sessions_total integer,          -- NULL = ilimitado

  -- Ciclo atual
  sessions_used integer NOT NULL DEFAULT 0,
  cycle_start timestamptz,
  cycle_end   timestamptz,

  stripe_subscription_id text,
  stripe_customer_id     text,
  stripe_session_id      text,
  commission_pct numeric(5,2),

  started_at   timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cust_subs_tenant   ON customer_subscriptions(tenant_id, status);
CREATE INDEX idx_cust_subs_customer ON customer_subscriptions(customer_id, status);
CREATE INDEX idx_cust_subs_stripe   ON customer_subscriptions(stripe_subscription_id);

ALTER TABLE customer_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_own_customer_subs" ON customer_subscriptions FOR ALL USING (
  tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  OR (SELECT is_super_admin FROM profiles WHERE id = auth.uid()) = true
);

-- A agenda pública precisa consultar se o cliente tem assinatura ativa
CREATE POLICY "public_read_active_subs" ON customer_subscriptions
  FOR SELECT TO anon USING (status = 'active');
```

**Histórico de uso** — auditoria. Quando o cliente disser "eu não usei 4
vezes", tem que haver prova.

```sql
CREATE TABLE IF NOT EXISTS subscription_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  cycle_start timestamptz,
  used_at timestamptz NOT NULL DEFAULT now(),
  note text
);
```

**Vínculo no agendamento:**

```sql
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS customer_subscription_id UUID
  REFERENCES customer_subscriptions(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS covered_by_subscription BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
```

---

## 5. Funções SQL de negócio

### 5.1 Resolver a comissão de uma barbearia

Precedência: override individual → comissão do plano → 2%.

```sql
CREATE OR REPLACE FUNCTION get_tenant_commission(p_tenant_id uuid)
RETURNS NUMERIC AS $$
DECLARE v_override NUMERIC; v_plan TEXT; v_pct NUMERIC;
BEGIN
  SELECT commission_pct_override, plan_type INTO v_override, v_plan
    FROM tenants WHERE id = p_tenant_id;
  IF v_override IS NOT NULL THEN RETURN v_override; END IF;
  SELECT commission_pct INTO v_pct FROM plan_commissions WHERE plan_type = v_plan;
  RETURN COALESCE(v_pct, 2.00);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

### 5.2 Consumir uma sessão da assinatura

**Ponto crítico:** usa `FOR UPDATE` para travar a linha. Sem isso, dois
agendamentos simultâneos conseguem gastar a mesma sessão.

```sql
CREATE OR REPLACE FUNCTION consume_subscription_session(
  p_subscription_id uuid, p_appointment_id uuid DEFAULT NULL
) RETURNS boolean AS $$
DECLARE v_sub customer_subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO v_sub FROM customer_subscriptions
   WHERE id = p_subscription_id FOR UPDATE;   -- trava

  IF NOT FOUND OR v_sub.status <> 'active' THEN RETURN FALSE; END IF;

  -- Ciclo vencido? Zera antes de consumir.
  IF v_sub.cycle_end IS NOT NULL AND v_sub.cycle_end < now() THEN
    UPDATE customer_subscriptions
       SET sessions_used = 0, cycle_start = now(),
           cycle_end = now() + CASE interval
             WHEN 'monthly'   THEN INTERVAL '1 month'
             WHEN 'quarterly' THEN INTERVAL '3 months'
             WHEN 'yearly'    THEN INTERVAL '1 year'
             ELSE INTERVAL '1 month' END
     WHERE id = p_subscription_id;
    v_sub.sessions_used := 0;
  END IF;

  IF v_sub.sessions_total IS NOT NULL
     AND COALESCE(v_sub.sessions_used,0) >= v_sub.sessions_total THEN
    RETURN FALSE;   -- saldo esgotado
  END IF;

  UPDATE customer_subscriptions
     SET sessions_used = COALESCE(sessions_used,0)+1, updated_at = now()
   WHERE id = p_subscription_id;

  INSERT INTO subscription_usage (subscription_id, tenant_id, appointment_id, cycle_start)
  VALUES (p_subscription_id, v_sub.tenant_id, p_appointment_id, v_sub.cycle_start);

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 5.3 Buscar assinatura ativa de um cliente

Usada na agenda pública logo após a identificação por CPF.

```sql
CREATE OR REPLACE FUNCTION get_active_subscription(p_tenant_id uuid, p_customer_id uuid)
RETURNS TABLE (
  id uuid, plan_id uuid, plan_name text,
  sessions_total integer, sessions_used integer, remaining integer,
  cycle_end timestamptz
) AS $$
  SELECT cs.id, cs.plan_id, sp.name, cs.sessions_total, cs.sessions_used,
    CASE WHEN cs.sessions_total IS NULL THEN 9999
         ELSE GREATEST(0, cs.sessions_total - COALESCE(cs.sessions_used,0)) END,
    cs.cycle_end
  FROM customer_subscriptions cs
  JOIN subscription_plans sp ON sp.id = cs.plan_id
  WHERE cs.tenant_id = p_tenant_id AND cs.customer_id = p_customer_id
    AND cs.status = 'active'
  ORDER BY cs.created_at DESC LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```

---

## 6. Edge Functions

### 6.1 `stripe-connect` — onboarding da barbearia

Autenticada. O `tenant_id` vem do profile do usuário, **nunca do body**
— senão qualquer um consulta a conta de outra barbearia.

**Ações:** `onboard`, `status`, `dashboard`, `refresh`

```ts
// Criar conta Express
const account = await stripe.accounts.create({
  type: 'express',
  country: 'BR',
  email: tenant.email,
  business_type: cnpjTem14Digitos ? 'company' : 'individual',
  business_profile: {
    name: tenant.name,
    product_description: 'Serviços de barbearia e estética masculina',
    mcc: '7230',                    // Barber and Beauty Shops
    support_email: tenant.email,
  },
  capabilities: {
    card_payments: { requested: true },
    transfers: { requested: true },
  },
  settings: {
    payouts: { schedule: { interval: 'daily', delay_days: 'minimum' } },
  },
  metadata: { tenant_id: tenantId, app: 'na-regua' },
})

// Link de onboarding hospedado pelo Stripe
const link = await stripe.accountLinks.create({
  account: account.id,
  refresh_url: `${APP_URL}/configuracoes?tab=pagamentos&refresh=1`,
  return_url:  `${APP_URL}/configuracoes?tab=pagamentos&done=1`,
  type: 'account_onboarding',
})
```

> **MCC 7230** é o código de barbearia. No produto de estética é 7542
> (Car Washes). Usar o código certo evita fricção na análise do Stripe.

**Mapeamento de status:**

```ts
function mapStatus(acct) {
  if (acct.charges_enabled && acct.payouts_enabled) return 'active'
  const req = acct.requirements
  if (req?.disabled_reason?.includes('rejected')) return 'rejected'
  if ((req?.currently_due?.length ?? 0) > 0 || (req?.past_due?.length ?? 0) > 0)
    return acct.details_submitted ? 'restricted' : 'onboarding'
  if (acct.details_submitted) return 'pending'
  return 'onboarding'
}
```

### 6.2 `stripe-checkout` — três cenários numa função

**Cenário A — assinatura do SaaS (barbearia assina o sistema):**

```ts
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  customer: customerId,                    // reaproveita se já existir
  line_items: [{ price: priceId, quantity: 1 }],
  subscription_data: {
    trial_period_days: 30,
    metadata: { tenant_id, plan_id, kind: 'saas_subscription' },
    trial_settings: {
      // Cartão falhou no fim do trial → cancela em vez de deixar
      // a assinatura pendurada gerando cobrança fantasma
      end_behavior: { missing_payment_method: 'cancel' },
    },
  },
  payment_method_collection: 'always',     // ← COLETA O CARTÃO NO TRIAL
  metadata: { tenant_id, plan_id, kind: 'saas_subscription' },
  success_url: `${APP_URL}/dashboard?welcome=1`,
  cancel_url:  `${APP_URL}/cadastro?plan=${plan_id}`,
  locale: 'pt-BR',
  allow_promotion_codes: true,
})
```

> **⚠️ ARMADILHA JÁ VIVIDA:** a landing do na régua diz "sem cartão de
> crédito". Se o cartão não for coletado, no 31º dia não há como cobrar —
> o cliente perde o acesso e você perde a venda. Colete o cartão e seja
> transparente: *"14 dias grátis. Nada é cobrado hoje. Cancele quando
> quiser."* Converte melhor do que a promessa que quebra depois.

**Cenário B — agendamento pago antecipadamente:**

```ts
const { data: pct } = await supabase.rpc('get_tenant_commission', { p_tenant_id: tenantId })
const commissionPct = Number(pct ?? 2)
const feeCents = Math.round(amountCents * (commissionPct / 100))

const connected = !!(tenant.stripe_account_id && tenant.stripe_charges_enabled)

const params = {
  mode: 'payment',
  line_items: [{
    price_data: {
      currency: 'brl',
      product_data: { name: `Agendamento — ${tenant.name}` },
      unit_amount: amountCents,
    },
    quantity: 1,
  }],
  metadata: {
    appointment_id, tenant_id,
    commission_pct: String(commissionPct),
    platform_fee: String(feeCents),
    kind: 'booking_payment',
  },
  locale: 'pt-BR',
}

// Destination charge — SÓ se a barbearia estiver apta a receber
if (connected) {
  params.payment_intent_data = {
    application_fee_amount: feeCents,
    transfer_data: { destination: tenant.stripe_account_id },
    metadata: { appointment_id, tenant_id },
  }
}
// Se não estiver conectada, o valor cai na plataforma e fica registrado
// como pendente de repasse. O cliente final NUNCA vê erro por causa de
// configuração que o dono da barbearia não fez.
```

**Cenário C — cliente assina plano da barbearia:**

```ts
const INTERVAL_MAP = {
  monthly:   { interval: 'month', count: 1 },
  quarterly: { interval: 'month', count: 3 },
  yearly:    { interval: 'year',  count: 1 },
}
const recur = INTERVAL_MAP[plan.interval] ?? INTERVAL_MAP.monthly

// Pré-registra como 'pending'. O webhook ativa quando o pagamento
// confirmar — assim nunca existe assinatura ativa sem pagamento.
const { data: cs } = await supabase.from('customer_subscriptions').insert({
  tenant_id, customer_id, plan_id, barber_id,
  status: 'pending',
  price: amountCents / 100,
  interval: plan.interval,
  sessions_total: plan.sessions,
  commission_pct: commissionPct,
}).select('id').single()

const params = {
  mode: 'subscription',
  line_items: [{
    price_data: {
      currency: 'brl',
      recurring: { interval: recur.interval, interval_count: recur.count },
      product_data: { name: `${plan.name} — ${tenant.name}` },
      unit_amount: amountCents,
    },
    quantity: 1,
  }],
  subscription_data: {
    application_fee_percent: commissionPct,          // ← 2% em TODA renovação
    transfer_data: { destination: tenant.stripe_account_id },
    metadata: {
      appointment_id, tenant_id,
      kind: 'customer_subscription',
      customer_subscription_id: cs.id,
    },
  },
  metadata: { /* mesmo conteúdo */ },
}
```

> `application_fee_percent` no `subscription_data` garante que os 2%
> sejam retidos **a cada renovação**, não só na primeira cobrança.

### 6.3 `stripe-webhook` — fonte de verdade

**Deploy obrigatório sem verificação de JWT** — o Stripe não envia Bearer:

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

Nunca confie no redirect de sucesso do navegador: o usuário pode fechar
a aba antes. O webhook é o que decide o que realmente aconteceu.

**Verificação de assinatura (obrigatória):**

```ts
const sig = req.headers.get('stripe-signature')
const raw = await req.text()
const event = await stripe.webhooks.constructEventAsync(
  raw, sig, WEBHOOK_SECRET, undefined, Stripe.createSubtleCryptoProvider()
)
```

**Eventos e o que fazer em cada um:**

| Evento | Ação |
|---|---|
| `checkout.session.completed` | Roteia por `metadata.kind` (ver abaixo) |
| `customer.subscription.created/updated` | Atualiza status; roteia por `metadata.kind` |
| `customer.subscription.deleted` | Marca cancelado |
| `customer.subscription.trial_will_end` | Avisa no WhatsApp 3 dias antes |
| `invoice.payment_succeeded` | Renova ciclo e **zera `sessions_used`** |
| `invoice.payment_failed` | Marca `past_due` — **não cancela** |
| `account.updated` | Atualiza status da conta Connect |

**Roteamento por `kind` em `checkout.session.completed`:**

```ts
const kind = session.metadata?.kind

if (kind === 'saas_subscription') {
  // Barbearia assinou o sistema
  await db.tenants.update({
    subscription_type: 'trial',
    stripe_subscription_id: session.subscription,
    stripe_customer_id: session.customer,
    plan_type: session.metadata.plan_id,
    is_active: true,
  }).eq('id', session.metadata.tenant_id)
}

if (kind === 'customer_subscription') {
  // Cliente assinou plano da barbearia
  const meses = { monthly: 1, quarterly: 3, yearly: 12 }[plan.interval] ?? 1
  const cycleEnd = new Date(); cycleEnd.setMonth(cycleEnd.getMonth() + meses)

  await db.customer_subscriptions.update({
    status: 'active',
    stripe_subscription_id: session.subscription,
    started_at: now, cycle_start: now, cycle_end: cycleEnd,
    sessions_used: 0,
  }).eq('id', session.metadata.customer_subscription_id)

  // O primeiro agendamento já consome uma sessão
  await db.rpc('consume_subscription_session', {
    p_subscription_id: session.metadata.customer_subscription_id,
    p_appointment_id: session.metadata.appointment_id,
  })
}

if (kind === 'booking_payment') {
  await db.appointments.update({
    payment_status: 'paid',
    status: 'confirmed',        // pagou → confirma automático
    paid_at: now,
  }).eq('id', session.metadata.appointment_id)

  await db.platform_earnings.update({ status: 'paid', paid_at: now })
    .eq('stripe_session_id', session.id)
}
```

**Renovação — o momento em que o saldo zera:**

```ts
case 'invoice.payment_succeeded': {
  const sub = await stripe.subscriptions.retrieve(invoice.subscription)

  if (sub.metadata?.customer_subscription_id) {
    // Só renova a partir da SEGUNDA cobrança. A primeira é a da
    // contratação, e o ciclo já foi criado no checkout.completed.
    if (invoice.billing_reason === 'subscription_cycle') {
      await db.customer_subscriptions.update({
        status: 'active',
        sessions_used: 0,                      // ← zera o saldo
        cycle_start: new Date(sub.current_period_start * 1000),
        cycle_end:   new Date(sub.current_period_end * 1000),
      }).eq('id', sub.metadata.customer_subscription_id)

      // Registra a comissão da renovação
      await db.platform_earnings.insert({ /* 2% do invoice.amount_paid */ })
    }
  }
}
```

> **Se o ciclo não reiniciar aqui, o cliente paga o segundo mês e continua
> sem poder agendar.** É o bug mais provável de passar despercebido.

**Pagamento recusado — não cancele:**

```ts
case 'invoice.payment_failed':
  // O Stripe ainda vai tentar de novo. Cancelar aqui puniria o
  // cliente por um limite temporário no cartão.
  await db.customer_subscriptions.update({ status: 'past_due' })
```

**Sempre responda 200**, mesmo em erro interno — senão o Stripe entra em
loop de retry por um problema que é seu, não dele. Registre no log.

---

## 7. Fluxo da agenda pública

```
1. Cliente informa CPF/CNPJ
        │
        ├─ Cliente conhecido → busca assinatura ativa
        │       │
        │       ├─ Tem saldo → oferece "Usar minha assinatura" (sem custo)
        │       └─ Sem saldo → mostra aviso e opções de pagamento
        │
        └─ Cliente novo → cadastro (nome + WhatsApp)
                                │
                                ▼
2. Escolhe barbeiro e serviço  OU  assina um plano
                                │
                                ▼
3. Escolhe data e horário
                                │
                                ▼
4. Pagamento: assinatura (sem custo) | antecipado | no local
                                │
                                ▼
5. Confirmação por WhatsApp
```

**Ao usar crédito de assinatura:**

```ts
const usingSub = payWhen === 'subscription' && activeSub?.remaining > 0

const { data: appt } = await db.appointments.insert({
  tenant_id, customer_id, barber_id,
  status: usingSub ? 'confirmed' : 'pending',
  total_amount: usingSub ? 0 : price,
  customer_subscription_id: usingSub ? activeSub.id : null,
  covered_by_subscription: usingSub,
  payment_status: usingSub ? 'paid' : 'pending',
}).select('id').single()

if (usingSub) {
  const { data: ok } = await db.rpc('consume_subscription_session', {
    p_subscription_id: activeSub.id, p_appointment_id: appt.id,
  })
  if (ok === false) {
    // Saldo acabou entre a tela e o envio — desfaz e avisa
    await db.appointments.delete().eq('id', appt.id)
    // volta para escolha de pagamento
  }
}
```

---

## 8. Políticas RLS da agenda pública

O cliente final **não tem login**. Acessa com a chave anônima. Libere
o mínimo necessário:

```sql
-- Leitura pública
CREATE POLICY "public_read_tenant" ON tenants
  FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "public_read_services" ON services
  FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "public_read_barbers" ON barbers
  FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "public_read_plans" ON subscription_plans
  FOR SELECT TO anon USING (is_active = true);

-- Criação
CREATE POLICY "public_insert_customer" ON customers
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "public_insert_appointment" ON appointments
  FOR INSERT TO anon WITH CHECK (status = 'pending');

-- Busca do próprio cadastro por CPF
CREATE POLICY "public_read_own_customer" ON customers
  FOR SELECT TO anon USING (cpf_cnpj IS NOT NULL);

-- Horários ocupados (para bloquear slots já agendados)
CREATE POLICY "public_read_busy_slots" ON appointments
  FOR SELECT TO anon USING (status IN ('pending','confirmed','in_progress'));
```

> **Ressalva de privacidade:** `public_read_own_customer` permite que
> alguém com um CPF de terceiro veja nome e telefone daquele cliente.
> É o mínimo para o "já sou cliente" funcionar. Para fechar isso, mova a
> busca para uma Edge Function que retorne apenas "existe / não existe"
> e devolva os dados só após validação por código no WhatsApp.

---

## 9. Configuração do webhook no Stripe

Stripe → Developers → Webhooks → **Add endpoint**

```
URL: https://SEU-PROJETO-SKIP.supabase.co/functions/v1/stripe-webhook
```

| Configuração | Valor | Por quê |
|---|---|---|
| Escopo | **Sua conta** | Destination charges nascem na plataforma |
| Estilo de carga | **Instantâneo (snapshot)** | "Thin" manda só o ID; o código lê `event.data.object` |
| Destinos | **Apenas um** | Dois destinos = todo evento processado 2× |
| Versão da API | Default ou 2023-10-16 | Fixar evita quebra em mudanças do Stripe |

**Armadilhas já vividas na configuração:**

1. O wizard do Stripe permite marcar snapshot **e** thin ao mesmo tempo,
   criando dois destinos. Marque só snapshot.
2. Se criar dois destinos para a mesma URL, cada pagamento é processado
   duas vezes: comissão dobrada, dois lançamentos no financeiro, duas
   mensagens de WhatsApp.
3. Sem `--no-verify-jwt` no deploy, o Stripe recebe 401 e o webhook
   nunca processa nada.

---

## 10. Secrets necessários

No projeto Supabase do Skip:

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...   # do webhook do na régua
supabase secrets set APP_URL=https://naregua.com.br
```

> Todas as três chaves vêm da **Sandbox do na régua**, não da sandbox
> do outro produto. Confira antes de colar: chave errada gera erros
> silenciosos difíceis de rastrear.

---

## 11. Roteiro de teste

Cartão: `4242 4242 4242 4242` · validade futura · CVC qualquer

| # | Teste | Resultado esperado |
|---|---|---|
| 1 | Criar conta escolhendo plano Pro | Checkout do Stripe abre e **pede o cartão** |
| 2 | Preencher cartão de teste | Cai no dashboard; `subscription_type = 'trial'` |
| 3 | Conferir no Stripe | Subscription com status `trialing`, cobrança em 30 dias |
| 4 | Configurações → Pagamentos → Conectar | Abre onboarding Express |
| 5 | Completar cadastro Connect | Status vira `active`; `charges_enabled = true` |
| 6 | Criar plano "4 cortes/mês — R$ 120" | Aparece na agenda pública |
| 7 | Agenda pública → CPF novo → assinar plano | Checkout recorrente abre |
| 8 | Pagar | `customer_subscriptions.status = 'active'`, `sessions_used = 1` |
| 9 | Conferir `platform_earnings` | `platform_fee = 2.40` (2% de 120) |
| 10 | Voltar com o **mesmo CPF** | Aparece "Você tem 3 sessões" |
| 11 | Agendar usando a assinatura | Sem cobrança; `sessions_used = 2` |
| 12 | Agendamento avulso pago (R$ 60) | `platform_fee = 1.20` |
| 13 | Stripe → Connect → conta da barbearia | Saldo de R$ 58,80 |

**Simular renovação** (Stripe CLI):

```bash
stripe trigger invoice.payment_succeeded
```

Confirme que `sessions_used` voltou a zero e que um novo registro
entrou em `platform_earnings`.

---

## 12. Checklist de erros a evitar

- [ ] Trial **sem** coletar cartão → no 31º dia não há como cobrar
- [ ] Webhook com payload "thin" → `event.data.object` vem vazio
- [ ] Dois destinos de webhook na mesma URL → processamento duplicado
- [ ] Deploy do webhook **sem** `--no-verify-jwt` → 401 em todo evento
- [ ] `sessions_used` não zerar na renovação → cliente paga e não agenda
- [ ] `consume_subscription_session` sem `FOR UPDATE` → saldo negativo
- [ ] Cancelar assinatura no primeiro `payment_failed` → churn evitável
- [ ] `application_fee` só na primeira cobrança → perde 2% das renovações
- [ ] Barbearia sem Connect → checkout deve cair na plataforma, **não dar erro**
- [ ] `tenant_id` vindo do body em vez do profile → vazamento entre contas
- [ ] Listar produtos sem filtrar `metadata.app` → mistura os dois produtos
