import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  Car, CheckCircle2, ArrowLeft, ArrowRight, Loader2, Building2, User,
  MapPin, CreditCard, Sparkles, ShieldCheck, Rocket, Eye, EyeOff, Check,
} from 'lucide-react'
import { getPriceId, type PlanId } from '@/config/plans'

/* ══════════════════════════════════════════════════════════════
   PLANOS  (espelham a Landing Page)
   ══════════════════════════════════════════════════════════════ */

const PLANS = [
  {
    id: 'starter', name: 'Padrão', subtitle: 'Para quem está começando',
    price: 97.33, accent: 'blue', badge: null,
    features: ['Até 2 serviços cadastrados', 'Clientes ilimitados', 'Ordens de serviço',
      'Financeiro básico', 'WhatsApp integrado', 'Agenda pública'],
  },
  {
    id: 'pro', name: 'Especialista', subtitle: 'Para quem já é referência',
    price: 159.90, accent: 'purple', badge: 'Mais popular',
    features: ['Até 4 serviços cadastrados', 'Tudo do Padrão', 'Campanhas em massa',
      'Múltiplos técnicos', 'Combos e assinaturas', 'Relatórios avançados'],
  },
  {
    id: 'enterprise', name: 'Premium', subtitle: 'Operação completa',
    price: 249.90, accent: 'amber', badge: null,
    features: ['Serviços ilimitados', 'Tudo do Especialista', 'Automações de retenção',
      'Controle de estoque', 'Suporte prioritário', 'Múltiplas unidades'],
  },
] as const

const ACCENT = {
  blue:   { ring: 'border-blue-500 bg-blue-50',     dot: 'bg-blue-600',   text: 'text-blue-600',   btn: 'bg-blue-600 hover:bg-blue-700' },
  purple: { ring: 'border-purple-500 bg-purple-50', dot: 'bg-purple-600', text: 'text-purple-600', btn: 'bg-purple-600 hover:bg-purple-700' },
  amber:  { ring: 'border-amber-500 bg-amber-50',   dot: 'bg-amber-600',  text: 'text-amber-600',  btn: 'bg-amber-600 hover:bg-amber-700' },
}

/* ══════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════ */

const onlyDigits = (v: string) => v.replace(/\D/g, '')

const formatDoc = (v: string) => {
  const d = onlyDigits(v).slice(0, 14)
  if (d.length <= 11) {
    return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
          .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2')
}

const formatPhone = (v: string) => {
  const d = onlyDigits(v).slice(0, 11)
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}

const formatCep = (v: string) => onlyDigits(v).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')

const slugify = (v: string) =>
  v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
   .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/* ══════════════════════════════════════════════════════════════
   UI
   ══════════════════════════════════════════════════════════════ */

const Field = ({ label, children, error, hint }: {
  label: string; children: React.ReactNode; error?: string; hint?: string
}) => (
  <div>
    <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
    {children}
    {error   && <p className="text-xs text-red-500 mt-1">{error}</p>}
    {hint && !error && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
  </div>
)

const Inp = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props}
    className={`w-full h-12 px-4 rounded-xl border-2 border-gray-200 bg-white
      focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all
      placeholder:text-gray-300 ${props.className ?? ''}`} />
)

type Step = 'plan' | 'company' | 'owner' | 'address' | 'payment'
const STEPS: Step[] = ['plan', 'company', 'owner', 'address', 'payment']
const STEP_LABEL: Record<Step, string> = {
  plan: 'Plano', company: 'Empresa', owner: 'Responsável', address: 'Endereço', payment: 'Pagamento',
}

/* ══════════════════════════════════════════════════════════════
   PAGE
   ══════════════════════════════════════════════════════════════ */

