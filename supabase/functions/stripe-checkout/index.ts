/**
 * Edge Function: stripe-checkout
 *
 * Cria uma Stripe Checkout Session em dois cenários:
 *
 *  A) Pagamento de agendamento (agenda pública)
 *     body: { orderId, tenantId, amount, description, mode, customerEmail }
 *
 *  B) Assinatura do SaaS (onboarding de um novo tenant)
 *     body: { mode:'subscription', tenant_id, plan_id, amount, description,
 *             customer_email, success_url, cancel_url }
 *
 * Secrets necessários no Supabase:
 *   npx supabase secrets set STRIPE_SECRET_KEY=sk_live_...
 *   npx supabase secrets set APP_URL=https://seu-dominio.vercel.app
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeKey) return json({ error: 'STRIPE_SECRET_KEY não configurada' }, 500)

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })
    const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json()

    /* ══════════════════════════════════════════════════════════
       CENÁRIO B — Assinatura do SaaS (novo tenant)
       ══════════════════════════════════════════════════════════ */
    if (body.tenant_id && body.plan_id) {
      const { tenant_id, plan_id, amount, description, customer_email,
              success_url, cancel_url } = body

      if (!amount || amount < 100) return json({ error: 'Valor inválido' }, 400)

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'brl',
            recurring: { interval: 'month' },
            product_data: {
              name: description ?? `Auto Estética Flow — ${plan_id}`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        }],
        customer_email: customer_email ?? undefined,
        metadata: { tenant_id, plan_id, kind: 'saas_subscription' },
        subscription_data: {
          metadata: { tenant_id, plan_id },
        },
        success_url: success_url ?? `${appUrl}/login?welcome=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  cancel_url  ?? `${appUrl}/onboarding?plan=${plan_id}`,
        locale: 'pt-BR',
      })

      return json({ url: session.url, session_id: session.id })
    }

    /* ══════════════════════════════════════════════════════════
       CENÁRIO A — Pagamento de agendamento (agenda pública)
       ══════════════════════════════════════════════════════════ */
    const orderId = body.orderId ?? body.order_id
    if (!orderId) return json({ error: 'orderId obrigatório' }, 400)

    const { data: order, error } = await supabase
      .from('service_orders')
      .select('id, total_amount, tenant_id, subscription_plan_id, customer:customers(name, email), tenant:tenants(name)')
      .eq('id', orderId)
      .single()

    if (error || !order) return json({ error: 'Ordem não encontrada' }, 404)

    const amountCents = body.amount ?? Math.round((order.total_amount ?? 0) * 100)
    if (!amountCents || amountCents < 100) return json({ error: 'Valor inválido' }, 400)

    const tenantName = (order.tenant as { name?: string } | null)?.name ?? 'Estética'
    const customerEmail = body.customerEmail
      ?? (order.customer as { email?: string } | null)?.email
      ?? undefined

    // Assinatura de plano da estética → modo subscription recorrente
    const isSubscription = body.mode === 'subscription' && !!order.subscription_plan_id

    const session = await stripe.checkout.sessions.create({
      mode: isSubscription ? 'subscription' : 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'brl',
          ...(isSubscription ? { recurring: { interval: 'month' as const } } : {}),
          product_data: {
            name: body.description ?? `Agendamento — ${tenantName}`,
            description: `Código ${order.id.slice(0, 8).toUpperCase()}`,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      customer_email: customerEmail,
      metadata: {
        order_id: order.id,
        tenant_id: order.tenant_id,
        kind: isSubscription ? 'customer_subscription' : 'booking_payment',
      },
      success_url: body.success_url ?? `${appUrl}/agendar/${order.tenant_id}?paid=1`,
      cancel_url:  body.cancel_url  ?? `${appUrl}/agendar/${order.tenant_id}?cancelled=1`,
      locale: 'pt-BR',
    })

    return json({ url: session.url, session_id: session.id })
  } catch (err) {
    console.error('[stripe-checkout]', err)
    return json({ error: (err as Error).message ?? 'Erro interno' }, 500)
  }
})
