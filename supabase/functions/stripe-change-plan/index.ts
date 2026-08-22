/**
 * Edge Function: stripe-change-plan
 *
 * Troca o plano SaaS da estética direto na assinatura existente
 * do Stripe — sem criar assinatura nova, sem cancelar a antiga.
 *
 * ── Por que NÃO criamos uma assinatura nova ──────────────────
 *
 * O caminho intuitivo seria: cancela a velha, abre um checkout
 * novo. Ele é intuitivo e é errado, por três motivos concretos:
 *
 *   1. Janela sem cobertura. Entre o cancelamento e o pagamento
 *      da nova, a estética fica sem assinatura ativa. Se ela
 *      abandonar o checkout no meio, você acabou de cancelar um
 *      cliente pagante que só queria pagar MAIS.
 *
 *   2. Cartão recoletado. A nova assinatura pede o cartão de novo.
 *      Cada campo de cartão é um ponto de desistência — e aqui é
 *      o pior momento possível para ter um, porque o cliente já
 *      tinha decidido comprar.
 *
 *   3. Histórico partido. MRR, churn e LTV passam a contar dois
 *      contratos onde existe um cliente só. Você registra um
 *      churn e um new business no mesmo dia, e a métrica mente.
 *
 * O caminho certo é `subscriptions.update` trocando o item de
 * preço. A assinatura é a MESMA entidade: mesmo cartão, mesmo
 * ciclo, mesmo ID. O Stripe calcula o proration sozinho.
 *
 * ── Proration em uma frase ───────────────────────────────────
 * Se ela pagou R$ 97 no dia 1 e sobe para R$ 197 no dia 15, o
 * Stripe credita a metade não usada do plano antigo (~R$ 48) e
 * cobra a metade proporcional do novo (~R$ 98). Cobrança
 * imediata da diferença, e a partir do próximo ciclo o valor
 * cheio. Ninguém paga duas vezes pelo mesmo período.
 *
 * Deploy:
 *   npx supabase functions deploy stripe-change-plan
 */

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/* Ordem canônica dos planos. É aqui que "maior" ganha definição —
   e não no componente de UI, onde ficaria fora do alcance da
   validação do servidor. */