export default function Onboarding() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [step, setStep] = useState<Step>('plan')
  const [saving, setSaving] = useState(false)
  const [showPass, setShowPass] = useState(false)

  // plano
  const [planId, setPlanId] = useState<string>(params.get('plan') ?? 'pro')
  const [billing, setBilling] = useState<'trial' | 'now'>('trial')

  // empresa
  const [company, setCompany] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [companyPhone, setCompanyPhone] = useState('')

  // responsável
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ownerPhone, setOwnerPhone] = useState('')

  // endereço
  const [cep, setCep] = useState('')
  const [rua, setRua] = useState('')
  const [numero, setNumero] = useState('')
  const [complemento, setComplemento] = useState('')
  const [bairro, setBairro] = useState('')
  const [cidade, setCidade] = useState('')
  const [uf, setUf] = useState('')

  const plan = PLANS.find(p => p.id === planId) ?? PLANS[1]
  const accent = ACCENT[plan.accent]

  /* ── plano vindo da URL ── */
  useEffect(() => {
    const p = params.get('plan')
    if (p && PLANS.some(x => x.id === p)) { setPlanId(p); setStep('company') }
  }, [params])

  /* ── busca CEP ── */
  useEffect(() => {
    const d = onlyDigits(cep)
    if (d.length !== 8) return
    fetch(`https://viacep.com.br/ws/${d}/json/`)
      .then(r => r.json())
      .then(j => {
        if (j.erro) return
        setRua(j.logradouro ?? ''); setBairro(j.bairro ?? '')
        setCidade(j.localidade ?? ''); setUf(j.uf ?? '')
      })
      .catch(() => {})
  }, [cep])

  /* ── validação por etapa ── */
  const valid = (() => {
    switch (step) {
      case 'plan':    return !!planId
      case 'company': return company.trim().length >= 3 && onlyDigits(companyPhone).length >= 10
      case 'owner':   return fullName.trim().length >= 3
                          && /^\S+@\S+\.\S+$/.test(email)
                          && password.length >= 8
      case 'address': return cidade.trim().length >= 2
      default: return true
    }
  })()

  const idx = STEPS.indexOf(step)
  const goNext = () => { if (valid && idx < STEPS.length - 1) setStep(STEPS[idx + 1]) }
  const goBack = () => { if (idx > 0) setStep(STEPS[idx - 1]) }

  /* ══════════════════════════════════════════════════════════
     CRIAÇÃO DA CONTA
     ══════════════════════════════════════════════════════════ */
  const handleFinish = async () => {
    setSaving(true)
    try {
      // 1. Cria usuário + tenant + profile + serviços padrão (Edge Function,
      //    porque a RLS de `tenants` impede o frontend de criar o próprio tenant)
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/signup-tenant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          email, password, fullName,
          company, cnpj, companyPhone, ownerPhone,
          planId, cep, rua, numero, complemento, bairro, cidade, uf,
        }),
      })

      const result = await res.json()

      if (!res.ok || result.error) {
        toast.error(result.error ?? 'Não conseguimos criar sua conta.')
        setSaving(false)
        return
      }

      const tenantId: string = result.tenant.id

      // 2. Pagamento imediato → Stripe
      if (billing === 'now') {
        try {
          const cRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({
              tenant_id: tenantId,
              plan_id: planId,
              price_id: getPriceId(planId as PlanId),   // null → price_data inline
              amount: Math.round(plan.price * 100),
              customer_email: email,
              success_url: `${window.location.origin}/dashboard?welcome=1`,
              cancel_url: `${window.location.origin}/onboarding?plan=${planId}`,
            }),
          })
          const { url } = await cRes.json()
          if (url) { window.location.href = url; return }
          toast.info('Checkout indisponível — sua conta foi criada com 14 dias grátis.')
        } catch {
          toast.info('Checkout indisponível — sua conta foi criada com 14 dias grátis.')
        }
      }

      // 3. Login automático — o usuário já entra no sistema
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })

      if (signInErr) {
        toast.success('Conta criada! Faça login para começar. 🚗')
        navigate('/login?welcome=1')
        return
      }

      toast.success(`Bem-vindo, ${fullName.split(' ')[0]}! Sua estética está pronta. 🚗`)
      navigate('/dashboard')
    } catch (err) {
      console.error('[Onboarding]', err)
      toast.error('Não conseguimos criar sua conta. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  /* ══════════════════════════════════════════════════════════ */

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
              <Car className="w-5 h-5 text-white" />
            </div>
            <span className="font-black text-gray-900">Auto Estética Flow</span>
          </Link>
          <Link to="/login" className="text-sm text-gray-500 hover:text-gray-800">
            Já tenho conta
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-8 pb-32">
        {/* Stepper */}
        <div className="flex items-center gap-1.5 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1">
              <div className={`h-1.5 rounded-full transition-all ${i <= idx ? 'bg-blue-600' : 'bg-gray-200'}`} />
              <span className={`text-[10px] font-medium mt-1.5 hidden sm:block ${i === idx ? 'text-blue-600' : 'text-gray-400'}`}>
                {STEP_LABEL[s]}
              </span>
            </div>
          ))}
        </div>

        {/* ═══ ETAPA 1: PLANO ═══ */}
        {step === 'plan' && (
          <Card icon={<Sparkles className="w-6 h-6 text-blue-600" />}
            title="Escolha seu plano"
            subtitle="Todos começam com 14 dias grátis. Sem compromisso.">
            <div className="grid md:grid-cols-3 gap-4">
              {PLANS.map(p => {
                const a = ACCENT[p.accent]
                const sel = planId === p.id
                return (
                  <button key={p.id} onClick={() => setPlanId(p.id)}
                    className={`relative text-left p-5 rounded-2xl border-2 transition-all
                      ${sel ? a.ring : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                    {p.badge && (
                      <span className={`absolute -top-2.5 left-4 text-[10px] font-bold text-white px-2.5 py-1 rounded-full ${a.dot}`}>
                        {p.badge}
                      </span>
                    )}
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-black text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-500">{p.subtitle}</p>
                      </div>
                      {sel && <CheckCircle2 className={`w-5 h-5 shrink-0 ${a.text}`} />}
                    </div>
                    <p className={`text-2xl font-black ${a.text}`}>
                      {money(p.price)}<span className="text-xs font-normal text-gray-400">/mês</span>
                    </p>
                    <ul className="mt-3 space-y-1.5">
                      {p.features.map(f => (
                        <li key={f} className="flex items-start gap-1.5 text-xs text-gray-600">
                          <Check className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${a.text}`} />{f}
                        </li>
                      ))}
                    </ul>
                  </button>
                )
              })}
            </div>
          </Card>
        )}

        {/* ═══ ETAPA 2: EMPRESA ═══ */}
        {step === 'company' && (
          <Card icon={<Building2 className="w-6 h-6 text-blue-600" />}
            title="Sobre a sua estética"
            subtitle="Esses dados aparecem na sua agenda pública e nas mensagens.">
            <div className="space-y-4">
              <Field label="Nome da estética *" hint="É o nome que seus clientes vão ver">
                <Inp placeholder="Premium Detail SP" value={company}
                  onChange={e => setCompany(e.target.value)} autoFocus />
              </Field>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="CNPJ ou CPF">
                  <Inp inputMode="numeric" placeholder="00.000.000/0000-00" value={cnpj}
                    onChange={e => setCnpj(formatDoc(e.target.value))} />
                </Field>
                <Field label="WhatsApp da estética *" hint="Usado nas confirmações">
                  <Inp inputMode="tel" placeholder="(11) 99999-9999" value={companyPhone}
                    onChange={e => setCompanyPhone(formatPhone(e.target.value))} />
                </Field>
              </div>
            </div>
          </Card>
        )}

        {/* ═══ ETAPA 3: RESPONSÁVEL ═══ */}
        {step === 'owner' && (
          <Card icon={<User className="w-6 h-6 text-blue-600" />}
            title="Dados de acesso"
            subtitle="Você usará esses dados para entrar no sistema.">
            <div className="space-y-4">
              <Field label="Seu nome completo *">
                <Inp placeholder="João da Silva" value={fullName}
                  onChange={e => setFullName(e.target.value)} autoFocus />
              </Field>
              <Field label="E-mail *" hint="Será seu login"
                error={email && !/^\S+@\S+\.\S+$/.test(email) ? 'E-mail inválido' : undefined}>
                <Inp type="email" placeholder="voce@email.com" value={email}
                  onChange={e => setEmail(e.target.value.trim())} />
              </Field>
              <Field label="Senha *" hint="Mínimo de 8 caracteres"
                error={password && password.length < 8 ? 'Senha muito curta' : undefined}>
                <div className="relative">
                  <Inp type={showPass ? 'text' : 'password'} placeholder="••••••••" value={password}
                    onChange={e => setPassword(e.target.value)} className="pr-12" />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </Field>
              <Field label="Seu celular (opcional)">
                <Inp inputMode="tel" placeholder="(11) 99999-9999" value={ownerPhone}
                  onChange={e => setOwnerPhone(formatPhone(e.target.value))} />
              </Field>
            </div>
          </Card>
        )}

        {/* ═══ ETAPA 4: ENDEREÇO ═══ */}
        {step === 'address' && (
          <Card icon={<MapPin className="w-6 h-6 text-blue-600" />}
            title="Onde fica a estética?"
            subtitle="Ajuda seus clientes a te encontrarem.">
            <div className="space-y-4">
              <div className="grid sm:grid-cols-3 gap-4">
                <Field label="CEP" hint="Preenchemos o resto">
                  <Inp inputMode="numeric" placeholder="00000-000" value={cep}
                    onChange={e => setCep(formatCep(e.target.value))} autoFocus />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Rua">
                    <Inp placeholder="Av. Paulista" value={rua} onChange={e => setRua(e.target.value)} />
                  </Field>
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <Field label="Número">
                  <Inp placeholder="1000" value={numero} onChange={e => setNumero(e.target.value)} />
                </Field>
                <Field label="Complemento">
                  <Inp placeholder="Sala 12" value={complemento} onChange={e => setComplemento(e.target.value)} />
                </Field>
                <Field label="Bairro">
                  <Inp placeholder="Bela Vista" value={bairro} onChange={e => setBairro(e.target.value)} />
                </Field>
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <Field label="Cidade *">
                    <Inp placeholder="São Paulo" value={cidade} onChange={e => setCidade(e.target.value)} />
                  </Field>
                </div>
                <Field label="UF">
                  <Inp placeholder="SP" maxLength={2} value={uf}
                    onChange={e => setUf(e.target.value.toUpperCase())} />
                </Field>
              </div>
            </div>
          </Card>
        )}

        {/* ═══ ETAPA 5: PAGAMENTO ═══ */}
        {step === 'payment' && (
          <Card icon={<CreditCard className="w-6 h-6 text-blue-600" />}
            title="Quase lá!"
            subtitle="Escolha como quer começar.">

            {/* Resumo */}
            <div className="p-5 bg-gray-50 rounded-2xl mb-5 space-y-2.5">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Resumo</p>
              <Row label="Estética" value={company} />
              <Row label="Responsável" value={fullName} />
              <Row label="E-mail" value={email} />
              {cidade && <Row label="Cidade" value={cidade} />}
              <div className="pt-2.5 border-t border-gray-200 flex justify-between items-center">
                <div>
                  <p className="font-bold text-gray-800">Plano {plan.name}</p>
                  <p className="text-xs text-gray-400">{plan.subtitle}</p>
                </div>
                <p className={`font-black text-xl ${accent.text}`}>
                  {money(plan.price)}<span className="text-xs font-normal text-gray-400">/mês</span>
                </p>
              </div>
            </div>

            {/* Opções */}
            <div className="space-y-3">
              <button onClick={() => setBilling('trial')}
                className={`w-full p-4 rounded-2xl border-2 text-left flex items-center gap-4 transition-all
                  ${billing === 'trial' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0
                  ${billing === 'trial' ? 'bg-blue-600' : 'bg-gray-100'}`}>
                  <Rocket className={`w-5 h-5 ${billing === 'trial' ? 'text-white' : 'text-gray-500'}`} />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-gray-900">Começar com 14 dias grátis</p>
                  <p className="text-sm text-gray-500">Sem cartão agora. Cobramos só depois do teste.</p>
                </div>
                {billing === 'trial' && <CheckCircle2 className="w-5 h-5 text-blue-600 ml-auto shrink-0" />}
              </button>

              <button onClick={() => setBilling('now')}
                className={`w-full p-4 rounded-2xl border-2 text-left flex items-center gap-4 transition-all
                  ${billing === 'now' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0
                  ${billing === 'now' ? 'bg-blue-600' : 'bg-gray-100'}`}>
                  <CreditCard className={`w-5 h-5 ${billing === 'now' ? 'text-white' : 'text-gray-500'}`} />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-gray-900">Assinar agora</p>
                  <p className="text-sm text-gray-500">Ativa imediatamente via cartão ou Pix</p>
                </div>
                {billing === 'now' && <CheckCircle2 className="w-5 h-5 text-blue-600 ml-auto shrink-0" />}
              </button>
            </div>

            <p className="flex items-start gap-2 text-xs text-gray-400 mt-5">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              Seus dados são protegidos. Pagamentos processados pela Stripe — não armazenamos dados do cartão.
            </p>
          </Card>
        )}
      </main>

      {/* ── Barra de ações ── */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 p-4 shadow-[0_-4px_20px_rgba(0,0,0,0.04)]">
        <div className="max-w-3xl mx-auto flex gap-3">
          {idx > 0 && (
            <button onClick={goBack} disabled={saving}
              className="h-13 px-6 py-3 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition-all flex items-center gap-2">
              <ArrowLeft className="w-5 h-5" /><span className="hidden sm:inline">Voltar</span>
            </button>
          )}
          {step === 'payment' ? (
            <button onClick={handleFinish} disabled={saving}
              className={`flex-1 h-13 py-3 rounded-xl text-white font-bold text-lg shadow-lg transition-all
                flex items-center justify-center gap-2 disabled:opacity-40 ${accent.btn}`}>
              {saving
                ? <><Loader2 className="w-5 h-5 animate-spin" />Criando sua conta…</>
                : billing === 'now'
                  ? <><CreditCard className="w-5 h-5" />Assinar e criar conta</>
                  : <><Rocket className="w-5 h-5" />Começar 14 dias grátis</>}
            </button>
          ) : (
            <button onClick={goNext} disabled={!valid}
              className="flex-1 h-13 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg
                shadow-lg shadow-blue-600/25 transition-all flex items-center justify-center gap-2
                disabled:opacity-40 disabled:shadow-none">
              Continuar <ArrowRight className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════ */

function Card({ icon, title, subtitle, children }: {
  icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-gray-100">
      <div className="flex items-start gap-3 mb-6">
        <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center shrink-0">{icon}</div>
        <div>
          <h2 className="text-xl font-black text-gray-900 leading-tight">{title}</h2>
          <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center gap-4 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="font-semibold text-gray-800 text-right truncate">{value}</span>
    </div>
  )
}
