#!/usr/bin/env node
/**
 * ============================================================
 * SETUP DOS PRODUTOS STRIPE — na régua (barbearias)
 * ============================================================
 *
 * Segundo produto do portfólio, em ambiente TOTALMENTE SEGREGADO.
 *
 *   Sandbox   : "na regua"  (própria, separada da estética)
 *   metadata  : app = 'na-regua'
 *   lookup_key: 'nrg_*'
 *   webhook   : projeto Supabase do Skip
 *
 * ⚠️  RODE COM A CHAVE DA SANDBOX DO NA RÉGUA.
 * Cada sandbox tem sk_test_ próprio. Usar a chave do outro produto
 * cria os planos no lugar errado.
 *
 * Como criar a sandbox:
 *   Dashboard → seletor de conta (topo esquerdo) → Sandboxes
 *   → Create sandbox → nome "na regua" 
 *
 * ------------------------------------------------------------
 * COMO RODAR
 * ------------------------------------------------------------
 *   npm install stripe
 *   set STRIPE_SECRET_KEY=sk_test_SUA_CHAVE
 *   node scripts/setup-stripe-barbearia.mjs
 *
 * IDEMPOTENTE: rodar de novo não duplica nada.
 * ============================================================
 */

import Stripe from 'stripe'

const KEY = process.env.STRIPE_SECRET_KEY
if (!KEY) {
  console.error('\n❌ Falta STRIPE_SECRET_KEY.\n')
  console.error('   set STRIPE_SECRET_KEY=sk_test_...\n')
  process.exit(1)
}

const isTest = KEY.startsWith('sk_test_')
const stripe = new Stripe(KEY, { apiVersion: '2023-10-16' })

const APP = 'na-regua'
const PREFIX = 'nrg'
const TRIAL_DAYS = 30          // a landing do na régua promete 30 dias
const COMMISSION_PCT = 2       // mesma taxa do outro produto

const PLANS = [
  {
    id: 'essential',
    name: 'na régua — Essential',
    description: 'Agendamento automatizado, CRM de clientes, controle financeiro básico e 2 barbeiros inclusos.',
    amount: 9790,              // R$ 97,90
    maxBarbers: 2,
  },
  {
    id: 'pro',
    name: 'na régua — Pro',
    description: 'Tudo do Essential, programa de fidelidade, campanhas automatizadas, relatórios avançados e 3 barbeiros inclusos.',
    amount: 11790,             // R$ 117,90
    maxBarbers: 3,
  },
  {
    id: 'elite',
    name: 'na régua — Elite',
    description: 'Tudo do Pro, barbeiros ilimitados, gestão multi-unidades, suporte prioritário e white-label.',
    amount: 29790,             // R$ 297,90
    maxBarbers: null,          // ilimitado
  },
]

const brl = c => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

async function findPrice(lookupKey) {
  const { data } = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1, active: true })
  return data[0] ?? null
}

async function findProduct(planId) {
  const { data } = await stripe.products.search({
    query: `metadata['plan_id']:'${planId}' AND metadata['app']:'${APP}' AND active:'true'`,
    limit: 1,
  })
  return data[0] ?? null
}

