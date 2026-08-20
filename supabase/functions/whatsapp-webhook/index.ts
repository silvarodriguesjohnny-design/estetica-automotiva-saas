/**
 * Edge Function: whatsapp-webhook
 *
 * Recebe eventos da Evolution API e mantém o estado da instância
 * sincronizado no banco. É o que transforma o provisionamento de
 * "esperança" em algo observável.
 *
 * EVENTOS TRATADOS:
 *   CONNECTION_UPDATE  state: open   → connected   (grava o número real)
 *                      state: close  → disconnected
 *                      state: connecting → qr_pending
 *   QRCODE_UPDATED     novo QR gerado → atualiza qr_code + validade
 *
 * SEGURANÇA:
 *   A Evolution chama esta URL sem autenticação Supabase, então
 *   validamos por um token secreto na querystring, único por tenant,
 *   gerado no provisionamento. Sem o token válido → 401.
 *
 * Deploy (OBRIGATÓRIO sem JWT — a Evolution não manda Bearer):
 *   npx supabase functions deploy whatsapp-webhook --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Extrai o número conectado do payload (o formato varia por versão da Evolution). */
function extractNumber(payload: Record<string, any>): string | null {
  const raw =
    payload?.data?.wuid ??
    payload?.data?.instance?.wuid ??
    payload?.wuid ??
    payload?.data?.owner ??
    payload?.sender ??
    null
  if (!raw || typeof raw !== 'string') return null
  // formato típico: "5511995482267@s.whatsapp.net"
  const digits = raw.split('@')[0].replace(/\D/g, '')
  return digits.length >= 10 ? digits : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  try {
    /* ── Validação do token ── */
    const token = new URL(req.url).searchParams.get('token')
    if (!token || token.length < 16) return json({ error: 'Token ausente' }, 401)

    const { data: cfg } = await admin
      .from('messaging_configs')
      .select('tenant_id, instance_name, status')
      .eq('webhook_token', token)
      .maybeSingle()

    if (!cfg) return json({ error: 'Token inválido' }, 401)

    /* ── Payload ── */
    const payload = await req.json().catch(() => ({}))
    const event: string = payload?.event ?? payload?.type ?? ''
    const instance: string = payload?.instance ?? payload?.instanceName ?? ''

    // Confere que o evento é da instância certa (defesa contra token reutilizado)
    if (instance && cfg.instance_name && instance !== cfg.instance_name) {
      console.warn('[whatsapp-webhook] instância divergente:', instance, '≠', cfg.instance_name)
      return json({ ok: true, ignored: 'instância divergente' })
    }

    const evtUpper = event.toUpperCase().replace(/\./g, '_')

    /* ══ QRCODE_UPDATED ══ */
    if (evtUpper.includes('QRCODE')) {
      const qr = payload?.data?.qrcode?.base64 ?? payload?.data?.base64 ?? payload?.qrcode?.base64 ?? null
      if (qr) {
        await admin.from('messaging_configs').update({
          qr_code: qr,
          qr_expires_at: new Date(Date.now() + 60_000).toISOString(),
          status: 'qr_pending',
          is_active: false,
          last_check_at: new Date().toISOString(),
        }).eq('tenant_id', cfg.tenant_id)

        await admin.from('whatsapp_events').insert({
          tenant_id: cfg.tenant_id, instance: cfg.instance_name,
          event_type: 'qr_generated', from_status: cfg.status, to_status: 'qr_pending',
          detail: 'QR renovado pela Evolution',
        }).then(() => {}, () => {})
      }
      return json({ ok: true })
    }

    /* ══ CONNECTION_UPDATE ══ */
    if (evtUpper.includes('CONNECTION')) {
      const state: string = payload?.data?.state ?? payload?.state ?? payload?.data?.connection ?? ''

      let next: string
      if (state === 'open')            next = 'connected'
      else if (state === 'connecting') next = 'qr_pending'
      else                             next = 'disconnected'   // 'close' ou desconhecido

      const patch: Record<string, unknown> = {
        status: next,
        is_active: next === 'connected',
        last_check_at: new Date().toISOString(),
      }

      if (next === 'connected') {
        const num = extractNumber(payload)
        patch.connected_at = new Date().toISOString()
        patch.qr_code = null
        patch.qr_expires_at = null
        patch.retry_count = 0
        patch.last_error = null
        if (num) patch.connected_number = num
      }

      if (next === 'disconnected') {
        patch.disconnected_at = new Date().toISOString()
      }

      await admin.from('messaging_configs').update(patch).eq('tenant_id', cfg.tenant_id)

      await admin.from('whatsapp_events').insert({
        tenant_id: cfg.tenant_id, instance: cfg.instance_name,
        event_type: next, from_status: cfg.status, to_status: next,
        detail: `Evolution reportou state="${state}"`,
      }).then(() => {}, () => {})

      console.log(`[whatsapp-webhook] ${cfg.instance_name}: ${cfg.status} → ${next}`)
      return json({ ok: true, status: next })
    }

    // Evento não tratado — responde 200 para a Evolution não ficar reenviando
    return json({ ok: true, ignored: event })
  } catch (err) {
    console.error('[whatsapp-webhook]', err)
    // Sempre 200: erro nosso não deve fazer a Evolution entrar em loop de retry
    return json({ ok: false, error: String(err).slice(0, 200) }, 200)
  }
})
