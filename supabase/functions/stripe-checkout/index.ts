/**
 * Edge Function: stripe-checkout
 *
 * Cria Checkout Sessions em três cenários distintos:
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │ A) SaaS — a estética assina o sistema                     │
 * │    Dinheiro: 100% para a plataforma                       │
 * │    Trial de 14 dias                                       │
 * │    body: { tenant_id, plan_id, customer_email }           │
 * ├──────────────────────────────────────────────────────────┤
 * │ B) Agendamento — cliente final paga a estética            │
 * │    Destination charge: dinheiro vai para a conta          │
 * │    Connect da estética, com application_fee retida        │
 * │    body: { orderId, tenantId }                            │
 * ├──────────────────────────────────────────────────────────┤
 * │ C) Assinatura de combo — cliente final assina um plano    │
 * │    da estética (ex: 4 lavagens/mês)                       │
 * │    Mesmo modelo de B, mas recorrente                      │
 * │    body: { orderId, tenantId, mode:'subscription' }       │
 * └──────────────────────────────────────────────────────────┘
 *
 * FALLBACK IMPORTANTE:
 * Se a estética ainda não conectou o Stripe, o pagamento cai na
 * conta da plataforma e fica registrado como pendente de repasse.
 * Assim o cliente final nunca vê erro por causa de configuração
 * que o dono da estética não fez.
 *
 * Deploy:
 *   npx supabase functions deploy stripe-checkout
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const TRIAL_DAYS = 14

/** Preços do SaaS quando não há Price ID configurado. */
const PLAN_FALLBACK: Record<string, { amount: number; label: string }> = {
  starter:    { amount: 9733,  label: 'Padrão' },
  pro:        { amount: 15990, label: 'Especialista' },
  enterprise: { amount: 24990, label: 'Premium' },
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeKey) return json({ error: 'STRIPE_SECRET_KEY não configurada' }, 500)

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })
    const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '')

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json()

    /* ══════════════════════════════════════════════════════════
       CENÁRIO A — Assinatura do SaaS (com trial de 14 dias)
       ══════════════════════════════════════════════════════════ */
    if (body.tenant_id && body.plan_id && !body.orderId) {
      const { tenant_id, plan_id, customer_email, price_id, success_url, cancel_url } = body

      const { data: tenant } = await admin
        .from('tenants').select('id, name, email, stripe_customer_id').eq('id', tenant_id).maybeSingle()

      if (!tenant) return json({ error: 'Empresa não encontrada' }, 404)

      const fallback = PLAN_FALLBACK[plan_id] ?? PLAN_FALLBACK.starter

      /* Reaproveita o Customer para não duplicar cadastro na Stripe */
      let customerId = tenant.stripe_customer_id
      if (!customerId) {
        const c = await stripe.customers.create({
          email: customer_email ?? tenant.email ?? undefined,
          name: tenant.name,
          metadata: { tenant_id, app: 'auto-estetica-flow' },
        })
        customerId = c.id
        await admin.from('tenants').update({ stripe_customer_id: customerId }).eq('id', tenant_id)
      }

      /* Price ID real (do script de setup) ou price_data inline */
      const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = price_id
        ? { price: price_id, quantity: 1 }
        : {
            price_data: {
              currency: 'brl',
              recurring: { interval: 'month' },
              product_data: {
                name: `Auto Estética Flow — ${fallback.label}`,
                description: `Assinatura mensal · ${TRIAL_DAYS} dias grátis`,
              },
              unit_amount: body.amount ?? fallback.amount,
            },
            quantity: 1,
          }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [lineItem],
        subscription_data: {
          trial_period_days: TRIAL_DAYS,
          metadata: { tenant_id, plan_id, kind: 'saas_subscription' },
          trial_settings: {
            // Se o cartão falhar no fim do trial, cancela em vez de
            // deixar a assinatura pendurada gerando cobrança fantasma.
            end_behavior: { missing_payment_method: 'cancel' },
          },
        },
        payment_method_collection: 'always',
        metadata: { tenant_id, plan_id, kind: 'saas_subscription' },
        success_url: success_url ?? `${appUrl}/dashboard?welcome=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  cancel_url  ?? `${appUrl}/onboarding?plan=${plan_id}`,
        locale: 'pt-BR',
        allow_promotion_codes: true,
      })

      return json({ url: session.url, session_id: session.id, trialDays: TRIAL_DAYS })
    }

    /* ══════════════════════════════════════════════════════════
       CENÁRIOS B e C — Pagamento de agendamento (marketplace)
       ══════════════════════════════════════════════════════════ */
    const orderId = body.orderId ?? body.order_id
    if (!orderId) return json({ error: 'orderId obrigatório' }, 400)

    const { data: order, error } = await admin
      .from('service_orders')
      .select(`
        id, total_amount, tenant_id, subscription_plan_id,
        customer:customers(name, email, phone),
        tenant:tenants(name, stripe_account_id, stripe_charges_enabled, plan_type),
        plan:subscription_plans(name, interval)
      `)
      .eq('id', orderId)
      .single()

    if (error || !order) return json({ error: 'Agendamento não encontrado' }, 404)

    const amountCents = body.amount ?? Math.round((order.total_amount ?? 0) * 100)
    if (!amountCents || amountCents < 100) return json({ error: 'Valor inválido' }, 400)

    const tenantRel = order.tenant as {
      name?: string; stripe_account_id?: string | null
      stripe_charges_enabled?: boolean; plan_type?: string
    } | null

    const customerRel = order.customer as { name?: string; email?: string } | null
    const planRel = order.plan as { name?: string; interval?: string } | null

    /* ── Comissão vigente deste tenant ── */
    const { data: pct } = await admin.rpc('get_tenant_commission', { p_tenant_id: order.tenant_id })
    const commissionPct = Number(pct ?? 10)
    const feeCents = Math.round(amountCents * (commissionPct / 100))

    /* ── A estética pode receber direto? ── */
    const connected = !!(tenantRel?.stripe_account_id && tenantRel?.stripe_charges_enabled)

    const isSubscription = body.mode === 'subscription'
      && !!order.subscription_plan_id
      && planRel?.interval !== 'single'

    const itemName = isSubscription
      ? `${planRel?.name ?? 'Assinatura'} — ${tenantRel?.name ?? 'Estética'}`
      : `Agendamento — ${tenantRel?.name ?? 'Estética'}`

    /* ── Intervalo de cobrança do combo ──
       A estética define mensal/trimestral/anual ao criar o combo. */
    const INTERVAL_MAP: Record<string, { interval: 'month' | 'year'; count: number }> = {
      monthly:   { interval: 'month', count: 1 },
      quarterly: { interval: 'month', count: 3 },
      yearly:    { interval: 'year',  count: 1 },
    }
    const recur = INTERVAL_MAP[planRel?.interval ?? 'monthly'] ?? INTERVAL_MAP.monthly

    /* ── Pré-registro da assinatura do cliente final ──
       Criada como 'pending'; o webhook ativa quando o pagamento
       confirmar. Assim nunca existe assinatura ativa sem pagamento. */
    let customerSubId: string | null = null
    if (isSubscription) {
      const { data: cs } = await admin.from('customer_subscriptions').insert({
        tenant_id: order.tenant_id,
        customer_id: (order as { customer_id?: string }).customer_id ?? null,
        plan_id: order.subscription_plan_id,
        vehicle_id: (order as { vehicle_id?: string }).vehicle_id ?? null,
        status: 'pending',
        price: amountCents / 100,
        interval: planRel?.interval ?? 'monthly',
        sessions_total: (order.plan as { sessions?: number } | null)?.sessions ?? null,
        commission_pct: commissionPct,
      }).select('id').single()
      customerSubId = cs?.id ?? null

      if (customerSubId) {
        await admin.from('service_orders')
          .update({ customer_subscription_id: customerSubId })
          .eq('id', order.id).then(() => {}, () => {})
      }
    }

    /* ── Monta a sessão ── */
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: isSubscription ? 'subscription' : 'payment',
      line_items: [{
        price_data: {
          currency: 'brl',
          ...(isSubscription
            ? { recurring: { interval: recur.interval, interval_count: recur.count } }
            : {}),
          product_data: {
            name: itemName,
            description: isSubscription
              ? `Assinatura recorrente${(order.plan as { sessions?: number } | null)?.sessions ? ` · ${(order.plan as { sessions?: number }).sessions} sessões por ciclo` : ''}`
              : `Código ${order.id.slice(0, 8).toUpperCase()}`,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      customer_email: body.customerEmail ?? customerRel?.email ?? undefined,
      metadata: {
        order_id: order.id,
        tenant_id: order.tenant_id,
        commission_pct: String(commissionPct),
        platform_fee: String(feeCents),
        connected: String(connected),
        kind: isSubscription ? 'customer_subscription' : 'booking_payment',
        ...(customerSubId ? { customer_subscription_id: customerSubId } : {}),
      },
      success_url: body.success_url ?? `${appUrl}/agendar/${order.tenant_id}?paid=1&ref=${order.id.slice(0, 8).toUpperCase()}`,
      cancel_url:  body.cancel_url  ?? `${appUrl}/agendar/${order.tenant_id}?cancelled=1`,
      locale: 'pt-BR',
    }

    /* ── Destination charge: só se a estética estiver apta ── */
    if (connected) {
      if (isSubscription) {
        params.subscription_data = {
          application_fee_percent: commissionPct,
          transfer_data: { destination: tenantRel!.stripe_account_id! },
          metadata: {
            order_id: order.id,
            tenant_id: order.tenant_id,
            kind: 'customer_subscription',
            ...(customerSubId ? { customer_subscription_id: customerSubId } : {}),
          },
        }
      } else {
        params.payment_intent_data = {
          application_fee_amount: feeCents,
          transfer_data: { destination: tenantRel!.stripe_account_id! },
          metadata: { order_id: order.id, tenant_id: order.tenant_id },
          description: itemName,
        }
      }
    }
    // Se não estiver conectada, o valor cai na plataforma e fica
    // registrado como pendente de repasse manual (status 'pending').

    const session = await stripe.checkout.sessions.create(params)

    /* ── Pré-registro do ganho, confirmado depois pelo webhook ── */
    await admin.from('platform_earnings').insert({
      tenant_id: order.tenant_id,
      service_order_id: order.id,
      stripe_session_id: session.id,
      stripe_account_id: tenantRel?.stripe_account_id ?? null,
      gross_amount: amountCents / 100,
      commission_pct: commissionPct,
      platform_fee: feeCents / 100,
      tenant_amount: (amountCents - feeCents) / 100,
      status: 'pending',
    }).then(() => {}, () => {})

    await admin.from('service_orders')
      .update({ stripe_session_id: session.id })
      .eq('id', order.id)
      .then(() => {}, () => {})

    return json({
      url: session.url,
      session_id: session.id,
      commissionPct,
      platformFee: feeCents / 100,
      connected,
    })
  } catch (err) {
    console.error('[stripe-checkout]', err)
    return json({ error: (err as Error).message ?? 'Erro interno' }, 500)
  }
})