async function main() {
  console.log('\n' + '='.repeat(64))
  console.log(`  SETUP STRIPE — na régua (barbearias)`)
  console.log(`  Modo: ${isTest ? 'TESTE (sandbox)' : '⚠️  PRODUÇÃO (dinheiro real)'}`)
  console.log('='.repeat(64) + '\n')

  if (!isTest) {
    console.log('⚠️  Chave de PRODUÇÃO. Aguardando 5s — Ctrl+C para cancelar.\n')
    await new Promise(r => setTimeout(r, 5000))
  }

  const results = []

  for (const plan of PLANS) {
    const lookupKey = `${PREFIX}_${plan.id}_monthly`
    console.log(`▸ ${plan.name}`)

    const meta = {
      plan_id: plan.id,
      app: APP,
      commission_pct: String(COMMISSION_PCT),
      max_barbers: plan.maxBarbers === null ? 'unlimited' : String(plan.maxBarbers),
    }

    /* ── Product ── */
    let product = await findProduct(plan.id)
    if (product) {
      product = await stripe.products.update(product.id, {
        name: plan.name, description: plan.description, metadata: meta,
      })
      console.log(`  Product   ↻ atualizado (${product.id})`)
    } else {
      product = await stripe.products.create({
        name: plan.name, description: plan.description, metadata: meta,
      })
      console.log(`  Product   ✓ criado (${product.id})`)
    }

    /* ── Price ── */
    let price = await findPrice(lookupKey)

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
        recurring: { interval: 'month', trial_period_days: TRIAL_DAYS },
        lookup_key: lookupKey,
        nickname: `${plan.name} — mensal`,
        metadata: meta,
      })
      console.log(`  Price     ✓ criado (${price.id}) — ${brl(plan.amount)}/mês`)
    }

    console.log(`  Trial     ✓ ${TRIAL_DAYS} dias grátis`)
    console.log(`  Barbeiros ✓ ${plan.maxBarbers ?? 'ilimitados'}`)
    console.log(`  Comissão  ✓ ${COMMISSION_PCT}% sobre vendas dos clientes\n`)

    results.push({ ...plan, productId: product.id, priceId: price.id, lookupKey })
  }

  /* ── Saída ── */
  console.log('='.repeat(64))
  console.log('  ENTREGUE ISTO À IA DO SKIP')
  console.log('='.repeat(64) + '\n')

  const varName = isTest ? 'STRIPE_PRICE_IDS_TEST' : 'STRIPE_PRICE_IDS_LIVE'
  console.log(`export const ${varName} = {`)
  results.forEach(r => console.log(`  ${r.id}: '${r.priceId}',`))
  console.log('}\n')

  console.log('Detalhamento:\n')
  results.forEach(r => {
    console.log(`  ${r.id}`)
    console.log(`    product_id : ${r.productId}`)
    console.log(`    price_id   : ${r.priceId}`)
    console.log(`    lookup_key : ${r.lookupKey}`)
    console.log(`    valor      : ${brl(r.amount)}/mês`)
    console.log(`    barbeiros  : ${r.maxBarbers ?? 'ilimitados'}`)
    console.log('')
  })

  console.log('─'.repeat(64))
  console.log(`
PRÓXIMOS PASSOS

  1. Webhook do na régua (separado do Auto Estética Flow):
     Stripe → Developers → Webhooks → Add endpoint

     URL:  https://SEU-PROJETO-SKIP.supabase.co/functions/v1/stripe-webhook

     ⚠️  Estilo de carga útil: INSTANTÂNEO (snapshot), nunca "thin"
     ⚠️  Escopo: "Sua conta"
     ⚠️  Crie apenas UM destino

     Eventos:
       checkout.session.completed
       customer.subscription.created
       customer.subscription.updated
       customer.subscription.deleted
       customer.subscription.trial_will_end
       invoice.payment_succeeded
       invoice.payment_failed
       account.updated

  2. Copie o Signing secret (whsec_...) desse endpoint — ele é
     DIFERENTE do webhook do Auto Estética Flow.

  3. No projeto Supabase do Skip, configure os secrets:
       STRIPE_SECRET_KEY      (a mesma chave da conta)
       STRIPE_WEBHOOK_SECRET  (o whsec_ do passo 2)
       APP_URL                (domínio do na régua)

  4. Entregue à IA do Skip o arquivo:
       docs/ESPECIFICACAO-STRIPE-BARBEARIA.md
`)
}

main().catch(err => {
  console.error('\n❌ Erro:', err.message)
  if (err.raw?.message) console.error('   Stripe:', err.raw.message)
  process.exit(1)
})
