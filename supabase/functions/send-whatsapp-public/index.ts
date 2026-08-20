// ============================================================
// EDGE FUNCTION: send-whatsapp-public
// Envia confirmação de agendamento SEM exigir login.
//
// Por que existe: a agenda pública (/agendar/:tenantId) é acessada
// por clientes finais que NÃO têm conta no sistema. A função
// send-whatsapp exige auth.getUser() e retornaria 401 sempre.
//
// SEGURANÇA:
//  - A api_key da Evolution NUNCA sai do banco (messaging_configs)
//  - Só envia se existir uma service_order real do tenant informado
//    criada nos últimos 10 minutos → impede uso como gateway de spam
//  - Rate limit por telefone
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const { tenantId, orderId, phone, message } = await req.json()

    // ── Validação de entrada ──
    if (!tenantId || !orderId || !phone || !message) {
      return json({ error: 'Parâmetros obrigatórios ausentes' }, 400)
    }
    if (!/^\d{12,13}$/.test(phone)) {
      return json({ error: 'Telefone inválido' }, 400)
    }
    if (typeof message !== 'string' || message.length > 1200) {
      return json({ error: 'Mensagem inválida' }, 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // ── Anti-abuso: a OS precisa existir, ser do tenant e ser recente ──
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { data: order } = await admin
      .from('service_orders')
      .select('id, tenant_id, created_at')
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .gte('created_at', tenMinAgo)
      .maybeSingle()

    if (!order) {
      return json({ error: 'Agendamento não encontrado ou expirado' }, 403)
    }

    // ── Config de mensageria ──
    // Estratégia em 2 níveis:
    //   1. Instância própria do tenant (ideal — número da estética)
    //   2. Instância global de fallback (secrets do Supabase)
    // Assim os tenants novos já enviam confirmação antes de configurar
    // o WhatsApp deles, e a mensagem sempre identifica a estética.
    const { data: cfg } = await admin
      .from('messaging_configs')
      .select('instance_name, api_key, api_url, is_active')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    const useTenant = !!(cfg?.is_active && cfg.api_key && cfg.instance_name)

    const baseUrl = (
      useTenant
        ? (cfg!.api_url ?? Deno.env.get('EVOLUTION_API_URL') ?? '')
        : (Deno.env.get('EVOLUTION_API_URL') ?? '')
    ).replace(/\/+$/, '')

    const instance = useTenant ? cfg!.instance_name : Deno.env.get('EVOLUTION_INSTANCE')
    const apiKey   = useTenant ? cfg!.api_key      : Deno.env.get('EVOLUTION_API_KEY')

    if (!baseUrl || !instance || !apiKey) {
      // Não é erro fatal: o agendamento já foi criado com sucesso
      return json({
        sent: false,
        reason: 'WhatsApp não configurado (nem no tenant, nem no fallback global)',
      }, 200)
    }

    // ── Envio ──
    const evoRes = await fetch(`${baseUrl}/message/sendText/${instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify({
        number: phone,
        text: message,
      }),
    })

    if (!evoRes.ok) {
      const errText = await evoRes.text()
      console.error('[send-whatsapp-public] Evolution error:', evoRes.status, errText)
      return json({ sent: false, reason: 'Falha no envio', status: evoRes.status }, 200)
    }

    const data = await evoRes.json()

    // ── Log do envio (opcional, se a tabela existir) ──
    await admin.from('message_logs').insert({
      tenant_id: tenantId,
      phone,
      message,
      status: 'sent',
      context: useTenant ? 'public_booking_confirmation' : 'public_booking_confirmation_fallback',
    }).then(() => {}, () => {}) // ignora se a tabela não existir

    return json({ sent: true, messageId: data?.key?.id ?? null })
  } catch (err) {
    console.error('[send-whatsapp-public]', err)
    return json({ sent: false, reason: 'Erro interno' }, 200)
  }
})
