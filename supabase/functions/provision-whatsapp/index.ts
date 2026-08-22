/**
 * Edge Function: provision-whatsapp
 *
 * Cria (ou recria) a instância Evolution API de um tenant.
 *
 * FLUXO:
 *   1. Grava status 'provisioning'
 *   2. Cria a instância na Evolution com webhook apontando de volta
 *   3. Busca o QR Code e grava status 'qr_pending'
 *   4. O dono escaneia → a Evolution chama whatsapp-webhook → 'connected'
 *
 * IDEMPOTÊNCIA:
 *   O nome da instância é determinístico (aef-{slug}-{8 chars do uuid}).
 *   Se a instância já existe na Evolution, apenas reconecta e devolve
 *   um QR novo em vez de estourar erro.
 *
 * INFRA (Railway):
 *   Cada instância é uma conexão Baileys viva (~60-90MB RAM).
 *   O container do Railway reinicia em cada deploy — se o volume não for
 *   persistente, as sessões caem juntas. Por isso o job de saúde e a
 *   reconexão automática são parte do desenho, não um extra.
 *
 * Secrets necessários:
 *   EVOLUTION_API_URL      https://sua-evolution.up.railway.app
 *   EVOLUTION_GLOBAL_KEY   chave global (AUTHENTICATION_API_KEY do Railway)
 *
 * Deploy:
 *   npx supabase functions deploy provision-whatsapp
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const EVOLUTION_URL = (Deno.env.get('EVOLUTION_API_URL') ?? '').replace(/\/+$/, '')
const EVOLUTION_KEY = Deno.env.get('EVOLUTION_GLOBAL_KEY') ?? Deno.env.get('EVOLUTION_API_KEY') ?? ''
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? ''

const slugify = (v: string) =>
  v.toLowerCase()
   .normalize('NFD').replace(/[̀-ͯ]/g, '')
   .replace(/[^a-z0-9]+/g, '-')
   .replace(/^-|-$/g, '')
   .slice(0, 24)

/** Chamada à Evolution com timeout — o Railway pode ter cold start. */
async function evo(path: string, init: RequestInit = {}, timeoutMs = 20000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(`${EVOLUTION_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY, ...(init.headers ?? {}) },
    })
  } finally {
    clearTimeout(timer)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  let tenantId = ''

  try {
    if (!EVOLUTION_URL || !EVOLUTION_KEY) {
      return json({ error: 'Evolution API não configurada nos secrets do Supabase' }, 500)
    }

    const body = await req.json().catch(() => ({}))
    const force = body.force === true   // recria mesmo se já existir

    /* ── De onde vem o tenantId ──
       Dois caminhos legítimos chamam esta função:

       1. O dono da estética, pelo botão em Configurações → WhatsApp.
          Nesse caso vem um JWT de usuário e o tenant sai do profile —
          nunca do body, senão qualquer um provisiona instância para
          outra empresa.

       2. A signup-tenant, logo após criar a conta. Aí vem a service
          role key e o tenantId no body, porque ainda não existe
          sessão de usuário.                                        */
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const isServiceRole = token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (isServiceRole) {
      tenantId = body.tenantId ?? body.tenant_id ?? ''
    } else {
      const userClient = createClient(
        SUPABASE_URL,
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
      )
      const { data: { user } } = await userClient.auth.getUser()
      if (!user) return json({ error: 'Não autorizado' }, 401)

      const { data: profile } = await admin
        .from('profiles').select('tenant_id').eq('id', user.id).maybeSingle()

      tenantId = profile?.tenant_id ?? ''
      if (!tenantId) return json({ error: 'Usuário sem empresa vinculada' }, 403)
    }

    if (!tenantId) return json({ error: 'tenantId obrigatório' }, 400)

    /* ── Dados do tenant ── */
    const { data: tenant } = await admin
      .from('tenants').select('id, name, slug').eq('id', tenantId).maybeSingle()

    if (!tenant) return json({ error: 'Tenant não encontrado' }, 404)

    /* ── Config existente ── */
    const { data: existing } = await admin
      .from('messaging_configs')
      .select('id, instance_name, status, webhook_token')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    // Já conectado e não é força bruta → nada a fazer
    if (existing?.status === 'connected' && !force) {
      return json({ success: true, status: 'connected', instance: existing.instance_name,
                    message: 'WhatsApp já está conectado' })
    }

    /* ── Nome determinístico da instância ── */
    const base = slugify(tenant.slug || tenant.name)
    const instanceName = existing?.instance_name ?? `aef-${base}-${tenantId.slice(0, 8)}`

    const webhookToken = existing?.webhook_token ?? crypto.randomUUID().replace(/-/g, '')
    const webhookUrl = `${SUPABASE_URL}/functions/v1/whatsapp-webhook?token=${webhookToken}`

    /* ── Upsert da config em estado 'provisioning' ── */
    await admin.from('messaging_configs').upsert({
      tenant_id: tenantId,
      channel: 'whatsapp',
      instance_name: instanceName,
      api_url: EVOLUTION_URL,
      webhook_url: webhookUrl,
      webhook_token: webhookToken,
      status: 'provisioning',
      is_active: false,
    }, { onConflict: 'tenant_id' })

    await admin.rpc('set_whatsapp_status', {
      p_tenant_id: tenantId, p_status: 'provisioning',
      p_detail: `Instância ${instanceName}`, p_event_type: 'provisioning',
    }).then(() => {}, () => {})

    /* ── 1. Cria a instância na Evolution ── */
    let instanceKey = ''
    const createRes = await evo('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        webhook: {
          enabled: true,
          url: webhookUrl,
          byEvents: false,
          base64: true,
          events: ['CONNECTION_UPDATE', 'QRCODE_UPDATED'],
        },
      }),
    })

    if (createRes.ok) {
      const created = await createRes.json()
      instanceKey = created?.hash?.apikey ?? created?.hash ?? created?.instance?.apikey ?? ''
    } else {
      const errText = await createRes.text()
      // "already in use" não é erro: a instância existe, seguimos para o connect
      const alreadyExists = /already|exists|in use/i.test(errText)
      if (!alreadyExists) {
        await admin.rpc('set_whatsapp_status', {
          p_tenant_id: tenantId, p_status: 'error',
          p_detail: errText.slice(0, 400), p_event_type: 'error',
        }).then(() => {}, () => {})

        await admin.from('messaging_configs').update({
          retry_count: (existing ? 1 : 0),
          next_retry_at: new Date(Date.now() + 60_000).toISOString(),
        }).eq('tenant_id', tenantId)

        return json({ error: 'Falha ao criar instância', detail: errText.slice(0, 300) }, 502)
      }
    }

    /* ── 2. Busca o QR Code ── */
    const connectRes = await evo(`/instance/connect/${instanceName}`, { method: 'GET' })
    const qrData = connectRes.ok ? await connectRes.json() : {}

    const qrBase64: string | null =
      qrData?.base64 ?? qrData?.qrcode?.base64 ?? qrData?.qr ?? null

    // Já conectado? (acontece quando a instância existia e a sessão sobreviveu)
    const alreadyOpen = qrData?.instance?.state === 'open' || qrData?.state === 'open'

    /* ── 3. Persiste chave e estado ── */
    const patch: Record<string, unknown> = {
      status: alreadyOpen ? 'connected' : 'qr_pending',
      is_active: alreadyOpen,
      provisioned_at: new Date().toISOString(),
      last_check_at: new Date().toISOString(),
      retry_count: 0,
      last_error: null,
    }
    if (instanceKey) patch.api_key = instanceKey
    if (!alreadyOpen) {
      patch.qr_code = qrBase64
      patch.qr_expires_at = new Date(Date.now() + 60_000).toISOString()
    } else {
      patch.qr_code = null
      patch.qr_expires_at = null
      patch.connected_at = new Date().toISOString()
    }

    await admin.from('messaging_configs').update(patch).eq('tenant_id', tenantId)

    await admin.rpc('set_whatsapp_status', {
      p_tenant_id: tenantId,
      p_status: alreadyOpen ? 'connected' : 'qr_pending',
      p_detail: alreadyOpen ? 'Sessão já ativa' : 'QR Code gerado',
      p_event_type: alreadyOpen ? 'connected' : 'qr_generated',
    }).then(() => {}, () => {})

    return json({
      success: true,
      status: alreadyOpen ? 'connected' : 'qr_pending',
      instance: instanceName,
      qrCode: alreadyOpen ? null : qrBase64,
      qrExpiresAt: alreadyOpen ? null : new Date(Date.now() + 60_000).toISOString(),
    })
  } catch (err) {
    console.error('[provision-whatsapp]', err)

    if (tenantId) {
      await admin.rpc('set_whatsapp_status', {
        p_tenant_id: tenantId, p_status: 'error',
        p_detail: String(err).slice(0, 400), p_event_type: 'error',
      }).then(() => {}, () => {})
    }

    return json({ error: 'Erro ao provisionar', detail: String(err).slice(0, 300) }, 500)
  }
})
