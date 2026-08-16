import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import {
  Car, Clock, CheckCircle2, ArrowLeft, ArrowRight, User, Repeat,
  Sparkles, CreditCard, Store, Calendar as CalendarIcon, Loader2,
  MessageCircle, ShieldCheck, Tag,
} from 'lucide-react'
import { toast } from 'sonner'

/* ══════════════════════════════════════════════════════════════
   TYPES
   ══════════════════════════════════════════════════════════════ */

interface Tenant {
  id: string; name: string; logo_url: string | null
  cidade: string | null; phone: string | null
}
interface Service {
  id: string; name: string; description: string | null
  price: number; duration_minutes: number | null; category: string | null
}
interface Plan {
  id: string; name: string; description: string | null
  price: number; interval: string; sessions: number | null; services: string[] | null
}
interface Customer {
  id: string; name: string; phone: string | null; email: string | null
}
interface Vehicle {
  id: string; brand: string; model: string; plate: string | null; color: string | null
}

type Step = 'identify' | 'register' | 'vehicle' | 'offer' | 'datetime' | 'payment' | 'done'
type OfferKind = 'service' | 'plan'

/* ══════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════ */

const onlyDigits = (v: string) => v.replace(/\D/g, '')

function formatDoc(v: string) {
  const d = onlyDigits(v).slice(0, 14)
  if (d.length <= 11) {
    return d.replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return d.replace(/^(\d{2})(\d)/, '$1.$2')
          .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
          .replace(/\.(\d{3})(\d)/, '.$1/$2')
          .replace(/(\d{4})(\d)/, '$1-$2')
}

function formatPhone(v: string) {
  const d = onlyDigits(v).slice(0, 11)
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}

function isValidCPF(cpf: string) {
  const d = onlyDigits(cpf)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += +d[i] * (10 - i)
  let check = (sum * 10) % 11 % 10
  if (check !== +d[9]) return false
  sum = 0
  for (let i = 0; i < 10; i++) sum += +d[i] * (11 - i)
  check = (sum * 10) % 11 % 10
  return check === +d[10]
}

function isValidCNPJ(cnpj: string) {
  const d = onlyDigits(cnpj)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const calc = (len: number) => {
    let sum = 0, pos = len - 7
    for (let i = 0; i < len; i++) { sum += +d[i] * pos--; if (pos < 2) pos = 9 }
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(12) === +d[12] && calc(13) === +d[13]
}

const isValidDoc = (v: string) => {
  const d = onlyDigits(v)
  return d.length === 11 ? isValidCPF(d) : d.length === 14 ? isValidCNPJ(d) : false
}

const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const INTERVAL_LABEL: Record<string, string> = {
  single: 'pacote avulso', monthly: '/mês', quarterly: '/trimestre', yearly: '/ano',
}

function generateSlots(from = 8, to = 18) {
  const out: string[] = []
  for (let h = from; h < to; h++) {
    out.push(`${String(h).padStart(2, '0')}:00`)
    out.push(`${String(h).padStart(2, '0')}:30`)
  }
  return out
}

/* ── PWA: manifest dinâmico por tenant ─────────────────────── */
function usePWA(tenant: Tenant | null) {
  useEffect(() => {
    if (!tenant) return
    const manifest = {
      name: `Agendamento — ${tenant.name}`,
      short_name: tenant.name.slice(0, 12),
      start_url: `/agendar/${tenant.id}`,
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#1B4FD8',
      icons: [
        { src: '/pwa-icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    }
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'manifest'
      document.head.appendChild(link)
    }
    link.href = url
    document.title = `Agendar — ${tenant.name}`
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw-booking.js').catch(() => {})
    }
    return () => URL.revokeObjectURL(url)
  }, [tenant])
}

/* ══════════════════════════════════════════════════════════════
   UI PRIMITIVES  (tablet-first: alvos grandes, texto legível)
   ══════════════════════════════════════════════════════════════ */

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <div>
    <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
    {children}
    {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
  </div>
)

const TInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props}
    className={`w-full h-14 px-4 text-lg rounded-xl border-2 border-gray-200 bg-white
      focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all
      placeholder:text-gray-300 ${props.className ?? ''}`} />
)

const PrimaryBtn = ({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...p}
    className={`h-14 px-8 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800
      text-white font-bold text-lg shadow-lg shadow-blue-600/25
      disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
      transition-all flex items-center justify-center gap-2 ${p.className ?? ''}`}>
    {children}
  </button>
)

const GhostBtn = ({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...p}
    className={`h-14 px-6 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold
      hover:bg-gray-50 transition-all flex items-center justify-center gap-2 ${p.className ?? ''}`}>
    {children}
  </button>
)

/* ── Stepper ─────────────────────────────────────────────────── */
const STEP_LABELS: Record<Step, string> = {
  identify: 'Identificação', register: 'Seus dados', vehicle: 'Veículo',
  offer: 'Serviço', datetime: 'Data e hora', payment: 'Pagamento', done: 'Pronto',
}
const FLOW: Step[] = ['identify', 'register', 'vehicle', 'offer', 'datetime', 'payment']

function Stepper({ current, skipRegister }: { current: Step; skipRegister: boolean }) {
  const steps = FLOW.filter(s => !(skipRegister && s === 'register'))
  const idx = steps.indexOf(current)
  if (current === 'done') return null
  return (
    <div className="flex items-center gap-1 mb-6">
      {steps.map((s, i) => (
        <div key={s} className="flex-1 flex flex-col gap-1.5">
          <div className={`h-1.5 rounded-full transition-all ${i <= idx ? 'bg-blue-600' : 'bg-gray-200'}`} />
          <span className={`text-[10px] font-medium hidden sm:block ${i === idx ? 'text-blue-600' : 'text-gray-400'}`}>
            {STEP_LABELS[s]}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   PAGE
   ══════════════════════════════════════════════════════════════ */

export default function PublicBooking() {
  const { tenantId } = useParams()

  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)

  const [step, setStep] = useState<Step>('identify')
  const [saving, setSaving] = useState(false)

  // identificação
  const [doc, setDoc] = useState('')
  const [checking, setChecking] = useState(false)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [isReturning, setIsReturning] = useState(false)

  // cadastro
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')

  // veículo
  const [savedVehicles, setSavedVehicles] = useState<Vehicle[]>([])
  const [vehicleId, setVehicleId] = useState<string | null>(null)
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [plate, setPlate] = useState('')
  const [color, setColor] = useState('')

  // oferta
  const [offerKind, setOfferKind] = useState<OfferKind>('service')
  const [serviceId, setServiceId] = useState('')
  const [planId, setPlanId] = useState('')

  // data/hora
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [busySlots, setBusySlots] = useState<string[]>([])

  // pagamento
  const [payWhen, setPayWhen] = useState<'now' | 'local'>('local')
  const [bookingRef, setBookingRef] = useState('')

  usePWA(tenant)

  /* ── carregar dados do tenant ── */
  useEffect(() => {
    if (!tenantId) return
    ;(async () => {
      const [t, s, p] = await Promise.all([
        supabase.from('tenants').select('id, name, logo_url, cidade, phone').eq('id', tenantId).single(),
        supabase.from('services').select('id, name, description, price, duration_minutes, category')
          .eq('tenant_id', tenantId).eq('is_active', true).order('price'),
        supabase.from('subscription_plans').select('id, name, description, price, interval, sessions, services')
          .eq('tenant_id', tenantId).eq('is_active', true).order('price'),
      ])
      setTenant(t.data as Tenant)
      setServices((s.data as Service[]) ?? [])
      setPlans((p.data as Plan[]) ?? [])
      setLoading(false)
    })()
  }, [tenantId])

  /* ── horários ocupados no dia escolhido ── */
  useEffect(() => {
    if (!date || !tenantId) { setBusySlots([]); return }
    ;(async () => {
      const { data } = await supabase
        .from('service_orders')
        .select('start_time')
        .eq('tenant_id', tenantId)
        .gte('start_time', `${date}T00:00:00`)
        .lte('start_time', `${date}T23:59:59`)
      setBusySlots((data ?? []).map((o: { start_time: string }) => o.start_time.slice(11, 16)))
    })()
  }, [date, tenantId])

  /* ── busca por CPF/CNPJ ── */
  const handleIdentify = useCallback(async () => {
    const raw = onlyDigits(doc)
    if (!isValidDoc(doc)) {
      toast.error(raw.length <= 11 ? 'CPF inválido' : 'CNPJ inválido')
      return
    }
    setChecking(true)
    const { data } = await supabase
      .from('customers').select('id, name, phone, email')
      .eq('tenant_id', tenantId!).eq('cpf_cnpj', raw).maybeSingle()

    if (data) {
      const c = data as Customer
      setCustomer(c); setIsReturning(true)
      setName(c.name); setPhone(c.phone ?? ''); setEmail(c.email ?? '')
      const { data: vs } = await supabase
        .from('vehicles').select('id, brand, model, plate, color').eq('customer_id', c.id)
      setSavedVehicles((vs as Vehicle[]) ?? [])
      toast.success(`Bem-vindo de volta, ${c.name.split(' ')[0]}!`)
      setStep('vehicle')
    } else {
      setIsReturning(false)
      setStep('register')
    }
    setChecking(false)
  }, [doc, tenantId])

  /* ── navegação ── */
  const goBack = () => {
    const seq = FLOW.filter(s => !(isReturning && s === 'register'))
    const i = seq.indexOf(step)
    if (i > 0) setStep(seq[i - 1])
  }

  /* ── seleção atual ── */
  const selectedService = services.find(s => s.id === serviceId)
  const selectedPlan = plans.find(p => p.id === planId)
  const totalPrice = offerKind === 'plan' ? (selectedPlan?.price ?? 0) : (selectedService?.price ?? 0)
  const offerName = offerKind === 'plan' ? selectedPlan?.name : selectedService?.name

  /* ── finalizar agendamento ── */
  const handleConfirm = async () => {
    if (!tenantId || !date || !time) return
    setSaving(true)
    try {
      // 1. Cliente
      let cid = customer?.id
      if (!cid) {
        const { data: newC, error } = await supabase.from('customers').insert({
          tenant_id: tenantId, name, phone: onlyDigits(phone),
          email: email || null, cpf_cnpj: onlyDigits(doc),
        }).select('id').single()
        if (error) throw error
        cid = newC.id
      }

      // 2. Veículo
      let vid = vehicleId
      if (!vid) {
        const { data: newV, error } = await supabase.from('vehicles').insert({
          tenant_id: tenantId, customer_id: cid,
          brand: brand || 'Não informado', model: model || '',
          plate: plate ? plate.toUpperCase() : null, color: color || null,
        }).select('id').single()
        if (error) throw error
        vid = newV.id
      }

      // 3. Ordem de serviço
      const { data: order, error: orderErr } = await supabase.from('service_orders').insert({
        tenant_id: tenantId, customer_id: cid, vehicle_id: vid,
        status: 'pending',
        start_time: `${date}T${time}:00`,
        total_amount: totalPrice,
        subscription_plan_id: offerKind === 'plan' ? planId : null,
        payment_status: payWhen === 'now' ? 'pending' : 'pending',
        source: 'public_booking',
        customer_notes: offerKind === 'plan' ? `Assinatura: ${selectedPlan?.name}` : null,
      }).select('id').single()
      if (orderErr) throw orderErr

      // 4. Item da OS (só para serviço avulso)
      if (offerKind === 'service' && selectedService) {
        await supabase.from('service_order_items').insert({
          service_order_id: order.id, service_id: selectedService.id,
          name: selectedService.name, price: selectedService.price, quantity: 1,
        }).then(() => {}, () => {})
      }

      const ref = order.id.slice(0, 8).toUpperCase()
      setBookingRef(ref)

      // 5. Confirmação por WhatsApp (função pública, não exige login)
      const msg =
        `✅ *Agendamento confirmado!*\n\n` +
        `Olá, *${name.split(' ')[0]}*! Seu horário na *${tenant?.name}* está reservado.\n\n` +
        `📋 Código: *${ref}*\n` +
        `${offerKind === 'plan' ? '🔄' : '🚗'} ${offerName}\n` +
        `📅 ${date.split('-').reverse().join('/')} às ${time}\n` +
        `💰 ${money(totalPrice)}${offerKind === 'plan' ? ` ${INTERVAL_LABEL[selectedPlan?.interval ?? 'single']}` : ''}\n` +
        `${payWhen === 'now' ? '💳 Pagamento antecipado' : '🏪 Pagamento no local'}\n\n` +
        `Qualquer dúvida, é só chamar. Até breve! 🚗✨`

      const cleanPhone = onlyDigits(phone).length === 11
        ? `55${onlyDigits(phone)}`
        : onlyDigits(phone).startsWith('55') ? onlyDigits(phone) : `55${onlyDigits(phone)}`

      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-whatsapp-public`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ tenantId, orderId: order.id, phone: cleanPhone, message: msg }),
      }).catch(() => {}) // falha no WhatsApp não invalida o agendamento

      // 6. Pagamento antecipado via Stripe
      if (payWhen === 'now') {
        try {
          const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({
              orderId: order.id, tenantId,
              amount: Math.round(totalPrice * 100),
              description: `${offerName} — ${tenant?.name}`,
              mode: offerKind === 'plan' && selectedPlan?.interval !== 'single' ? 'subscription' : 'payment',
              customerEmail: email || undefined,
            }),
          })
          const { url } = await res.json()
          if (url) { window.location.href = url; return }
          toast.info('Não foi possível abrir o pagamento online. Você pode pagar no local.')
        } catch {
          toast.info('Pagamento online indisponível. Você pode pagar no local.')
        }
      }

      setStep('done')
    } catch (err) {
      console.error('[PublicBooking]', err)
      toast.error('Não conseguimos concluir o agendamento. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  /* ── validações por etapa ── */
  const canAdvance = (() => {
    switch (step) {
      case 'identify': return isValidDoc(doc)
      case 'register': return name.trim().length >= 3 && onlyDigits(phone).length >= 10
      case 'vehicle':  return !!vehicleId || brand.trim().length >= 2
      case 'offer':    return offerKind === 'plan' ? !!planId : !!serviceId
      case 'datetime': return !!date && !!time
      default: return true
    }
  })()

  const goNext = () => {
    if (!canAdvance) return
    if (step === 'identify') { handleIdentify(); return }
    const seq = FLOW.filter(s => !(isReturning && s === 'register'))
    const i = seq.indexOf(step)
    if (i < seq.length - 1) setStep(seq[i + 1])
  }

  /* ══════════════════════════════════════════════════════════ */

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!tenant) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="text-center">
          <Car className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-700">Estética não encontrada</h1>
          <p className="text-gray-400 mt-1">Verifique o link de agendamento.</p>
        </div>
      </div>
    )
  }

  /* ── Tela final ── */
  if (step === 'done') {
    const waLink = tenant.phone
      ? `https://wa.me/${onlyDigits(tenant.phone).length === 11 ? '55' + onlyDigits(tenant.phone) : onlyDigits(tenant.phone)}`
      : null
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl p-8 text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 className="w-11 h-11 text-green-600" />
          </div>
          <h1 className="text-2xl font-black text-gray-900">Agendamento confirmado!</h1>
          <p className="text-gray-500 mt-1">Enviamos a confirmação no seu WhatsApp.</p>

          <div className="my-6 p-5 bg-gray-50 rounded-2xl text-left space-y-2.5">
            <div className="flex justify-between items-center pb-2.5 border-b border-gray-200">
              <span className="text-sm text-gray-500">Código</span>
              <span className="font-mono font-black text-blue-600 text-lg">{bookingRef}</span>
            </div>
            <Row label="Cliente" value={name} />
            <Row label={offerKind === 'plan' ? 'Assinatura' : 'Serviço'} value={offerName ?? '—'} />
            <Row label="Data" value={`${date.split('-').reverse().join('/')} às ${time}`} />
            <Row label="Valor" value={money(totalPrice)} bold />
            <Row label="Pagamento" value={payWhen === 'now' ? 'Antecipado' : 'No local'} />
          </div>

          {waLink && (
            <a href={waLink} target="_blank" rel="noopener noreferrer" className="block">
              <PrimaryBtn className="w-full bg-green-600 hover:bg-green-700 shadow-green-600/25">
                <MessageCircle className="w-5 h-5" />Falar com a estética
              </PrimaryBtn>
            </a>
          )}
          <button onClick={() => window.location.reload()}
            className="mt-3 text-sm text-gray-400 hover:text-gray-600 underline">
            Fazer outro agendamento
          </button>
        </div>
      </div>
    )
  }

  /* ── Wizard ── */
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-5 py-4 flex items-center gap-3">
          <div className="w-11 h-11 bg-blue-600 rounded-xl flex items-center justify-center shrink-0 overflow-hidden">
            {tenant.logo_url
              ? <img src={tenant.logo_url} alt="" className="w-full h-full object-cover" />
              : <Car className="w-6 h-6 text-white" />}
          </div>
          <div className="min-w-0">
            <h1 className="font-black text-gray-900 leading-tight truncate">{tenant.name}</h1>
            {tenant.cidade && <p className="text-xs text-gray-400">{tenant.cidade}</p>}
          </div>
          <span className="ml-auto text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full shrink-0">
            Agendamento online
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-6 pb-32">
        <Stepper current={step} skipRegister={isReturning} />

        {/* ── ETAPA 1: IDENTIFICAÇÃO ── */}
        {step === 'identify' && (
          <Section
            icon={<ShieldCheck className="w-6 h-6 text-blue-600" />}
            title="Vamos começar"
            subtitle="Informe seu CPF ou CNPJ para identificarmos seu cadastro">
            <Field label="CPF ou CNPJ" hint="Se já é cliente, buscamos seus dados automaticamente">
              <TInput
                inputMode="numeric" placeholder="000.000.000-00"
                value={doc} onChange={e => setDoc(formatDoc(e.target.value))}
                onKeyDown={e => e.key === 'Enter' && canAdvance && handleIdentify()}
                autoFocus />
            </Field>

            <div className="grid grid-cols-2 gap-3 mt-5">
              <div className="p-4 rounded-2xl bg-blue-50 border-2 border-blue-100">
                <User className="w-5 h-5 text-blue-600 mb-2" />
                <p className="font-bold text-sm text-blue-900">Já sou cliente</p>
                <p className="text-xs text-blue-700 mt-0.5">Preenchemos tudo pra você</p>
              </div>
              <div className="p-4 rounded-2xl bg-gray-50 border-2 border-gray-100">
                <Sparkles className="w-5 h-5 text-gray-500 mb-2" />
                <p className="font-bold text-sm text-gray-800">Primeira vez</p>
                <p className="text-xs text-gray-500 mt-0.5">Cadastro rápido em 1 minuto</p>
              </div>
            </div>
          </Section>
        )}

        {/* ── ETAPA 2: CADASTRO ── */}
        {step === 'register' && (
          <Section
            icon={<User className="w-6 h-6 text-blue-600" />}
            title="Seus dados"
            subtitle="Só precisamos disso para confirmar seu agendamento">
            <div className="space-y-4">
              <Field label="Nome completo *">
                <TInput placeholder="Como você se chama?" value={name}
                  onChange={e => setName(e.target.value)} autoFocus />
              </Field>
              <Field label="WhatsApp *" hint="Enviaremos a confirmação neste número">
                <TInput inputMode="tel" placeholder="(11) 99999-9999" value={phone}
                  onChange={e => setPhone(formatPhone(e.target.value))} />
              </Field>
              <Field label="E-mail (opcional)">
                <TInput type="email" placeholder="seu@email.com" value={email}
                  onChange={e => setEmail(e.target.value)} />
              </Field>
            </div>
          </Section>
        )}

        {/* ── ETAPA 3: VEÍCULO ── */}
        {step === 'vehicle' && (
          <Section
            icon={<Car className="w-6 h-6 text-blue-600" />}
            title="Qual veículo?"
            subtitle={savedVehicles.length ? 'Escolha um dos seus ou cadastre outro' : 'Conte um pouco sobre o carro'}>

            {savedVehicles.length > 0 && (
              <div className="space-y-2 mb-5">
                {savedVehicles.map(v => (
                  <button key={v.id} onClick={() => setVehicleId(v.id === vehicleId ? null : v.id)}
                    className={`w-full p-4 rounded-2xl border-2 text-left flex items-center gap-3 transition-all
                      ${vehicleId === v.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                    <Car className={`w-5 h-5 shrink-0 ${vehicleId === v.id ? 'text-blue-600' : 'text-gray-400'}`} />
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900">{v.brand} {v.model}</p>
                      <p className="text-sm text-gray-400">
                        {v.plate ?? 'sem placa'}{v.color ? ` · ${v.color}` : ''}
                      </p>
                    </div>
                    {vehicleId === v.id && <CheckCircle2 className="w-5 h-5 text-blue-600 ml-auto shrink-0" />}
                  </button>
                ))}
                <p className="text-center text-sm text-gray-400 pt-2">ou cadastre um novo abaixo</p>
              </div>
            )}

            <div className={`space-y-4 ${vehicleId ? 'opacity-40 pointer-events-none' : ''}`}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Marca *">
                  <TInput placeholder="Fiat" value={brand} onChange={e => setBrand(e.target.value)} />
                </Field>
                <Field label="Modelo">
                  <TInput placeholder="Argo" value={model} onChange={e => setModel(e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Placa">
                  <TInput placeholder="ABC1D23" value={plate} maxLength={8}
                    onChange={e => setPlate(e.target.value.toUpperCase())} />
                </Field>
                <Field label="Cor">
                  <TInput placeholder="Prata" value={color} onChange={e => setColor(e.target.value)} />
                </Field>
              </div>
            </div>
          </Section>
        )}

        {/* ── ETAPA 4: SERVIÇO OU ASSINATURA ── */}
        {step === 'offer' && (
          <Section
            icon={<Sparkles className="w-6 h-6 text-blue-600" />}
            title="O que você precisa?"
            subtitle="Escolha um serviço avulso ou assine um plano com desconto">

            {/* Alternador serviço / assinatura */}
            {plans.length > 0 && (
              <div className="flex gap-2 p-1.5 bg-gray-100 rounded-2xl mb-5">
                <button onClick={() => { setOfferKind('service'); setPlanId('') }}
                  className={`flex-1 h-12 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2
                    ${offerKind === 'service' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
                  <Sparkles className="w-4 h-4" />Serviço avulso
                </button>
                <button onClick={() => { setOfferKind('plan'); setServiceId('') }}
                  className={`flex-1 h-12 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2
                    ${offerKind === 'plan' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500'}`}>
                  <Repeat className="w-4 h-4" />Assinatura
                  <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">
                    economize
                  </span>
                </button>
              </div>
            )}

            {/* Lista de serviços */}
            {offerKind === 'service' && (
              services.length === 0
                ? <Empty text="Nenhum serviço disponível no momento." />
                : <div className="space-y-2.5">
                    {services.map(s => (
                      <button key={s.id} onClick={() => setServiceId(s.id === serviceId ? '' : s.id)}
                        className={`w-full p-4 rounded-2xl border-2 text-left transition-all
                          ${serviceId === s.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold text-gray-900">{s.name}</p>
                            {s.description && <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{s.description}</p>}
                            {s.duration_minutes && (
                              <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                                <Clock className="w-3 h-3" />{s.duration_minutes} min
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-black text-blue-600 text-lg">{money(s.price)}</p>
                            {serviceId === s.id && <CheckCircle2 className="w-5 h-5 text-blue-600 ml-auto mt-1" />}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
            )}

            {/* Lista de assinaturas */}
            {offerKind === 'plan' && (
              plans.length === 0
                ? <Empty text="Esta estética ainda não oferece assinaturas." />
                : <div className="space-y-2.5">
                    {plans.map(p => {
                      const included = services.filter(s => p.services?.includes(s.id))
                      return (
                        <button key={p.id} onClick={() => setPlanId(p.id === planId ? '' : p.id)}
                          className={`w-full p-4 rounded-2xl border-2 text-left transition-all
                            ${planId === p.id ? 'border-purple-500 bg-purple-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Repeat className="w-4 h-4 text-purple-600 shrink-0" />
                                <p className="font-bold text-gray-900">{p.name}</p>
                              </div>
                              {p.description && <p className="text-sm text-gray-500 mt-1">{p.description}</p>}
                              {p.sessions && (
                                <p className="text-xs text-purple-700 font-semibold mt-1.5 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {p.sessions} {p.sessions === 1 ? 'sessão' : 'sessões'} incluídas
                                </p>
                              )}
                              {included.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {included.map(s => (
                                    <span key={s.id} className="text-[11px] bg-white text-purple-700 px-2 py-0.5 rounded-full border border-purple-200 flex items-center gap-1">
                                      <Tag className="w-2.5 h-2.5" />{s.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-black text-purple-600 text-lg">{money(p.price)}</p>
                              <p className="text-[11px] text-gray-400">{INTERVAL_LABEL[p.interval]}</p>
                              {planId === p.id && <CheckCircle2 className="w-5 h-5 text-purple-600 ml-auto mt-1" />}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
            )}
          </Section>
        )}

        {/* ── ETAPA 5: DATA E HORA ── */}
        {step === 'datetime' && (
          <Section
            icon={<CalendarIcon className="w-6 h-6 text-blue-600" />}
            title="Quando fica melhor?"
            subtitle="Escolha o dia e o horário disponível">
            <Field label="Data">
              <TInput type="date" value={date} min={new Date().toISOString().slice(0, 10)}
                onChange={e => { setDate(e.target.value); setTime('') }} />
            </Field>

            {date && (
              <div className="mt-5">
                <label className="block text-sm font-semibold text-gray-700 mb-2.5">Horário</label>
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {generateSlots().map(slot => {
                    const busy = busySlots.includes(slot)
                    return (
                      <button key={slot} disabled={busy} onClick={() => setTime(slot)}
                        className={`h-14 rounded-xl font-bold text-sm border-2 transition-all
                          ${busy ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed line-through'
                            : time === slot ? 'border-blue-500 bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300'}`}>
                        {slot}
                      </button>
                    )
                  })}
                </div>
                {busySlots.length > 0 && (
                  <p className="text-xs text-gray-400 mt-3">Horários riscados já estão reservados.</p>
                )}
              </div>
            )}
          </Section>
        )}

        {/* ── ETAPA 6: PAGAMENTO ── */}
        {step === 'payment' && (
          <Section
            icon={<CreditCard className="w-6 h-6 text-blue-600" />}
            title="Como prefere pagar?"
            subtitle="Você pode adiantar agora ou pagar no atendimento">

            {/* Resumo */}
            <div className="p-5 bg-gray-50 rounded-2xl space-y-2.5 mb-5">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Resumo</p>
              <Row label="Cliente" value={name} />
              <Row label={offerKind === 'plan' ? 'Assinatura' : 'Serviço'} value={offerName ?? '—'} />
              <Row label="Veículo" value={
                vehicleId
                  ? (() => { const v = savedVehicles.find(x => x.id === vehicleId); return `${v?.brand} ${v?.model}` })()
                  : `${brand} ${model}`.trim()
              } />
              <Row label="Data" value={`${date.split('-').reverse().join('/')} às ${time}`} />
              <div className="pt-2.5 border-t border-gray-200 flex justify-between items-center">
                <span className="font-bold text-gray-700">Total</span>
                <span className="font-black text-xl text-blue-600">
                  {money(totalPrice)}
                  {offerKind === 'plan' && (
                    <span className="text-xs font-normal text-gray-400 ml-1">
                      {INTERVAL_LABEL[selectedPlan?.interval ?? 'single']}
                    </span>
                  )}
                </span>
              </div>
            </div>

            {/* Opções */}
            <div className="space-y-3">
              <button onClick={() => setPayWhen('now')}
                className={`w-full p-4 rounded-2xl border-2 text-left flex items-center gap-4 transition-all
                  ${payWhen === 'now' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0
                  ${payWhen === 'now' ? 'bg-blue-600' : 'bg-gray-100'}`}>
                  <CreditCard className={`w-5 h-5 ${payWhen === 'now' ? 'text-white' : 'text-gray-500'}`} />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-gray-900">Pagar agora</p>
                  <p className="text-sm text-gray-500">Cartão ou Pix — garanta seu horário</p>
                </div>
                {payWhen === 'now' && <CheckCircle2 className="w-5 h-5 text-blue-600 ml-auto shrink-0" />}
              </button>

              <button onClick={() => setPayWhen('local')}
                className={`w-full p-4 rounded-2xl border-2 text-left flex items-center gap-4 transition-all
                  ${payWhen === 'local' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0
                  ${payWhen === 'local' ? 'bg-blue-600' : 'bg-gray-100'}`}>
                  <Store className={`w-5 h-5 ${payWhen === 'local' ? 'text-white' : 'text-gray-500'}`} />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-gray-900">Pagar no local</p>
                  <p className="text-sm text-gray-500">No dia do atendimento</p>
                </div>
                {payWhen === 'local' && <CheckCircle2 className="w-5 h-5 text-blue-600 ml-auto shrink-0" />}
              </button>
            </div>
          </Section>
        )}
      </main>

      {/* ── Barra de ações fixa ── */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 p-4 shadow-[0_-4px_20px_rgba(0,0,0,0.04)]">
        <div className="max-w-2xl mx-auto flex gap-3">
          {step !== 'identify' && (
            <GhostBtn onClick={goBack} disabled={saving}>
              <ArrowLeft className="w-5 h-5" />
              <span className="hidden sm:inline">Voltar</span>
            </GhostBtn>
          )}
          {step === 'payment' ? (
            <PrimaryBtn onClick={handleConfirm} disabled={saving} className="flex-1">
              {saving
                ? <><Loader2 className="w-5 h-5 animate-spin" />Confirmando…</>
                : <><CheckCircle2 className="w-5 h-5" />Confirmar agendamento</>}
            </PrimaryBtn>
          ) : (
            <PrimaryBtn onClick={goNext} disabled={!canAdvance || checking} className="flex-1">
              {checking
                ? <><Loader2 className="w-5 h-5 animate-spin" />Verificando…</>
                : <>Continuar <ArrowRight className="w-5 h-5" /></>}
            </PrimaryBtn>
          )}
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ══════════════════════════════════════════════════════════════ */

function Section({ icon, title, subtitle, children }: {
  icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
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

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-center gap-4 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className={`text-right truncate ${bold ? 'font-black text-gray-900' : 'font-semibold text-gray-800'}`}>
        {value}
      </span>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="text-center py-10">
      <Sparkles className="w-10 h-10 text-gray-200 mx-auto mb-3" />
      <p className="text-gray-400">{text}</p>
    </div>
  )
}
