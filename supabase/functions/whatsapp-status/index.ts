/**
 * Edge Function: whatsapp-status
 *
 * Endpoint que a aba "WhatsApp" das Configurações consulta em polling.
 * Retorna o estado atual da instância do tenant e, quando aplicável,
 * um QR Code fresco.
 *
 * POR QUE PRECISA GERAR QR NOVO:
 * O QR da Evolution expira em ~60 segundos. Se a UI mostrar um QR
 * guardado no banco há 5 minutos, o dono escaneia um código morto,
 * nada acontece, e ele conclui que o sistema está quebrado.
 * Aqui verificamos a validade e pedimos um novo quando necessário.
 *
 * AÇÕES SUPORTADAS (campo `action`):
 *   status      (padrão) consulta estado + QR se preciso
 *   refresh_qr  força um QR novo
 *   disconnect  faz logout da instância
 *   delete      remove a instância da Evolution (libera RAM)
 *
 * SEGURANÇA: exige login. O tenant vem do profile do usuário —
 * nunca do body — para impedir que alguém consulte outro tenant.
 *
 * Deploy:
 *   npx supabase functions deploy whatsapp-status
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

async function evo(path: string, init: RequestInit = {}, timeoutMs = 15000) {
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

  try {
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

    // O tenant vem do profile — nunca do body
    const { data: profile } = await admin
      .from('profiles').select('tenant_id').eq('id', user.id).maybeSingle()

    const tenantId = profile?.tenant_id
    if (!tenantId) return json({ error: 'Usuário sem empresa vinculada' }, 403)

    const body = await req.json().catch(() => ({}))
    const action: string = body.action ?? 'status'

    /* ── Config atual ── */
    const { data: cfg } = await admin
      .from('messaging_configs')
      .select('instance_name, status, connected_number, qr_code, qr_expires_at, connected_at, disconnected_at, last_error, retry_count')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!cfg || !cfg.instance_name) {
      return json({ status: 'not_provisioned', message: 'WhatsApp ainda não provisionado' })
    }

    const inst = cfg.instance_name

    /* ══ AÇÃO: disconnect ══ */
    if (action === 'disconnect') {
      await evo(`/instance/logout/${inst}`, { method: 'DELETE' }).catch(() => {})
      await admin.rpc('set_whatsapp_status', {
        p_tenant_id: tenantId, p_status: 'disconnected',
        p_detail: 'Desconectado pelo próprio dono', p_event_type: 'disconnected',
      }).then(() => {}, () => {})
      await admin.from('messaging_configs')
        .update({ qr_code: null, qr_expires_at: null, connected_number: null })
        .eq('tenant_id', tenantId)
      return json({ status: 'disconnected' })
    }

    /* ══ AÇÃO: delete ══ */
    if (action === 'delete') {
      await evo(`/instance/logout/${inst}`, { method: 'DELETE' }).catch(() => {})
      await evo(`/instance/delete/${inst}`, { method: 'DELETE' }).catch(() => {})
      await admin.from('messaging_configs').update({
        status: 'not_provisioned', is_active: false,
        qr_code: null, qr_expires_at: null, connected_number: null, api_key: null,
      }).eq('tenant_id', tenantId)
      await admin.from('whatsapp_events').insert({
        tenant_id: tenantId, instance: inst, event_type: 'deleted',
        from_status: cfg.status, to_status: 'not_provisioned',
        detail: 'Instância removida pelo dono',
      }).then(() => {}, () => {})
      return json({ status: 'not_provisioned' })
    }

    /* ══ Consulta o estado real na Evolution ══ */
    let liveState = ''
    try {
      const r = await evo(`/instance/connectionState/${inst}`, { method: 'GET' })
      if (r.ok) {
        const d = await r.json()
        liveState = d?.instance?.state ?? d?.state ?? ''
      }
    } catch {
      // Railway pode estar em cold start — mantém o último estado conhecido
    }

    /* ── Conectado ── */
    if (liveState === 'open') {
      if (cfg.status !== 'connected') {
        await admin.rpc('set_whatsapp_status', {
          p_tenant_id: tenantId, p_status: 'connected',
          p_detail: 'Confirmado via polling', p_event_type: 'connected',
        }).then(() => {}, () => {})
        await admin.from('messaging_configs')
          .update({ qr_code: null, qr_expires_at: null }).eq('tenant_id', tenantId)
      }
      return json({
        status: 'connected',
        instance: inst,
        connectedNumber: cfg.connected_number,
        connectedAt: cfg.connected_at,
      })
    }

    /* ── Precisa de QR ── */
    const qrValid = cfg.qr_code && cfg.qr_expires_at && new Date(cfg.qr_expires_at) > new Date()
    const wantsFresh = action === 'refresh_qr' || !qrValid

    if (wantsFresh) {
      const r = await evo(`/instance/connect/${inst}`, { method: 'GET' })
      if (r.ok) {
        const d = await r.json()
        const qr = d?.base64 ?? d?.qrcode?.base64 ?? d?.qr ?? null
        const nowOpen = d?.instance?.state === 'open' || d?.state === 'open'

        if (nowOpen) {
          await admin.rpc('set_whatsapp_status', {
            p_tenant_id: tenantId, p_status: 'connected',
            p_detail: 'Sessão ativa', p_event_type: 'connected',
          }).then(() => {}, () => {})
          return json({ status: 'connected', instance: inst, connectedNumber: cfg.connected_number })
        }

        if (qr) {
          const expires = new Date(Date.now() + 60_000).toISOString()
          await admin.from('messaging_configs').update({
            qr_code: qr, qr_expires_at: expires, status: 'qr_pending',
            is_active: false, last_check_at: new Date().toISOString(),
          }).eq('tenant_id', tenantId)

          return json({ status: 'qr_pending', instance: inst, qrCode: qr, qrExpiresAt: expires })
        }
      }
    }

    /* ── QR ainda válido em cache ── */
    if (qrValid) {
      return json({
        status: 'qr_pending', instance: inst,
        qrCode: cfg.qr_code, qrExpiresAt: cfg.qr_expires_at,
      })
    }

    /* ── Sem QR e sem conexão ── */
    return json({
      status: cfg.status === 'provisioning' ? 'provisioning' : 'disconnected',
      instance: inst,
      lastError: cfg.last_error,
      retryCount: cfg.retry_count,
      disconnectedAt: cfg.disconnected_at,
    })
  } catch (err) {
    console.error('[whatsapp-status]', err)
    return json({ error: 'Erro ao consultar status', detail: String(err).slice(0, 200) }, 500)
  }
})
