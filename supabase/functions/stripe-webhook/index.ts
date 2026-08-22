/**
 * Edge Function: stripe-webhook
 *
 * Ponto único onde a Stripe informa o que realmente aconteceu.
 * Nunca confie no redirect de sucesso do navegador — o usuário pode
 * fechar a aba antes. O webhook é a fonte de verdade.
 *
 * EVENTOS TRATADOS:
 *   checkout.session.completed          pagamento/assinatura concluída
 *   customer.subscription.created       assinatura do SaaS criada (em trial)
 *   customer.subscription.updated       mudança de status/plano
 *   customer.subscription.deleted       cancelamento
 *   customer.subscription.trial_will_end  3 dias antes do fim do trial
 *   invoice.payment_succeeded           cobrança recorrente aprovada
 *   invoice.payment_failed              cobrança recusada
 *   account.updated                     conta Connect da estética mudou
 *
 * Deploy (OBRIGATÓRIO sem JWT — a Stripe não manda Bearer):
 *   npx supabase functions deploy stripe-webhook --no-verify-jwt
 *
 * Secret:
 *   npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const cors = { 'Access-Control-Allow-Origin': '*' }

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

/** Traduz o status da Stripe para o vocabulário do sistema. */
function mapSubStatus(s: string): string {
  switch (s) {
    case 'trialing': return 'trial'
    case 'active':   return 'active'
    case 'past_due':
    case 'unpaid':   return 'past_due'
    case 'canceled':
    case 'incomplete_expired': return 'cancelled'
    default: return 'trial'
  }
}

