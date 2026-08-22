#!/usr/bin/env node
/**
 * ============================================================
 * SETUP DOS PRODUTOS STRIPE — Auto Estética Flow
 * ============================================================
 *
 * Cria no Stripe os 3 planos do SaaS, cada um com:
 *   • Um Product (o "o quê")
 *   • Um Price recorrente mensal em BRL (o "quanto")
 *   • Trial de 14 dias configurado NO PRÓPRIO PRICE
 *
 * POR QUE UM SCRIPT E NÃO CLICAR NO PAINEL:
 * Clicar funciona uma vez. Um script é reproduzível — você roda
 * igual em sandbox e em produção, versiona junto com o código, e
 * quando precisar mudar preço não depende de ninguém lembrar onde
 * clicou. É a diferença entre configuração e infraestrutura.
 *
 * IDEMPOTENTE: usa lookup_key. Rodar de novo não duplica nada.
 *
 * ------------------------------------------------------------
 * COMO RODAR
 * ------------------------------------------------------------
 *   1. Pegue sua chave de TESTE no Stripe:
 *      Dashboard → Developers → API keys → "Secret key" (sk_test_...)
 *
 *   2. No CMD, dentro de C:\projetos\autodetail:
 *
 *      npm install stripe
 *      set STRIPE_SECRET_KEY=sk_test_SUA_CHAVE
 *      node scripts/setup-stripe.mjs
 *
 *   3. Copie os PRICE IDs que aparecerem no final e cole no
 *      arquivo src/config/plans.ts
 *
 *   Para produção: repita com a chave sk_live_...
 * ============================================================
 */

import Stripe from 'stripe'

const KEY = process.env.STRIPE_SECRET_KEY
if (!KEY) {
  console.error('\n❌ Falta a variável STRIPE_SECRET_KEY.\n')
  console.error('   No CMD:  set STRIPE_SECRET_KEY=sk_test_...')
  console.error('   No bash: export STRIPE_SECRET_KEY=sk_test_...\n')
  process.exit(1)
}

const isTest = KEY.startsWith('sk_test_')
const stripe = new Stripe(KEY, { apiVersion: '2023-10-16' })

const TRIAL_DAYS = 14

/** Os 3 planos. Alterar preço aqui e rodar de novo cria um Price novo
 *  (o Stripe não deixa editar preço — é imutável por design, para não
 *  bagunçar assinaturas existentes). */
const PLANS = [
  {
    id: 'starter',
    name: 'Auto Estética Flow — Padrão',
    description: 'Até 2 serviços, clientes ilimitados, ordens de serviço, WhatsApp integrado e agenda pública.',
    amount: 9733,          // centavos → R$ 97,33
    commissionPct: 2,      // % que a plataforma retém em vendas dos clientes
  },
  {
    id: 'pro',
    name: 'Auto Estética Flow — Especialista',
    description: 'Até 4 serviços, campanhas em massa, múltiplos técnicos, combos e assinaturas.',
    amount: 15990,         // R$ 159,90
    commissionPct: 2,
  },
  {
    id: 'enterprise',
    name: 'Auto Estética Flow — Premium',
    description: 'Serviços ilimitados, automações de retenção, controle de estoque e suporte prioritário.',
    amount: 24990,         // R$ 249,90
    commissionPct: 2,
  },
]

const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Busca um Price pelo lookup_key — é assim que garantimos idempotência. */
async function findPrice(lookupKey) {
  const { data } = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1, active: true })
  return data[0] ?? null
}

/** Busca um Product pelos metadados. */
async function findProduct(planId) {
  const { data } = await stripe.products.search({
    query: `metadata['plan_id']:'${planId}' AND active:'true'`,
    limit: 1,
  })
  return data[0] ?? null
}