const RANK: Record<string, number> = { starter: 1, pro: 2, enterprise: 3 }

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

    /* Só quem administra a conta troca o plano. Sem isso, um
       usuário 'viewer' conseguiria triplicar a fatura da empresa. */
    if (profile?.role !== 'admin') {
      return json({ error: 'Apenas administradores podem alterar o plano' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const action: string = body.action ?? 'preview'
    const newPlanId: string = body.planId ?? ''
    const newPriceId: string = body.priceId ?? ''

    if (!newPlanId || !RANK[newPlanId]) {
      return json({ error: 'Plano inválido' }, 400)
    }

    const { data: tenant } = await admin
      .from('tenants')
      .select('id, name, email, plan_type, stripe_customer_id, stripe_subscription_id, stripe_price_id')
      .eq('id', tenantId).single()

    if (!tenant) return json({ error: 'Empresa não encontrada' }, 404)

    const atual = tenant.plan_type ?? 'starter'

    /* ── Regra de negócio: só sobe ───────────────────────────
       Downgrade não é "menos uma linha de código", é um fluxo
       diferente: precisa avisar sobre perda de recursos, tratar
       dados que excedem o limite do plano menor (o que fazer com
       o 5º serviço se o Padrão só permite 2?) e normalmente
       agenda a troca para o fim do ciclo, não imediata.
       Enquanto esse fluxo não existir, bloqueamos aqui — no
       servidor, não só na UI. */
    if (RANK[newPlanId] <= RANK[atual]) {
      return json({
        error: 'Só é possível migrar para um plano superior por aqui.',
        detail: `Plano atual: ${atual}. Para reduzir o plano, fale com o suporte.`,
      }, 400)
    }

    /* ── Sem assinatura ativa: cai no checkout normal ────────
       Acontece quando o trial expirou sem cartão, ou quando o
       tenant foi criado à mão no banco. Não é erro. */
    if (!tenant.stripe_subscription_id) {
      return json({
        needsCheckout: true,
        message: 'Não há assinatura ativa. Será necessário um novo checkout.',
      })
    }

    const sub = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id, {
      expand: ['items.data.price'],
    })

    if (sub.status === 'canceled' || sub.status === 'incomplete_expired') {
      return json({
        needsCheckout: true,
        message: 'A assinatura anterior não está mais ativa.',
      })
    }

    const item = sub.items.data[0]
    if (!item) return json({ error: 'Assinatura sem item de preço' }, 500)

    /* Resolve o Price alvo. Preferimos o ID vindo do front (fonte
       única em config/plans.ts); se vier vazio, buscamos pelo
       lookup_key que o script de setup gravou. */
    let priceId = newPriceId
    if (!priceId) {
      const found = await stripe.prices.list({
        lookup_keys: [`aef_${newPlanId}_monthly`],
        limit: 1,
      })
      priceId = found.data[0]?.id ?? ''
    }
    if (!priceId) {
      return json({ error: `Price do plano ${newPlanId} não encontrado no Stripe` }, 500)
    }

    /* ══════════════════════════════════════════════════════
       AÇÃO: preview — quanto vai ser cobrado agora?

       Mostrar o valor ANTES de confirmar não é gentileza, é
       redução de chargeback. Cliente que vê R$ 98 aparecerem
       no cartão sem aviso abre disputa; cliente que aprovou o
       número, não.
       ══════════════════════════════════════════════════════ */
    if (action === 'preview') {
      const invoice = await stripe.invoices.retrieveUpcoming({
        customer: sub.customer as string,
        subscription: sub.id,
        subscription_items: [{ id: item.id, price: priceId, quantity: 1 }],
        subscription_proration_behavior: 'always_invoice',
      })

      return json({
        preview: true,
        planoAtual: atual,
        planoNovo: newPlanId,
        cobrancaAgora: (invoice.amount_due ?? 0) / 100,
        creditoProporcional: (invoice.lines.data
          .filter(l => (l.amount ?? 0) < 0)
          .reduce((a, l) => a + (l.amount ?? 0), 0)) / 100,
        proximoCiclo: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
        cartaoFinal: null,
      })
    }

    /* ══════════════════════════════════════════════════════
       AÇÃO: confirm — executa a troca
       ══════════════════════════════════════════════════════ */
    if (action !== 'confirm') return json({ error: 'Ação inválida' }, 400)

    const updated = await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, price: priceId, quantity: 1 }],

      /* always_invoice = fatura a diferença AGORA.
         A alternativa, create_prorations, joga o ajuste para a
         próxima fatura. Parece mais suave, mas atrasa a receita
         e cria uma fatura futura confusa, com quatro linhas que
         o cliente não entende. Cobrar agora é mais honesto. */
      proration_behavior: 'always_invoice',

      /* O trial acaba no ato do upgrade. Quem decidiu pagar mais
         já validou o produto — manter o trial só adia sua receita
         sem aumentar a chance de conversão. */
      trial_end: sub.status === 'trialing' ? 'now' : undefined,

      /* Se a cobrança falhar (cartão sem limite), a assinatura
         NÃO troca de plano. Sem isto, o Stripe aplicaria o plano
         novo e deixaria a fatura em aberto: a estética usaria
         recursos do Elite sem ter pago. */
      payment_behavior: 'pending_if_incomplete',

      metadata: {
        tenant_id: tenantId,
        kind: 'saas_subscription',
        plan_id: newPlanId,
        plano_anterior: atual,
        alterado_em: new Date().toISOString(),
      },
    })

    /* A fatura pode ficar pendente de autenticação 3D Secure.
       Nesse caso devolvemos a URL para o cliente concluir — não
       atualizamos o plano no banco ainda; quem faz isso é o
       webhook, quando o pagamento confirmar de verdade. */
    let acaoNecessaria: string | null = null
    if (updated.status === 'past_due' || updated.status === 'incomplete') {
      const latest = updated.latest_invoice
      if (typeof latest === 'string') {
        const inv = await stripe.invoices.retrieve(latest)
        acaoNecessaria = inv.hosted_invoice_url ?? null
      }
    }

    /* ── Reflete no banco ──
       Só marcamos o plano quando a assinatura está saudável.
       Se ficou pendente, o webhook invoice.paid faz isso depois. */
    if (!acaoNecessaria) {
      await admin.from('tenants').update({
        plan_type: newPlanId,
        stripe_price_id: priceId,
        plan_changed_at: new Date().toISOString(),
      }).eq('id', tenantId)

      await admin.from('subscription_events').insert({
        tenant_id: tenantId,
        event_type: 'plan_upgraded',
        from_plan: atual,
        to_plan: newPlanId,
        stripe_subscription_id: sub.id,
        detail: `Upgrade de ${atual} para ${newPlanId}`,
      }).then(() => {}, () => {})   // tabela de auditoria é opcional
    }

    return json({
      success: true,
      status: updated.status,
      planoNovo: newPlanId,
      subscriptionId: updated.id,
      acaoNecessaria,               // URL do 3DS, quando houver
      proximoCiclo: updated.current_period_end
        ? new Date(updated.current_period_end * 1000).toISOString()
        : null,
      returnUrl: `${appUrl}/settings?tab=plano&upgraded=1`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stripe-change-plan]', msg)
    return json({ error: 'Erro ao alterar o plano', detail: msg.slice(0, 300) }, 500)
  }
})
