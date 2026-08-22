# Diagnóstico e complemento — v0.0.91

> **Não refaça nada.** O que você entregou está bom. Este documento
> serve para (1) confirmar o que realmente foi aplicado no banco e
> (2) fechar as lacunas que você mesmo apontou como não confirmadas.

---

## Parte 1 — Rode este diagnóstico primeiro

Execute no SQL Editor do Supabase e **me devolva a saída completa**.
Nenhuma dessas queries altera nada, são só leitura.

```sql
-- ═══ 1. Tabelas que existem ═══
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'stripe_connect_accounts','platform_earnings',
    'customer_subscriptions','subscription_usage','plan_commissions'
  )
ORDER BY table_name;

-- ═══ 2. Funções que existem ═══
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'get_tenant_commission','consume_subscription_session',
    'get_active_subscription'
  )
ORDER BY routine_name;

-- ═══ 3. RLS ligado nas novas tabelas? ═══
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'stripe_connect_accounts','platform_earnings',
    'customer_subscriptions','subscription_usage'
  );

-- ═══ 4. Políticas existentes ═══
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'stripe_connect_accounts','platform_earnings',
    'customer_subscriptions','subscription_usage',
    'appointments','customers','services'
  )
ORDER BY tablename, policyname;

-- ═══ 5. Código da função crítica (a que trava a linha) ═══
SELECT prosrc
FROM pg_proc
WHERE proname = 'consume_subscription_session';

-- ═══ 6. Colunas de customer_subscriptions ═══
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'customer_subscriptions'
ORDER BY ordinal_position;

-- ═══ 7. Onde ficaram os campos Connect ═══
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'stripe_connect_accounts'
ORDER BY ordinal_position;
```

---

## Parte 2 — Divergência estrutural (não é erro, precisa alinhar)

Minha especificação colocava os campos do Connect **na tabela de
barbearias**. Você criou uma tabela separada `stripe_connect_accounts`.

**Sua escolha está correta** — é mais normalizada e permite histórico
de contas. Não mude.

Mas isso significa que os trechos de SQL que passei precisam de ajuste.
Especificamente, `get_tenant_commission` na minha versão lia
`tenants.commission_pct_override`. Adapte assim:

