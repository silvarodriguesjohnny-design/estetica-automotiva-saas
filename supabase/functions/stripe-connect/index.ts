/**
 * Edge Function: stripe-connect
 *
 * Onboarding e gestão da conta Stripe Connect de cada estética.
 *
 * AÇÕES:
 *   onboard   cria a conta Express (se não houver) e devolve o link
 *             de cadastro hospedado pelo Stripe
 *   status    consulta se a conta já pode receber pagamentos
 *   dashboard gera link de acesso ao painel da estética no Stripe
 *   refresh   força re-sincronização com a Stripe
 *
 * POR QUE EXPRESS E NÃO STANDARD:
 * Express = o Stripe cuida do KYC, dos dados bancários e do painel.
 * A estética faz um cadastro de ~5 minutos e pronto. Standard exigiria
 * que ela criasse uma conta Stripe completa — barreira alta demais
 * para dono de lava-jato.
 *
 * SEGURANÇA: exige login. O tenant vem do profile, nunca do body.
 *
 * Deploy:
 *   npx supabase functions deploy stripe-connect
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Traduz o estado da conta Stripe para o nosso vocabulário. */
function mapStatus(acct: Stripe.Account): string {
  if (acct.charges_enabled && acct.payouts_enabled) return 'active'

  const req = acct.requirements
  if (req?.disabled_reason?.includes('rejected')) return 'rejected'
  if ((req?.currently_due?.length ?? 0) > 0 || (req?.past_due?.length ?? 0) > 0) {
    return acct.details_submitted ? 'restricted' : 'onboarding'
  }
  if (acct.details_submitted) return 'pending'
  return 'onboarding'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeKey) return json({ error: 'STRIPE_SECRET_KEY não configurada' }, 500)

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })
    const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '')

    /* ── Autenticação ── */
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Não autorizado' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: profile } = await admin
      .from('profiles').select('tenant_id, role').eq('id', user.id).maybeSingle()

    const tenantId = profile?.tenant_id
    if (!tenantId) return json({ error: 'Usuário sem empresa vinculada' }, 403)

    const { data: tenant } = await admin
      .from('tenants')
      .select('id, name, email, phone, cpf_cnpj, plan_type, cidade, stripe_account_id, stripe_account_status, commission_pct_override')
      .eq('id', tenantId).single()

    if (!tenant) return json({ error: 'Empresa não encontrada' }, 404)

    const body = await req.json().catch(() => ({}))
    const action: string = body.action ?? 'status'

    /* ── Comissão vigente ── */
    const { data: commission } = await admin.rpc('get_tenant_commission', { p_tenant_id: tenantId })
    const commissionPct = Number(commission ?? 10)

    /* ══════════════════════════════════════════════════════
       AÇÃO: onboard — cria a conta e devolve o link
       ══════════════════════════════════════════════════════ */
    if (action === 'onboard') {
      let acctId = tenant.stripe_account_id

      if (!acctId) {
        const account = await stripe.accounts.create({
          type: 'express',
          country: 'BR',
          email: tenant.email ?? undefined,
          business_type: (tenant.cpf_cnpj ?? '').replace(/\D/g, '').length === 14
            ? 'company' : 'individual',
          business_profile: {
            name: tenant.name,
            product_description: 'Serviços de estética e higienização automotiva',
            mcc: '7542',   // Car Washes
            support_email: tenant.email ?? undefined,
          },
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          settings: {
            payouts: { schedule: { interval: 'daily', delay_days: 'minimum' } },
          },
          metadata: { tenant_id: tenantId, app: 'auto-estetica-flow' },
        })

        acctId = account.id
        await admin.from('tenants').update({
          stripe_account_id: acctId,
          stripe_account_status: 'onboarding',
        }).eq('id', tenantId)
      }

      const link = await stripe.accountLinks.create({
        account: acctId,
        refresh_url: `${appUrl}/settings?tab=pagamentos&refresh=1`,
        return_url:  `${appUrl}/settings?tab=pagamentos&done=1`,
        type: 'account_onboarding',
      })

      return json({ url: link.url, accountId: acctId, status: 'onboarding' })
    }

    /* ══════════════════════════════════════════════════════
       AÇÃO: dashboard — painel da estética no Stripe
       ══════════════════════════════════════════════════════ */
    if (action === 'dashboard') {
      if (!tenant.stripe_account_id) return json({ error: 'Conta ainda não criada' }, 400)
      const link = await stripe.accounts.createLoginLink(tenant.stripe_account_id)
      return json({ url: link.url })
    }

    /* ══════════════════════════════════════════════════════
       AÇÃO: status / refresh
       ══════════════════════════════════════════════════════ */
    if (!tenant.stripe_account_id) {
      return json({
        status: 'not_connected',
        commissionPct,
        planType: tenant.plan_type,
      })
    }

    const acct = await stripe.accounts.retrieve(tenant.stripe_account_id)
    const status = mapStatus(acct)

    const patch: Record<string, unknown> = {
      stripe_account_status: status,
      stripe_charges_enabled: acct.charges_enabled ?? false,
      stripe_payouts_enabled: acct.payouts_enabled ?? false,
      stripe_details_submitted: acct.details_submitted ?? false,
      stripe_requirements: {
        currently_due: acct.requirements?.currently_due ?? [],
        past_due: acct.requirements?.past_due ?? [],
        disabled_reason: acct.requirements?.disabled_reason ?? null,
      },
    }
    if (status === 'active' && tenant.stripe_account_status !== 'active') {
      patch.stripe_connected_at = new Date().toISOString()
    }

    await admin.from('tenants').update(patch).eq('id', tenantId)

    /* ── Se ainda falta algo, devolve um link para continuar ── */
    let continueUrl: string | null = null
    if (status !== 'active') {
      const link = await stripe.accountLinks.create({
        account: tenant.stripe_account_id,
        refresh_url: `${appUrl}/settings?tab=pagamentos&refresh=1`,
        return_url:  `${appUrl}/settings?tab=pagamentos&done=1`,
        type: 'account_onboarding',
      })
      continueUrl = link.url
    }

    /* ── Resumo de faturamento ── */
    const { data: earnings } = await admin
      .from('platform_revenue_by_tenant')
      .select('paid_transactions, gross_volume, platform_revenue, tenant_revenue, last_sale_at')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    return json({
      status,
      accountId: tenant.stripe_account_id,
      chargesEnabled: acct.charges_enabled ?? false,
      payoutsEnabled: acct.payouts_enabled ?? false,
      detailsSubmitted: acct.details_submitted ?? false,
      requirements: acct.requirements?.currently_due ?? [],
      disabledReason: acct.requirements?.disabled_reason ?? null,
      continueUrl,
      commissionPct,
      planType: tenant.plan_type,
      earnings: earnings ?? null,
    })
  } catch (err) {
    console.error('[stripe-connect]', err)
    return json({ error: (err as Error).message ?? 'Erro interno' }, 500)
  }
})
