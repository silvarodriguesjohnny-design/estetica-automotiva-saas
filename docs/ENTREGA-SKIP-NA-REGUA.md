# Entrega para a IA do Skip — na régua

> ⚠️ **Segredos removidos deste arquivo de propósito.**
> As chaves reais nunca devem viver no repositório — o GitHub bloqueia
> o push justamente para impedir isso. Envie-as ao Skip por canal
> privado e configure via `supabase secrets set`, nunca em arquivo
> versionado. Onde você lê `COLE_AQUI`, substitua no momento de rodar.



> Tudo que já está pronto do lado do Stripe, mais o que precisa ser
> implementado. A especificação técnica completa está em
> `ESPECIFICACAO-STRIPE-BARBEARIA.md` — este arquivo é o resumo
> executivo e os valores concretos.

---

## ✅ O que já está configurado no Stripe

Ambiente: **Sandbox "Na Regua"** (`acct_1U76M0KWb4rRtejT`), totalmente
separada do outro produto do portfólio.

| Item | Status |
|---|---|
| Sandbox dedicada | ✅ criada |
| Stripe Connect | ✅ ativo |
| 3 produtos + preços | ✅ criados com trial de 30 dias |
| Webhook | ✅ criado, Active, snapshot, 8 eventos |

### Webhook

```
Nome           : na regua
Destination ID : we_1U76mHKWb4rRtejTFIGMu2zg
URL            : https://xjfzaanptzgojdnvirvg.supabase.co/functions/v1/stripe-webhook
Escopo         : Your account
Payload style  : Snapshot
API version    : 2026-07-29.dahlia
Eventos        : 8
```

Eventos assinados:

```
account.updated
checkout.session.completed
customer.subscription.created
customer.subscription.deleted
customer.subscription.trial_will_end
customer.subscription.updated
invoice.payment_failed
invoice.payment_succeeded
```

---

## 🔑 Secrets para configurar no Supabase

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_COLE_AQUI_A_CHAVE
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_COLE_AQUI_O_SIGNING_SECRET
supabase secrets set APP_URL=https://DOMINIO-DO-NA-REGUA
```

> `APP_URL` precisa ser preenchido com o domínio real da aplicação —
> é para onde o Stripe redireciona depois do checkout e do onboarding
> do Connect.

---

## 💰 Planos (já criados no Stripe)

```ts
// src/config/plans.ts
export const TRIAL_DAYS = 30

export const STRIPE_PRICE_IDS_TEST = {
  essential: 'price_1U76PvKWb4rRtejTp0DM4SjX',
  pro:       'price_1U76PwKWb4rRtejTHuizF5xd',
  elite:     'price_1U76PxKWb4rRtejT0yvNfJGE',
}

