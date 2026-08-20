/**
 * Edge Function: signup-tenant
 *
 * Cria a conta completa de uma nova estética em UMA operação atômica:
 *   1. Usuário no Supabase Auth
 *   2. Tenant (empresa)
 *   3. Profile vinculado como admin
 *   4. Serviços padrão do setor
 *
 * POR QUE EXISTE:
 * A tabela `tenants` tem RLS com política `tenant_isolation`, que só
 * permite ver/alterar o próprio tenant. Um usuário recém-criado não
 * tem tenant ainda → o INSERT feito pelo frontend era bloqueado.
 * Esta função usa a service role key (server-side) para contornar isso
 * de forma controlada.
 *
 * Deploy:
 *   npx supabase functions deploy signup-tenant --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const slugify = (v: string) =>
  v.toLowerCase()
   .normalize('NFD').replace(/[̀-ͯ]/g, '')
   .replace(/[^a-z0-9]+/g, '-')
   .replace(/^-|-$/g, '')
   .slice(0, 40)

const DEFAULT_SERVICES = [
  { name: 'Lavagem Simples',        description: 'Lavagem externa completa',            price: 50,   duration_minutes: 60,  category: 'lavagem' },
  { name: 'Lavagem Completa',       description: 'Lavagem externa + interna',           price: 120,  duration_minutes: 120, category: 'lavagem' },
  { name: 'Higienização Interna',   description: 'Limpeza profunda do interior',        price: 250,  duration_minutes: 180, category: 'higienizacao' },
  { name: 'Polimento Técnico',      description: 'Correção de pintura em 3 estágios',   price: 800,  duration_minutes: 480, category: 'polimento' },
  { name: 'Vitrificação de Pintura',description: 'Proteção cerâmica da pintura',        price: 1200, duration_minutes: 480, category: 'vitrificacao' },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  let userId: string | null = null
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  try {
    const body = await req.json()
    const {
      email, password, fullName, company, cnpj, companyPhone, ownerPhone,
      planId, cep, rua, numero, complemento, bairro, cidade, uf,
    } = body

    /* ── Validação ── */
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'E-mail inválido' }, 400)
    if (!password || password.length < 8)        return json({ error: 'Senha deve ter ao menos 8 caracteres' }, 400)
    if (!fullName || fullName.trim().length < 3) return json({ error: 'Informe seu nome completo' }, 400)
    if (!company  || company.trim().length < 3)  return json({ error: 'Informe o nome da estética' }, 400)

    const plan = ['starter', 'pro', 'enterprise'].includes(planId) ? planId : 'starter'

    /* ── 1. Usuário ── */
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // já entra confirmado — evita travar o onboarding
      user_metadata: { full_name: fullName },
    })

    if (authErr) {
      const dup = /already|exists|registered/i.test(authErr.message)
      return json({ error: dup ? 'Este e-mail já possui uma conta. Faça login.' : authErr.message }, 400)
    }
    userId = created.user!.id

    /* ── 2. Tenant ── */
    let slug = slugify(company)
    const { data: taken } = await admin.from('tenants').select('id').eq('slug', slug).maybeSingle()
    if (taken) slug = `${slug}-${crypto.randomUUID().slice(0, 6)}`

    const { data: tenant, error: tenantErr } = await admin.from('tenants').insert({
      name: company.trim(),
      slug,
      plan_type: plan,
      subscription_type: 'trial',
      trial_ends_at: new Date(Date.now() + 14 * 86400000).toISOString(),
      owner_id: userId,
      full_name: fullName.trim(),
      email,
      phone: (companyPhone ?? '').replace(/\D/g, '') || null,
      whatsapp_phone: (companyPhone ?? '').replace(/\D/g, '') || null,
      cpf_cnpj: (cnpj ?? '').replace(/\D/g, '') || null,
      cep: (cep ?? '').replace(/\D/g, '') || null,
      rua: rua || null,
      numero: numero || null,
      complemento: complemento || null,
      bairro: bairro || null,
      cidade: cidade ? `${cidade}${uf ? `, ${uf}` : ''}` : null,
      estado: uf || null,
      is_active: true,
    }).select('id, name, slug').single()

    if (tenantErr) throw new Error(`Falha ao criar empresa: ${tenantErr.message}`)

    /* ── 3. Profile ── */
    const { error: profileErr } = await admin.from('profiles').upsert({
      id: userId,
      tenant_id: tenant.id,
      role: 'admin',
      full_name: fullName.trim(),
      email,
    }, { onConflict: 'id' })

    if (profileErr) throw new Error(`Falha ao vincular perfil: ${profileErr.message}`)

    /* ── 4. Serviços padrão (não bloqueia o cadastro se falhar) ── */
    await admin.from('services').insert(
      DEFAULT_SERVICES.map(s => ({ ...s, tenant_id: tenant.id, is_active: true })),
    ).then(() => {}, () => {})

    /* ── 5. Provisionamento do WhatsApp (assíncrono, não bloqueante) ──
       Dispara a criação da instância Evolution em paralelo. Se falhar,
       o tenant nasce usando o número global de fallback e o dono pode
       tentar de novo em Configurações → WhatsApp. Um problema de infra
       nunca deve virar um problema de vendas. */
    const provisionUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/provision-whatsapp`
    fetch(provisionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ tenantId: tenant.id }),
    }).catch((e) => console.warn('[signup-tenant] provisionamento adiado:', String(e)))

    return json({
      success: true,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      userId,
    })
  } catch (err) {
    console.error('[signup-tenant]', err)

    // Rollback: se o usuário foi criado mas o tenant falhou, remove o usuário
    // para o e-mail não ficar "preso" e impedir uma nova tentativa.
    if (userId) {
      await admin.auth.admin.deleteUser(userId).catch(() => {})
    }

    return json({ error: (err as Error).message ?? 'Erro ao criar conta' }, 500)
  }
})
