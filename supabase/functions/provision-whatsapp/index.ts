/**
 * Edge Function: provision-whatsapp
 * Cria uma instância Evolution API para uma empresa quando ela assina um plano.
 * Chamada automaticamente pelo webhook Stripe ou manualmente pelo admin.
 *
 * SEGURANÇA: A Global API Key do Evolution NUNCA vai para o frontend.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'

const EVOLUTION_URL = Deno.env.get('EVOLUTION_API_URL')!
const EVOLUTION_KEY = Deno.env.get('EVOLUTION_GLOBAL_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Autenticar como admin (service role)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const body = await req.json()
    const { company_id, company_name } = body

    if (!company_id || !company_name) {
      return new Response(JSON.stringify({ error: 'company_id e company_name obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Nome da instância: autodetail-{slug da empresa}
    const slug = company_name.toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 30)
    const instanceName = `autodetail-${slug}-${company_id.substring(0, 8)}`

    // Verificar se já existe config para esta empresa
    const { data: existing } = await supabase
      .from('messaging_configs')
      .select('id')
      .eq('company_id', company_id)
      .single()

    if (existing) {
      return new Response(JSON.stringify({ message: 'Instância já configurada', instance: instanceName }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Criar instância no Evolution API
    const createResp = await fetch(`${EVOLUTION_URL}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
      body: JSON.stringify({
        instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        webhook: {
          enabled: true,
          url: `${SUPABASE_URL}/functions/v1/whatsapp-webhook`,
          events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
        }
      })
    })

    if (!createResp.ok) {
      const err = await createResp.text()
      throw new Error(`Evolution API error: ${err}`)
    }

    const instanceData = await createResp.json()
    const instanceKey = instanceData.hash || instanceName

    // Salvar configuração no Supabase (NUNCA expostas ao frontend via RLS)
    await supabase.from('messaging_configs').insert({
      company_id,
      provider: 'evolution',
      instance_name: instanceName,
      api_key: instanceKey,
      base_url: EVOLUTION_URL,
      active: true,
    })

    // Buscar QR code
    const qrResp = await fetch(`${EVOLUTION_URL}/instance/connect/${instanceName}`, {
      headers: { 'apikey': EVOLUTION_KEY }
    })
    const qrData = await qrResp.json()

    return new Response(JSON.stringify({
      success: true,
      instance: instanceName,
      qrCode: qrData.base64 || null,
      status: instanceData.instance?.status || 'connecting',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