export const PLANS = [
  {
    id: 'essential', name: 'Essential', price: 97.90,
    priceId: 'price_1U76PvKWb4rRtejTp0DM4SjX',
    productId: 'prod_V7L6KezpjIAT7N',
    maxBarbers: 2, commissionPct: 2, badge: null,
    features: [
      'Agendamento automatizado',
      'CRM de clientes',
      'Controle financeiro básico',
      '2 barbeiros inclusos',
    ],
  },
  {
    id: 'pro', name: 'Pro', price: 117.90,
    priceId: 'price_1U76PwKWb4rRtejTHuizF5xd',
    productId: 'prod_V7L60wrinXoko7',
    maxBarbers: 3, commissionPct: 2, badge: 'Mais Popular',
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
    productId: 'prod_V7L61kgsu1VJrU',
    maxBarbers: null, commissionPct: 2, badge: null,
    features: [
      'Tudo do Pro',
      'Barbeiros ilimitados',
      'Gestão multi-unidades',
      'Suporte prioritário',
      'White-label',
    ],
  },
]
```

---

## 🛠 O que precisa ser implementado

Detalhamento completo em `ESPECIFICACAO-STRIPE-BARBEARIA.md`.

### 1. Migrations SQL (seções 4.1 a 4.4)

- Campos Connect na tabela de barbearias
- Tabela `plan_commissions` (2% para os três planos)
- Tabela `platform_earnings` (extrato de comissões)
- Tabela `customer_subscriptions` (assinaturas dos clientes finais)
- Tabela `subscription_usage` (auditoria de uso das sessões)

### 2. Funções SQL (seção 5)

- `get_tenant_commission(tenant_id)` — resolve a taxa vigente
- `consume_subscription_session(sub_id, appointment_id)` — **com `FOR UPDATE`**
- `get_active_subscription(tenant_id, customer_id)`

### 3. Edge Functions (seção 6)

| Função | Deploy |
|---|---|
| `stripe-connect` | normal |
| `stripe-checkout` | normal |
| `stripe-webhook` | **`--no-verify-jwt`** ⚠️ |

### 4. RLS da agenda pública (seção 8)

Cliente final não tem login — acessa com a chave anônima.

### 5. Interface

- Aba "Pagamentos" nas configurações, com onboarding Connect
- Agenda pública: identificação por CPF, uso de crédito de assinatura
- Validação de limite de barbeiros por plano

---

## ⚠️ Regras que não podem ser violadas

**1. Colete o cartão no trial.**
`payment_method_collection: 'always'`. Sem isso, no 31º dia não há
como cobrar — o cliente perde o acesso e a venda se perde. A landing
diz "sem cartão de crédito"; esse texto precisa mudar junto para
*"30 dias grátis. Nada é cobrado hoje. Cancele quando quiser."*

**2. Comissão de 2% em toda transação do cliente final**, inclusive
nas renovações das assinaturas. Use `application_fee_percent` dentro
de `subscription_data`, não só no primeiro pagamento.

**3. `consume_subscription_session` com `SELECT ... FOR UPDATE`.**
Sem a trava, dois agendamentos simultâneos gastam a mesma sessão.

**4. Zerar `sessions_used` na renovação.** Em
`invoice.payment_succeeded` com `billing_reason = 'subscription_cycle'`.
Sem isso, o cliente paga o segundo mês e não consegue agendar.

**5. Barbearia sem Connect não pode gerar erro.** Se
`stripe_charges_enabled` for falso, o pagamento cai na plataforma e
fica registrado como pendente de repasse. O cliente final nunca vê
falha por configuração que o dono não fez.

**6. `tenant_id` sempre do profile autenticado**, nunca do body da
requisição — senão vaza dado entre barbearias.

**7. MCC do Connect: `7230`** (Barber and Beauty Shops).

**8. Sempre responder 200 no webhook**, mesmo em erro interno. Retornar
500 faz o Stripe entrar em loop de retry por um problema que é seu.

---

## 🧪 Roteiro de teste

Cartão: `4242 4242 4242 4242` · validade futura · CVC qualquer

| # | Ação | Esperado |
|---|---|---|
| 1 | Criar conta no plano Pro | Checkout abre e **pede cartão** |
| 2 | Pagar com cartão de teste | Dashboard; `subscription_type = 'trial'` |
| 3 | Conferir no Stripe | Subscription `trialing`, cobrança em 30 dias |
| 4 | Configurações → Pagamentos → Conectar | Onboarding Express abre |
| 5 | Completar cadastro Connect | `stripe_account_status = 'active'` |
| 6 | Criar plano "4 cortes/mês — R$ 120" | Aparece na agenda pública |
| 7 | Agenda pública → CPF novo → assinar | Checkout recorrente abre |
| 8 | Pagar | `customer_subscriptions.status = 'active'`, `sessions_used = 1` |
| 9 | Conferir `platform_earnings` | `platform_fee = 2.40` |
| 10 | Voltar com o **mesmo CPF** | "Você tem 3 sessões" |
| 11 | Agendar com a assinatura | Sem cobrança; `sessions_used = 2` |
| 12 | Agendamento avulso R$ 60 | `platform_fee = 1.20` |
| 13 | Stripe → Connect → conta da barbearia | Saldo R$ 58,80 |

Simular renovação:

```bash
stripe trigger invoice.payment_succeeded
```

Confirme que `sessions_used` voltou a zero e que entrou um novo
registro em `platform_earnings`.

---

## 📎 Checklist de erros já vividos

Estes onze pontos custaram retrabalho no produto irmão. Vale conferir
cada um antes de dar a implementação como concluída.

- [ ] Trial sem coletar cartão
- [ ] Webhook com payload "thin" → `event.data.object` vazio
- [ ] Dois destinos de webhook na mesma URL → processamento duplicado
- [ ] Deploy do webhook sem `--no-verify-jwt` → 401 em todo evento
- [ ] `sessions_used` não zera na renovação
- [ ] `consume_subscription_session` sem `FOR UPDATE`
- [ ] Cancelar assinatura no primeiro `payment_failed`
- [ ] `application_fee` só na primeira cobrança
- [ ] Barbearia sem Connect gerando erro no checkout
- [ ] `tenant_id` vindo do body em vez do profile
- [ ] Listar produtos sem filtrar `metadata.app = 'na-regua'`
