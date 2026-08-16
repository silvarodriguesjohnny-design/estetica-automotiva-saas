/**
 * Edge Function: stripe-webhook
 *
 * Recebe eventos do Stripe e atualiza o status de assinatura/pagamento.
 *
 * Configure no Stripe Dashboard:
 *   Endpoint URL: https://rhaqclcahecpfyzvzdzm.supabase.co/functions/v1/stripe-webhook
 *   Eventos: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const cors = { 'Access-Control-Allow-Origin': '*' }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Verify Stripe signature
  const sig = req.headers.get('stripe-signature')!
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret)
  } catch (err: any) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  // Handle events
  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const orderId = session.metadata?.order_id
      if (orderId) {
        // Marca OS como paga
        await supabase.from('service_orders').update({
          payment_status: 'paid',
          payment_method: 'stripe',
          stripe_session_id: session.id,
        }).eq('id', orderId)
      }
      break
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const tenantId = sub.metadata?.tenant_id
      if (tenantId) {
        const status = sub.status === 'active' ? 'active'
          : sub.status === 'past_due' ? 'past_due'
          : sub.status === 'canceled' ? 'cancelled'
          : 'inactive'
        await supabase.from('tenants').update({
          subscription_type: status,
          stripe_subscription_id: sub.id,
          stripe_customer_id: sub.customer as string,
        }).eq('id', tenantId)
      }
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const tenantId = sub.metadata?.tenant_id
      if (tenantId) {
        await supabase.from('tenants').update({ subscription_type: 'cancelled' }).eq('id', tenantId)
      }
      break
    }

    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice
      const tenantId = (inv as any).subscription_details?.metadata?.tenant_id
      if (tenantId) {
        await supabase.from('tenants').update({ subscription_type: 'past_due' }).eq('id', tenantId)
      }
      break
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
