// ============================================================
// EDGE FUNCTION: send-whatsapp
// Proxy seguro para Evolution API — credenciais nunca expostas no frontend
// OWASP A02, A10: secrets no Supabase Vault, sem SSRF externo direto
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile } = await supabase
      .from('profiles').select('tenant_id').eq('id', user.id).single()

    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: 'Tenant não encontrado' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: msgConfig } = await supabaseAdmin
      .from('messaging_configs').select('instance_name, api_key, is_active')
      .eq('tenant_id', profile.tenant_id).single()

    if (!msgConfig?.is_active || !msgConfig.api_key || !msgConfig.instance_name) {
      return new Response(JSON.stringify({ error: 'WhatsApp não configurado' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { phone, message } = body

    if (!phone || !/^\d{12,13}$/.test(phone)) {
      return new Response(JSON.stringify({ error: 'Número inválido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const evolutionUrl = Deno.env.get('EVOLUTION_API_URL')
    const response = await fetch(
      `${evolutionUrl}/message/sendText/${msgConfig.instance_name}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': msgConfig.api_key },
        body: JSON.stringify({
          number: phone,
          options: { delay: 500, presence: 'composing' },
          textMessage: { text: message },
        }),
      }
    )

    const result = await response.json()

    await supabaseAdmin.from('audit_logs').insert({
      tenant_id: profile.tenant_id, user_id: user.id, action: 'SEND_WHATSAPP',
      new_values: { phone_last4: phone.slice(-4), success: response.ok },
    })

    return new Response(JSON.stringify(result), {
      status: response.ok ? 200 : response.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Erro interno' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
