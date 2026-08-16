/**
 * Edge Function: stripe-checkout
 *
 * Cria uma Stripe Checkout Session para pagamento de agendamento ou assinatura.
 *
 * Requer secrets no Supabase:
 *   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
 *   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
 *
 * Variáveis de ambiente (Vercel):
 *   VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeKey) throw new Error('STRIPE_SECRET_KEY não configurada')

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json()
    const { order_id, success_url, cancel_url } = body

    // Carrega a OS
    const { data: order, error } = await supabase
      .from('service_orders')
      .select('*, customer:customers(name, email), tenant:tenants(name)')
      .eq('id', order_id)
      .single()

    if (error || !order) throw new Error('Ordem não encontrada')

    const amountCents = Math.round(order.total_amount * 100)

    // Cria sessão Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'brl',
          product_data: {
            name: `Agendamento — ${(order.tenant as any)?.name}`,
            description: `OS #${order.id.slice(0, 8).toUpperCase()}`,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      customer_email: (order.customer as any)?.email ?? undefined,
      metadata: { order_id: order.id },
      success_url: success_url ?? `${Deno.env.get('APP_URL')}/agendar/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url ?? `${Deno.env.get('APP_URL')}/agendar/cancelled`,
    })

    return new Response(
      JSON.stringify({ url: session.url, session_id: session.id }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }
})