function mapAccountStatus(acct: Stripe.Account): string {
  if (acct.charges_enabled && acct.payouts_enabled) return 'active'
  const req = acct.requirements
  if (req?.disabled_reason?.includes('rejected')) return 'rejected'
  if ((req?.currently_due?.length ?? 0) > 0 || (req?.past_due?.length ?? 0) > 0) {
    return acct.details_submitted ? 'restricted' : 'onboarding'
  }
  if (acct.details_submitted) return 'pending'
  return 'onboarding'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  const whSecret  = Deno.env.get('STRIPE_WEBHOOK_SECRET')

  if (!stripeKey || !whSecret) {
    console.error('[stripe-webhook] secrets ausentes')
    return new Response('Configuração ausente', { status: 500, headers: cors })
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

  /* ── Verificação da assinatura ── */
  let event: Stripe.Event
  try {
    const sig = req.headers.get('stripe-signature')
    if (!sig) return new Response('Assinatura ausente', { status: 400, headers: cors })
    const raw = await req.text()
    event = await stripe.webhooks.constructEventAsync(raw, sig, whSecret, undefined, Stripe.createSubtleCryptoProvider())
  } catch (err) {
    console.error('[stripe-webhook] assinatura inválida:', err)
    return new Response('Assinatura inválida', { status: 400, headers: cors })
  }

  console.log('[stripe-webhook]', event.type)

  try {
    switch (event.type) {
      /* ══════════════════════════════════════════════════════
         CHECKOUT CONCLUÍDO
         ══════════════════════════════════════════════════════ */
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session
        const meta = s.metadata ?? {}
        const kind = meta.kind ?? ''

        /* ── Assinatura do SaaS ── */
        if (kind === 'saas_subscription' && meta.tenant_id) {
          await admin.from('tenants').update({
            subscription_type: 'trial',           // entra em trial de 14 dias
            subscription_id: s.subscription as string,
            stripe_subscription_id: s.subscription as string,
            stripe_customer_id: s.customer as string,
            plan_type: meta.plan_id ?? 'starter',
            is_active: true,
          }).eq('id', meta.tenant_id)
          console.log(`[saas] tenant ${meta.tenant_id} assinou ${meta.plan_id}`)
          break
        }

        /* ── Assinatura de combo pelo cliente final ── */
        if (kind === 'customer_subscription' && meta.customer_subscription_id) {
          const now = new Date()
          const { data: cs } = await admin
            .from('customer_subscriptions')
            .select('interval, sessions_total')
            .eq('id', meta.customer_subscription_id)
            .maybeSingle()

          const months = cs?.interval === 'quarterly' ? 3
                       : cs?.interval === 'yearly'    ? 12 : 1
          const cycleEnd = new Date(now)
          cycleEnd.setMonth(cycleEnd.getMonth() + months)

          await admin.from('customer_subscriptions').update({
            status: 'active',
            stripe_subscription_id: (s.subscription as string) ?? null,
            stripe_customer_id: (s.customer as string) ?? null,
            stripe_session_id: s.id,
            started_at: now.toISOString(),
            cycle_start: now.toISOString(),
            cycle_end: cycleEnd.toISOString(),
            sessions_used: 0,
          }).eq('id', meta.customer_subscription_id)

          // O primeiro agendamento já consome uma sessão do ciclo
          if (meta.order_id) {
            await admin.rpc('consume_subscription_session', {
              p_subscription_id: meta.customer_subscription_id,
              p_order_id: meta.order_id,
            }).then(() => {}, () => {})

            await admin.from('service_orders').update({
              payment_status: 'paid',
              status: 'confirmed',
              covered_by_subscription: true,
              paid_at: now.toISOString(),
            }).eq('id', meta.order_id)
          }

          await admin.from('platform_earnings').update({
            status: 'paid', paid_at: now.toISOString(),
          }).eq('stripe_session_id', s.id).then(() => {}, () => {})

          console.log(`[customer-sub] assinatura ${meta.customer_subscription_id} ativada`)
          break
        }

        /* ── Pagamento de agendamento ── */
        if (meta.order_id) {
          const paidAt = new Date().toISOString()

          await admin.from('service_orders').update({
            payment_status: 'paid',
            status: 'confirmed',                  // pagou → confirma automático
            stripe_payment_intent: (s.payment_intent as string) ?? null,
            paid_at: paidAt,
          }).eq('id', meta.order_id)

          await admin.from('platform_earnings').update({
            status: 'paid',
            paid_at: paidAt,
            stripe_payment_intent: (s.payment_intent as string) ?? null,
          }).eq('stripe_session_id', s.id)

          // Lança a receita da estética no financeiro dela
          if (meta.tenant_id) {
            const gross = (s.amount_total ?? 0) / 100
            const fee = Number(meta.platform_fee ?? 0) / 100
            await admin.from('transactions').insert({
              tenant_id: meta.tenant_id,
              type: 'income',
              amount: gross - fee,
              description: `Agendamento pago online — ${meta.order_id.slice(0, 8).toUpperCase()}`,
              category: 'servico',
              payment_method: 'credito',
            }).then(() => {}, () => {})
          }

          console.log(`[booking] OS ${meta.order_id} paga — taxa R$ ${meta.platform_fee}`)
        }
        break
      }

      /* ══════════════════════════════════════════════════════
         ASSINATURA DO SAAS — ciclo de vida
         ══════════════════════════════════════════════════════ */
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription

        /* ── Assinatura de combo do cliente final ── */
        if (sub.metadata?.kind === 'customer_subscription' || sub.metadata?.customer_subscription_id) {
          const csId = sub.metadata.customer_subscription_id
          if (!csId) break

          const map: Record<string, string> = {
            trialing: 'active', active: 'active',
            past_due: 'past_due', unpaid: 'past_due',
            paused: 'paused',
            canceled: 'cancelled', incomplete_expired: 'cancelled',
          }

          await admin.from('customer_subscriptions').update({
            status: map[sub.status] ?? 'pending',
            cycle_end: new Date(sub.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id', csId)

          console.log(`[customer-sub] ${csId} → ${sub.status}`)
          break
        }

        /* ── Assinatura do SaaS (estética paga a plataforma) ── */
        const tenantId = sub.metadata?.tenant_id
        if (!tenantId) break

        await admin.from('tenants').update({
          subscription_type: mapSubStatus(sub.status),
          stripe_subscription_id: sub.id,
          stripe_price_id: sub.items.data[0]?.price?.id ?? null,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          plan_type: sub.metadata?.plan_id ?? undefined,
          is_active: ['trialing', 'active', 'past_due'].includes(sub.status),
        }).eq('id', tenantId)

        console.log(`[sub] tenant ${tenantId} → ${sub.status}`)
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription

        /* ── Cliente final cancelou o combo ── */
        if (sub.metadata?.customer_subscription_id) {
          await admin.from('customer_subscriptions').update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            cancel_reason: sub.cancellation_details?.reason ?? 'cancelado no Stripe',
          }).eq('id', sub.metadata.customer_subscription_id)
          console.log(`[customer-sub] ${sub.metadata.customer_subscription_id} cancelada`)
          break
        }

        /* ── Estética cancelou o SaaS ── */
        const tenantId = sub.metadata?.tenant_id
        if (!tenantId) break

        await admin.from('tenants').update({
          subscription_type: 'cancelled',
          is_active: false,
        }).eq('id', tenantId)

        console.log(`[sub] tenant ${tenantId} cancelou`)
        break
      }

      /* ── Trial terminando em 3 dias ── */
      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object as Stripe.Subscription
        const tenantId = sub.metadata?.tenant_id
        if (!tenantId) break

        const { data: t } = await admin
          .from('tenants').select('name, phone, whatsapp_phone').eq('id', tenantId).maybeSingle()

        const phone = (t?.whatsapp_phone ?? t?.phone ?? '').replace(/\D/g, '')
        if (phone) {
          const num = phone.length === 11 ? `55${phone}` : phone
          const msg =
            `Olá! 👋 Seu período de testes do *Auto Estética Flow* termina em 3 dias.\n\n` +
            `A partir daí a assinatura entra em cobrança automática — não precisa fazer nada.\n\n` +
            `Se quiser trocar de plano ou cancelar, acesse Configurações → Plano. 🚗`

          await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-whatsapp-public`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ tenantId, orderId: 'trial-notice', phone: num, message: msg }),
          }).catch(() => {})
        }

        console.log(`[trial] avisando tenant ${tenantId}`)
        break
      }

      /* ══════════════════════════════════════════════════════
         COBRANÇAS RECORRENTES
         ══════════════════════════════════════════════════════ */
      case 'invoice.payment_succeeded': {
        const inv = event.data.object as Stripe.Invoice
        if (!inv.subscription) break
        const sub = await stripe.subscriptions.retrieve(inv.subscription as string)

        /* ── Renovação do combo do cliente final ──
           Este é o momento em que o saldo de sessões zera. Se o
           ciclo não reiniciar aqui, o cliente paga o segundo mês
           e continua sem poder agendar. */
        if (sub.metadata?.customer_subscription_id) {
          const csId = sub.metadata.customer_subscription_id

          // A primeira fatura é a da contratação — o ciclo já foi
          // criado no checkout.session.completed. Só renova a partir
          // da segunda cobrança.
          if (inv.billing_reason === 'subscription_cycle') {
            await admin.from('customer_subscriptions').update({
              status: 'active',
              sessions_used: 0,                                    // ← zera o saldo
              cycle_start: new Date(sub.current_period_start * 1000).toISOString(),
              cycle_end:   new Date(sub.current_period_end * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            }).eq('id', csId)

            // Registra a comissão da renovação
            const { data: cs } = await admin
              .from('customer_subscriptions')
              .select('tenant_id, commission_pct')
              .eq('id', csId).maybeSingle()

            if (cs) {
              const gross = (inv.amount_paid ?? 0) / 100
              const pct = Number(cs.commission_pct ?? 10)
              const fee = gross * (pct / 100)
              await admin.from('platform_earnings').insert({
                tenant_id: cs.tenant_id,
                stripe_payment_intent: (inv.payment_intent as string) ?? null,
                gross_amount: gross,
                commission_pct: pct,
                platform_fee: fee,
                tenant_amount: gross - fee,
                status: 'paid',
                paid_at: new Date().toISOString(),
              }).then(() => {}, () => {})
            }

            console.log(`[customer-sub] ${csId} renovada — saldo zerado`)
          }
          break
        }

        /* ── Renovação do SaaS ── */
        const tenantId = sub.metadata?.tenant_id
        if (!tenantId) break

        await admin.from('tenants').update({
          subscription_type: 'active',
          is_active: true,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        }).eq('id', tenantId)
        break
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice
        if (!inv.subscription) break
        const sub = await stripe.subscriptions.retrieve(inv.subscription as string)

        /* ── Cartão do cliente final recusado ──
           Marca como past_due mas NÃO cancela: o Stripe ainda vai
           tentar de novo. Cancelar aqui puniria o cliente por um
           limite temporário no cartão. */
        if (sub.metadata?.customer_subscription_id) {
          await admin.from('customer_subscriptions')
            .update({ status: 'past_due', updated_at: new Date().toISOString() })
            .eq('id', sub.metadata.customer_subscription_id)
          console.warn(`[customer-sub] pagamento falhou — ${sub.metadata.customer_subscription_id}`)
          break
        }

        /* ── Cartão da estética recusado ── */
        const tenantId = sub.metadata?.tenant_id
        if (!tenantId) break

        await admin.from('tenants')
          .update({ subscription_type: 'past_due' })
          .eq('id', tenantId)

        console.warn(`[billing] pagamento falhou — tenant ${tenantId}`)
        break
      }

      /* ══════════════════════════════════════════════════════
         CONTA CONNECT DA ESTÉTICA
         ══════════════════════════════════════════════════════ */
      case 'account.updated': {
        const acct = event.data.object as Stripe.Account
        const tenantId = acct.metadata?.tenant_id
        if (!tenantId) break

        const status = mapAccountStatus(acct)
        await admin.from('tenants').update({
          stripe_account_status: status,
          stripe_charges_enabled: acct.charges_enabled ?? false,
          stripe_payouts_enabled: acct.payouts_enabled ?? false,
          stripe_details_submitted: acct.details_submitted ?? false,
          stripe_requirements: {
            currently_due: acct.requirements?.currently_due ?? [],
            past_due: acct.requirements?.past_due ?? [],
            disabled_reason: acct.requirements?.disabled_reason ?? null,
          },
          ...(status === 'active' ? { stripe_connected_at: new Date().toISOString() } : {}),
        }).eq('id', tenantId)

        console.log(`[connect] tenant ${tenantId} → ${status}`)
        break
      }

      default:
        console.log('[stripe-webhook] evento não tratado:', event.type)
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[stripe-webhook] erro ao processar:', err)
    // 200 mesmo com erro: evita a Stripe entrar em loop de retry
    // por um problema nosso. O log fica para investigação.
    return new Response(JSON.stringify({ received: true, error: String(err).slice(0, 200) }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