```sql
CREATE OR REPLACE FUNCTION get_tenant_commission(p_tenant_id uuid)
RETURNS NUMERIC AS $$
DECLARE
  v_override NUMERIC;
  v_plan     TEXT;
  v_pct      NUMERIC;
BEGIN
  -- Ajuste os nomes conforme SEU schema real.
  -- O importante é a precedência, não onde os campos moram.
  SELECT commission_pct_override, plan_type
    INTO v_override, v_plan
    FROM tenants          -- ou barbershops, ou o nome que você usou
   WHERE id = p_tenant_id;

  IF v_override IS NOT NULL THEN RETURN v_override; END IF;

  SELECT commission_pct INTO v_pct
    FROM plan_commissions WHERE plan_type = v_plan;

  RETURN COALESCE(v_pct, 2.00);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

Se `commission_pct_override` não existe ainda, crie:

```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS commission_pct_override NUMERIC(5,2);
```

E garanta que `plan_commissions` existe com os três planos:

```sql
CREATE TABLE IF NOT EXISTS plan_commissions (
  plan_type      TEXT PRIMARY KEY,
  commission_pct NUMERIC(5,2) NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO plan_commissions (plan_type, commission_pct)
VALUES ('essential', 2.00), ('pro', 2.00), ('elite', 2.00)
ON CONFLICT (plan_type) DO UPDATE
  SET commission_pct = EXCLUDED.commission_pct, updated_at = now();

ALTER TABLE plan_commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_plan_commissions" ON plan_commissions;
CREATE POLICY "read_plan_commissions" ON plan_commissions
  FOR SELECT USING (true);
```

---

## Parte 3 — As três lacunas críticas

Você marcou estas como "pode não estar implementado". São exatamente
as que causam corrupção silenciosa de dados — o sistema parece
funcionar e o problema só aparece semanas depois, no faturamento.

### 3.1 `consume_subscription_session` sem `FOR UPDATE`

**O que acontece sem a trava:** dois agendamentos simultâneos leem
`sessions_used = 3` ao mesmo tempo, ambos verificam que há saldo,
ambos gravam `4`. O cliente usou 5 sessões e o sistema registrou 4.
Em produção isso vira prejuízo direto para a barbearia.

Rode a query 5 do diagnóstico. Se o `prosrc` **não contiver**
`FOR UPDATE`, substitua a função inteira por esta:

```sql
CREATE OR REPLACE FUNCTION consume_subscription_session(
  p_subscription_id uuid,
  p_appointment_id  uuid DEFAULT NULL
) RETURNS boolean AS $$
DECLARE
  v_sub customer_subscriptions%ROWTYPE;
BEGIN
  -- FOR UPDATE trava a linha até o fim da transação.
  -- É isto que impede duas requisições simultâneas de gastar
  -- a mesma sessão.
  SELECT * INTO v_sub
    FROM customer_subscriptions
   WHERE id = p_subscription_id
     FOR UPDATE;

  IF NOT FOUND OR v_sub.status <> 'active' THEN
    RETURN FALSE;
  END IF;

  -- Ciclo vencido → zera antes de consumir
  IF v_sub.cycle_end IS NOT NULL AND v_sub.cycle_end < now() THEN
    UPDATE customer_subscriptions
       SET sessions_used = 0,
           cycle_start   = now(),
           cycle_end     = now() + CASE interval
             WHEN 'monthly'   THEN INTERVAL '1 month'
             WHEN 'quarterly' THEN INTERVAL '3 months'
             WHEN 'yearly'    THEN INTERVAL '1 year'
             ELSE INTERVAL '1 month' END
     WHERE id = p_subscription_id;
    v_sub.sessions_used := 0;
  END IF;

  IF v_sub.sessions_total IS NOT NULL
     AND COALESCE(v_sub.sessions_used, 0) >= v_sub.sessions_total THEN
    RETURN FALSE;   -- saldo esgotado neste ciclo
  END IF;

  UPDATE customer_subscriptions
     SET sessions_used = COALESCE(sessions_used, 0) + 1,
         updated_at    = now()
   WHERE id = p_subscription_id;

  INSERT INTO subscription_usage
    (subscription_id, tenant_id, appointment_id, cycle_start)
  VALUES
    (p_subscription_id, v_sub.tenant_id, p_appointment_id, v_sub.cycle_start);

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

> Ajuste os nomes de coluna se o seu schema divergir. O que **não**
> pode mudar: o `FOR UPDATE`, a verificação de saldo antes do UPDATE,
> e o retorno `FALSE` quando esgota.

**Teste para provar que funciona** — rode em duas abas do SQL Editor
ao mesmo tempo:

```sql
-- Aba 1
BEGIN;
SELECT consume_subscription_session('UUID-DE-UMA-ASSINATURA-ATIVA');
-- não faça COMMIT ainda

-- Aba 2 (enquanto a 1 está aberta)
SELECT consume_subscription_session('MESMO-UUID');
-- Deve FICAR TRAVADA esperando. Se responder na hora,
-- o FOR UPDATE não está funcionando.

-- Volte na Aba 1 e rode: COMMIT;
-- A Aba 2 destrava e retorna.
```

### 3.2 `sessions_used` não zera na renovação

**O que acontece:** o cliente paga o segundo mês e continua sem poder
agendar, porque `sessions_used` ficou em 4 de 4. Ele vai reclamar no
primeiro dia do ciclo novo.

No handler de `invoice.payment_succeeded` do `stripe-webhook`,
confirme que existe algo equivalente a:

```ts
case 'invoice.payment_succeeded': {
  const inv = event.data.object
  if (!inv.subscription) break

  const sub = await stripe.subscriptions.retrieve(inv.subscription)

  if (sub.metadata?.customer_subscription_id) {
    // ⚠️ SÓ renova a partir da SEGUNDA cobrança.
    // A primeira é a da contratação, e o ciclo já foi criado
    // no checkout.session.completed. Sem esta condição, o saldo
    // zera duas vezes no primeiro mês.
    if (inv.billing_reason === 'subscription_cycle') {
      await supabase.from('customer_subscriptions').update({
        status: 'active',
        sessions_used: 0,                                        // ← zera
        cycle_start: new Date(sub.current_period_start * 1000).toISOString(),
        cycle_end:   new Date(sub.current_period_end   * 1000).toISOString(),
        updated_at:  new Date().toISOString(),
      }).eq('id', sub.metadata.customer_subscription_id)

      // Registra a comissão da renovação — sem isto você perde
      // 2% de todas as renovações no relatório
      const { data: cs } = await supabase
        .from('customer_subscriptions')
        .select('tenant_id, commission_pct')
        .eq('id', sub.metadata.customer_subscription_id)
        .maybeSingle()

      if (cs) {
        const gross = (inv.amount_paid ?? 0) / 100
        const pct   = Number(cs.commission_pct ?? 2)
        const fee   = gross * (pct / 100)
        await supabase.from('platform_earnings').insert({
          tenant_id: cs.tenant_id,
          stripe_payment_intent: inv.payment_intent ?? null,
          gross_amount: gross,
          commission_pct: pct,
          platform_fee: fee,
          tenant_amount: gross - fee,
          status: 'paid',
          paid_at: new Date().toISOString(),
        })
      }
    }
    break
  }

  /* ... resto do handler para a assinatura do SaaS ... */
}
```

### 3.3 RLS da agenda pública

**O que acontece sem isso:** o cliente final não consegue agendar.
A tela carrega, ele preenche tudo, e o INSERT falha silenciosamente
ou retorna erro de permissão.

O cliente final **não tem login** — acessa com a chave anônima.
Confira com a query 4 do diagnóstico se estas políticas existem:

```sql
-- Leitura pública
DROP POLICY IF EXISTS "public_read_tenant" ON tenants;
CREATE POLICY "public_read_tenant" ON tenants
  FOR SELECT TO anon USING (is_active = true);

DROP POLICY IF EXISTS "public_read_services" ON services;
CREATE POLICY "public_read_services" ON services
  FOR SELECT TO anon USING (is_active = true);

DROP POLICY IF EXISTS "public_read_barbers" ON barbers;
CREATE POLICY "public_read_barbers" ON barbers
  FOR SELECT TO anon USING (is_active = true);

DROP POLICY IF EXISTS "public_read_plans" ON subscription_plans;
CREATE POLICY "public_read_plans" ON subscription_plans
  FOR SELECT TO anon USING (is_active = true);

-- Cliente cria o próprio cadastro
DROP POLICY IF EXISTS "public_insert_customer" ON customers;
CREATE POLICY "public_insert_customer" ON customers
  FOR INSERT TO anon WITH CHECK (true);

-- Cliente busca o próprio cadastro pelo CPF
DROP POLICY IF EXISTS "public_read_own_customer" ON customers;
CREATE POLICY "public_read_own_customer" ON customers
  FOR SELECT TO anon USING (cpf_cnpj IS NOT NULL);

-- Cria o agendamento
DROP POLICY IF EXISTS "public_insert_appointment" ON appointments;
CREATE POLICY "public_insert_appointment" ON appointments
  FOR INSERT TO anon WITH CHECK (status = 'pending');

-- Lê horários ocupados (para bloquear slots)
DROP POLICY IF EXISTS "public_read_busy_slots" ON appointments;
CREATE POLICY "public_read_busy_slots" ON appointments
  FOR SELECT TO anon
  USING (status IN ('pending','confirmed','in_progress'));

-- Consulta assinatura ativa
DROP POLICY IF EXISTS "public_read_active_subs" ON customer_subscriptions;
CREATE POLICY "public_read_active_subs" ON customer_subscriptions
  FOR SELECT TO anon USING (status = 'active');

-- Registra o uso da sessão
DROP POLICY IF EXISTS "public_insert_sub_usage" ON subscription_usage;
CREATE POLICY "public_insert_sub_usage" ON subscription_usage
  FOR INSERT TO anon WITH CHECK (true);
```

> **Ressalva de privacidade** que vale registrar: `public_read_own_customer`
> permite que alguém com um CPF de terceiro veja nome e telefone daquele
> cliente. É o mínimo para o "já sou cliente" funcionar hoje. Quando
> houver volume, mova essa busca para uma Edge Function que retorne
> apenas "existe / não existe" e só entregue os dados após validação
> por código no WhatsApp.

---

## Parte 4 — Confirmações rápidas no código

Não precisa reescrever nada. Só confirme e ajuste se estiver diferente.

### 4.1 Cartão coletado no trial

Em `stripe-create-checkout`, no cenário de assinatura do SaaS:

```ts
payment_method_collection: 'always',   // ← obrigatório
subscription_data: {
  trial_period_days: 30,
  trial_settings: {
    end_behavior: { missing_payment_method: 'cancel' },
  },
  metadata: { tenant_id, plan_id, kind: 'saas_subscription' },
}
```

Sem `payment_method_collection: 'always'`, no 31º dia não há como
cobrar. O cliente perde o acesso e a venda evapora.

### 4.2 Comissão em TODA renovação

No cenário de assinatura do cliente final, a taxa precisa estar em
`subscription_data`, não em `payment_intent_data`:

```ts
subscription_data: {
  application_fee_percent: commissionPct,   // ← retém 2% a cada ciclo
  transfer_data: { destination: connectAccountId },
  metadata: {
    appointment_id, tenant_id,
    kind: 'customer_subscription',
    customer_subscription_id: csId,
  },
}
```

Se estiver em `payment_intent_data`, você cobra 2% só da primeira
parcela e perde a comissão de todas as renovações.

### 4.3 Barbearia sem Connect não pode dar erro

```ts
const connected = !!(account?.stripe_account_id && account?.charges_enabled)

if (connected) {
  params.payment_intent_data = {
    application_fee_amount: feeCents,
    transfer_data: { destination: account.stripe_account_id },
  }
}
// Se não conectada: o valor cai na plataforma e fica registrado
// em platform_earnings com status 'pending'. O cliente final
// NUNCA vê erro por causa de configuração que o dono não fez.
```

### 4.4 Deploy do webhook

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

Sem a flag, o Stripe recebe 401 e nenhum evento é processado. Confirme
em Stripe → Webhooks → `na regua` → aba **Event deliveries** se as
entregas estão retornando 200.

### 4.5 `tenant_id` sempre do profile

Em toda Edge Function autenticada, o `tenant_id` deve vir do profile
do usuário logado, **nunca** do body da requisição. Caso contrário
qualquer um consulta ou altera dados de outra barbearia trocando um
campo no JSON.

---

## Parte 5 — Ordem sugerida

1. Rode o diagnóstico da Parte 1 e me devolva a saída
2. Com base nela, aplique só o que estiver faltando
3. Confirme os 5 pontos da Parte 4 no código existente
4. Rode o teste de concorrência da 3.1 (duas abas)
5. Me avise para fazermos o teste de ponta a ponta

**Não recrie tabelas, funções ou componentes que já existem.**
Tudo aqui é `CREATE OR REPLACE`, `IF NOT EXISTS` ou `DROP POLICY IF
EXISTS` justamente para poder rodar em cima do que já está lá sem
perder nada.