async function main() {
  console.log('\n' + '='.repeat(62))
  console.log(`  SETUP STRIPE — modo ${isTest ? 'TESTE (sandbox)' : '⚠️  PRODUÇÃO (dinheiro real)'}`)
  console.log('='.repeat(62) + '\n')

  if (!isTest) {
    console.log('⚠️  Você está usando uma chave de PRODUÇÃO.')
    console.log('   Aguardando 5 segundos — Ctrl+C para cancelar.\n')
    await new Promise(r => setTimeout(r, 5000))
  }

  const results = []

  for (const plan of PLANS) {
    const lookupKey = `aef_${plan.id}_monthly`
    console.log(`▸ ${plan.name}`)

    /* ── Product ── */
    let product = await findProduct(plan.id)
    if (product) {
      console.log(`  Product   ↻ já existe (${product.id})`)
      // Mantém nome e descrição atualizados
      product = await stripe.products.update(product.id, {
        name: plan.name,
        description: plan.description,
        metadata: {
          plan_id: plan.id,
          commission_pct: String(plan.commissionPct),
          app: 'auto-estetica-flow',
        },
      })
    } else {
      product = await stripe.products.create({
        name: plan.name,
        description: plan.description,
        metadata: {
          plan_id: plan.id,
          commission_pct: String(plan.commissionPct),
          app: 'auto-estetica-flow',
        },
      })
      console.log(`  Product   ✓ criado (${product.id})`)
    }

    /* ── Price ── */
    let price = await findPrice(lookupKey)

    // Se o valor mudou, o Price antigo é arquivado e um novo é criado.
    // Assinaturas existentes continuam no preço antigo — comportamento
    // correto: ninguém tem reajuste sem aviso.
    if (price && price.unit_amount !== plan.amount) {
      console.log(`  Price     ⚠ valor mudou ${brl(price.unit_amount)} → ${brl(plan.amount)}`)
      await stripe.prices.update(price.id, { active: false, lookup_key: null })
      price = null
    }

    if (price) {
      console.log(`  Price     ↻ já existe (${price.id}) — ${brl(price.unit_amount)}/mês`)
    } else {
      price = await stripe.prices.create({
        product: product.id,
        currency: 'brl',
        unit_amount: plan.amount,
        recurring: {
          interval: 'month',
          trial_period_days: TRIAL_DAYS,   // ← o trial vive aqui
        },
        lookup_key: lookupKey,
        nickname: `${plan.name} — mensal`,
        metadata: { plan_id: plan.id },
      })
      console.log(`  Price     ✓ criado (${price.id}) — ${brl(plan.amount)}/mês`)
    }

    console.log(`  Trial     ✓ ${TRIAL_DAYS} dias grátis`)
    console.log(`  Comissão  ✓ ${plan.commissionPct}% sobre agendamentos pagos\n`)

    results.push({ ...plan, productId: product.id, priceId: price.id, lookupKey })
  }

  /* ── Saída para colar no código ── */
  console.log('='.repeat(62))
  console.log('  COLE ISTO EM  src/config/plans.ts')
  console.log('='.repeat(62) + '\n')

  const varName = isTest ? 'STRIPE_PRICE_IDS_TEST' : 'STRIPE_PRICE_IDS_LIVE'
  console.log(`export const ${varName} = {`)
  results.forEach(r => console.log(`  ${r.id}: '${r.priceId}',`))
  console.log('}\n')

  console.log('Resumo:')
  results.forEach(r => {
    console.log(`  ${r.id.padEnd(11)} ${brl(r.amount).padStart(11)}/mês   comissão ${String(r.commissionPct).padStart(2)}%`)
  })

  console.log('\n' + '─'.repeat(62))
  console.log('PRÓXIMOS PASSOS')
  console.log('─'.repeat(62))
  console.log(`
  1. Cole os price IDs em src/config/plans.ts

  2. Habilite o Stripe Connect (necessário para a comissão):
     Dashboard → Connect → Get started → escolha "Platform or marketplace"

  3. Configure o webhook:
     Dashboard → Developers → Webhooks → Add endpoint

     URL:
       https://rhaqclcahecpfyzvzdzm.supabase.co/functions/v1/stripe-webhook

     Eventos:
       checkout.session.completed
       customer.subscription.created
       customer.subscription.updated
       customer.subscription.deleted
       customer.subscription.trial_will_end
       invoice.payment_succeeded
       invoice.payment_failed
       account.updated

  4. Copie o "Signing secret" (whsec_...) e rode:
       npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
`)
}

main().catch(err => {
  console.error('\n❌ Erro:', err.message)
  if (err.raw?.message) console.error('   Stripe:', err.raw.message)
  process.exit(1)
})
