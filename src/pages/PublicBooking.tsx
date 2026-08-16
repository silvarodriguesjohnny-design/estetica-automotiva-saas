import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import {
  Car, CheckCircle, ChevronRight, ChevronLeft, Clock, Calendar,
  User, Phone, CreditCard, Search, Loader2, MapPin, Star,
  Package, Repeat, DollarSign, QrCode, Smartphone,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Tenant, Service } from '@/types'

// ── PWA: injeta manifest dinâmico e registra SW ──────────────────────
function usePWA(tenant: Tenant | null) {
  useEffect(() => {
    if (!tenant) return

    // Registra service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw-booking.js').catch(() => {})
    }

    // Injeta manifest dinâmico com nome da estética
    const manifest = {
      name: tenant.name,
      short_name: tenant.name.split(' ')[0],
      description: `Agende seu serviço na ${tenant.name}`,
      start_url: window.location.href,
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#ffffff',
      theme_color: '#1B4FD8',
      icons: [
        { src: '/pwa-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/pwa-icon-192.png', sizes: '512x512', type: 'image/png' },
      ],
    }

    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    // Remove manifest anterior se existir
    document.querySelectorAll('link[rel="manifest"]').forEach(el => el.remove())

    const link = document.createElement('link')
    link.rel = 'manifest'
    link.href = url
    document.head.appendChild(link)

    // Apple meta tags dinâmicas
    const setMeta = (name: string, content: string) => {
      let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement
      if (!el) { el = document.createElement('meta'); el.name = name; document.head.appendChild(el) }
      el.content = content
    }
    setMeta('apple-mobile-web-app-title', tenant.name)
    setMeta('apple-mobile-web-app-capable', 'yes')
    setMeta('apple-mobile-web-app-status-bar-style', 'default')

    return () => URL.revokeObjectURL(url)
  }, [tenant])
}


/* ── Types ── */

interface SubscriptionPlan {
  id: string
  name: string
  description?: string
  price: number
  interval: string
  is_active: boolean
}

interface Customer {
  id: string
  name: string
  phone: string
  cpf_cnpj?: string
  email?: string
}

interface Vehicle {
  id: string
  brand: string
  model: string
  plate?: string
  color?: string
}

type Step = 'identify' | 'register' | 'vehicle' | 'service' | 'datetime' | 'payment' | 'confirm'

const STEP_LABELS: Record<Step, string> = {
  identify: 'Identificação',
  register:  'Cadastro',
  vehicle:   'Veículo',
  service:   'Serviço',
  datetime:  'Data e Hora',
  payment:   'Pagamento',
  confirm:   'Confirmação',
}

const STEP_ORDER: Step[] = ['identify', 'register', 'vehicle', 'service', 'datetime', 'payment', 'confirm']

/* ── CPF/CNPJ formatter ── */

function formatDoc(v: string) {
  const d = v.replace(/\D/g, '')
  if (d.length <= 11) {
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
      .replace(/(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3')
      .replace(/(\d{3})(\d{0,3})/, '$1.$2')
  }
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
    .replace(/(\d{2})(\d{3})(\d{3})(\d{0,4})/, '$1.$2.$3/$4')
    .replace(/(\d{2})(\d{3})(\d{0,3})/, '$1.$2.$3')
    .replace(/(\d{2})(\d{0,3})/, '$1.$2')
}

function formatPhone(v: string) {
  const d = v.replace(/\D/g, '')
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').replace(/(\d{2})(\d{0,4})/, '($1) $2')
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3').replace(/(\d{2})(\d{0,5})/, '($1) $2')
}

/* ── Hour slots ── */

function generateSlots(start = 8, end = 18) {
  const slots: string[] = []
  for (let h = start; h < end; h++) {
    slots.push(`${String(h).padStart(2,'0')}:00`)
    slots.push(`${String(h).padStart(2,'0')}:30`)
  }
  return slots
}

/* ── Progress bar ── */

function StepProgress({ current, steps }: { current: Step; steps: Step[] }) {
  const idx = steps.indexOf(current)
  return (
    <div className="flex items-center gap-1 mb-6">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center flex-1">
          <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-all
            ${i < idx ? 'bg-green-500 text-white' : i === idx ? 'bg-primary text-white scale-110 shadow-md' : 'bg-gray-200 text-gray-400'}`}>
            {i < idx ? <CheckCircle className="w-4 h-4" /> : i + 1}
          </div>
          {i < steps.length - 1 && (
            <div className={`h-1 flex-1 mx-1 rounded-full transition-all ${i < idx ? 'bg-green-400' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

/* ── Main ── */

export default function PublicBooking() {
  const { tenantId } = useParams()
  const [searchParams] = useSearchParams()

  const [tenant, setTenant] = useState<Tenant | null>(null)
  usePWA(tenant)
  const [services, setServices] = useState<Service[]>([])
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searching, setSearching] = useState(false)

  // Step control
  const [step, setStep] = useState<Step>('identify')
  const [visibleSteps, setVisibleSteps] = useState<Step[]>(['identify', 'vehicle', 'service', 'datetime', 'payment', 'confirm'])

  // Form state
  const [doc, setDoc] = useState('')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [regName, setRegName] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regEmail, setRegEmail] = useState('')

  // Vehicle
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [vehicleId, setVehicleId] = useState('')
  const [vBrand, setVBrand] = useState('')
  const [vModel, setVModel] = useState('')
  const [vPlate, setVPlate] = useState('')
  const [vColor, setVColor] = useState('')

  // Service / combo
  const [bookingType, setBookingType] = useState<'service' | 'plan'>('service')
  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [selectedPlanId, setSelectedPlanId] = useState('')

  // DateTime
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')

  // Payment
  const [payOption, setPayOption] = useState<'now' | 'local'>('local')

  // Booking result
  const [done, setDone] = useState(false)
  const [bookingRef, setBookingRef] = useState('')

  /* ── Load ── */

  useEffect(() => {
    if (!tenantId) return
    const load = async () => {
      const [tRes, sRes, pRes] = await Promise.all([
        supabase.from('tenants').select('id, name, logo_url, cidade, phone').eq('id', tenantId).single(),
        supabase.from('services').select('*').eq('tenant_id', tenantId).eq('is_active', true).order('name'),
        supabase.from('subscription_plans').select('*').eq('tenant_id', tenantId).eq('is_active', true).order('price'),
      ])
      setTenant(tRes.data as Tenant)
      setServices((sRes.data as Service[]) ?? [])
      setPlans((pRes.data as SubscriptionPlan[]) ?? [])
      setLoading(false)
    }
    load()
  }, [tenantId])

  /* ── CPF/CNPJ lookup ── */

  const handleLookup = async () => {
    const raw = doc.replace(/\D/g, '')
    if (raw.length < 11) { toast.error('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido'); return }
    setSearching(true)
    try {
      const { data } = await supabase
        .from('customers')
        .select('id, name, phone, cpf_cnpj, email')
        .eq('tenant_id', tenantId!)
        .eq('cpf_cnpj', raw)
        .single()

      if (data) {
        setCustomer(data as Customer)
        setIsNew(false)
        // Load vehicles
        const { data: vs } = await supabase.from('vehicles').select('*').eq('customer_id', data.id)
        setVehicles((vs as Vehicle[]) ?? [])
        toast.success(`Bem-vindo de volta, ${data.name.split(' ')[0]}! 👋`)
        goNext('identify')
      } else {
        setIsNew(true)
        setVisibleSteps(['identify', 'register', 'vehicle', 'service', 'datetime', 'payment', 'confirm'])
        setStep('register')
      }
    } catch {
      setIsNew(true)
      setVisibleSteps(['identify', 'register', 'vehicle', 'service', 'datetime', 'payment', 'confirm'])
      setStep('register')
    }
    setSearching(false)
  }

  const goNext = useCallback((current: Step) => {
    const idx = STEP_ORDER.indexOf(current)
    // Skip register if existing customer
    let next = STEP_ORDER[idx + 1]
    if (next === 'register' && !isNew) next = STEP_ORDER[idx + 2]
    if (next) setStep(next)
  }, [isNew])

  const goBack = useCallback((current: Step) => {
    const idx = STEP_ORDER.indexOf(current)
    let prev = STEP_ORDER[idx - 1]
    if (prev === 'register' && !isNew) prev = STEP_ORDER[idx - 2]
    if (prev) setStep(prev)
  }, [isNew])

  /* ── Submit registration ── */

  const handleRegister = async () => {
    if (!regName || !regPhone) { toast.error('Nome e telefone são obrigatórios'); return }
    setSaving(true)
    try {
      const raw = doc.replace(/\D/g, '')
      const { data } = await supabase.from('customers').insert({
        tenant_id: tenantId!, name: regName, phone: regPhone.replace(/\D/g,''),
        email: regEmail || null, cpf_cnpj: raw || null,
      }).select().single()
      setCustomer(data as Customer)
      setVehicles([])
      goNext('register')
    } catch (e: any) { toast.error('Erro ao cadastrar. Tente novamente.') }
    setSaving(false)
  }

  /* ── Submit vehicle ── */

  const handleVehicle = async () => {
    if (vehicleId) { goNext('vehicle'); return }
    if (!vBrand) { toast.error('Informe a marca do veículo'); return }
    setSaving(true)
    try {
      const { data } = await supabase.from('vehicles').insert({
        tenant_id: tenantId!, customer_id: customer!.id,
        brand: vBrand, model: vModel || '', plate: vPlate || null, color: vColor || null,
      }).select().single()
      setVehicleId(data.id)
      setVehicles(v => [...v, data as Vehicle])
      goNext('vehicle')
    } catch { toast.error('Erro ao salvar veículo') }
    setSaving(false)
  }

  /* ── Submit booking ── */

  const handleBook = async () => {
    if (!date || !time) { toast.error('Selecione data e horário'); return }
    const selectedService = services.find(s => s.id === selectedServiceId)
    const selectedPlan = plans.find(p => p.id === selectedPlanId)
    setSaving(true)
    try {
      const startTime = `${date}T${time}:00`
      const { data: order } = await supabase.from('service_orders').insert({
        tenant_id: tenantId!,
        customer_id: customer!.id,
        vehicle_id: vehicleId || null,
        status: 'pending',
        start_time: startTime,
        total_amount: selectedService?.price ?? selectedPlan?.price ?? 0,
        notes: selectedPlan ? `Plano: ${selectedPlan.name}` : undefined,
      }).select().single()
      setBookingRef(order.id.slice(0, 8).toUpperCase())

      // If pay now → redirect to Stripe (scaffold)
      if (payOption === 'now' && selectedService) {
        toast.info('Redirecionando para pagamento…')
        // TODO: await stripeCheckout(order.id)
      }

      setDone(true)
      setStep('confirm')
    } catch { toast.error('Erro ao realizar agendamento. Tente novamente.') }
    setSaving(false)
  }

  /* ── Loading ── */

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
      <div className="text-center">
        <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4 animate-pulse">
          <Car className="w-8 h-8 text-white" />
        </div>
        <p className="text-gray-400 text-lg">Carregando…</p>
      </div>
    </div>
  )

  if (!tenant) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-gray-400 text-xl">Estética não encontrada.</p>
    </div>
  )

  const selectedService = services.find(s => s.id === selectedServiceId)
  const selectedPlan = plans.find(p => p.id === selectedPlanId)
  const totalAmount = selectedService?.price ?? selectedPlan?.price ?? 0

  const activeSteps = isNew
    ? ['identify', 'register', 'vehicle', 'service', 'datetime', 'payment', 'confirm'] as Step[]
    : ['identify', 'vehicle', 'service', 'datetime', 'payment', 'confirm'] as Step[]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-5 py-4 flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-primary to-purple-600 rounded-2xl flex items-center justify-center shadow-md shrink-0">
            <Car className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-black text-gray-900 text-lg leading-tight truncate">{tenant.name}</h1>
            {tenant.cidade && <p className="text-sm text-gray-400 flex items-center gap-1"><MapPin className="w-3 h-3" />{tenant.cidade}</p>}
          </div>
          {tenant.phone && (
            <a href={`tel:${tenant.phone}`} className="flex items-center gap-2 text-primary font-semibold text-sm bg-blue-50 px-3 py-2 rounded-xl hover:bg-blue-100 transition-colors shrink-0">
              <Phone className="w-4 h-4" />
              <span className="hidden sm:block">Ligar</span>
            </a>
          )}
        </div>
      </header>

      {/* ── Content ── */}
      <div className="max-w-2xl mx-auto px-4 py-6 pb-16">

        {/* Confirmed screen */}
        {done && step === 'confirm' && (
          <div className="text-center py-12 animate-fade-in">
            <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-14 h-14 text-green-500" />
            </div>
            <h2 className="text-3xl font-black text-gray-900 mb-3">Agendado! 🎉</h2>
            <p className="text-gray-500 text-lg mb-6">Seu agendamento foi confirmado com sucesso.</p>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-left max-w-sm mx-auto mb-8">
              <div className="space-y-3">
                <div className="flex justify-between"><span className="text-gray-500 text-sm">Código</span><span className="font-bold text-gray-900 font-mono">#{bookingRef}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 text-sm">Cliente</span><span className="font-semibold text-gray-900">{customer?.name}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 text-sm">Serviço</span><span className="font-semibold text-gray-900">{selectedService?.name ?? selectedPlan?.name}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 text-sm">Data</span><span className="font-semibold text-gray-900">{date ? new Date(date+'T12:00').toLocaleDateString('pt-BR') : ''} às {time}</span></div>
                <div className="flex justify-between border-t border-gray-100 pt-3"><span className="text-gray-500 text-sm">Total</span><span className="font-black text-primary text-lg">R$ {totalAmount.toFixed(2)}</span></div>
              </div>
            </div>
            {tenant.phone && (
              <a href={`https://wa.me/55${tenant.phone.replace(/\D/g,'')}?text=Olá! Agendei um serviço pelo link. Código: #${bookingRef}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white font-bold px-8 py-4 rounded-2xl transition-colors text-lg">
                <Smartphone className="w-5 h-5" /> Confirmar via WhatsApp
              </a>
            )}
          </div>
        )}

        {!done && (
          <>
            {/* Progress */}
            <div className="mb-6">
              <StepProgress current={step} steps={activeSteps} />
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-black text-gray-900">{STEP_LABELS[step]}</h2>
                <span className="text-sm text-gray-400">{activeSteps.indexOf(step) + 1}/{activeSteps.length}</span>
              </div>
            </div>

            {/* ── Step: Identify ── */}
            {step === 'identify' && (
              <div className="space-y-5 animate-fade-in">
                <div className="bg-primary/5 border border-primary/10 rounded-2xl p-5 text-center">
                  <Search className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="text-gray-700 font-semibold">Informe seu CPF ou CNPJ</p>
                  <p className="text-gray-500 text-sm mt-1">Reconhecemos clientes cadastrados automaticamente</p>
                </div>
                <div>
                  <label className="block text-base font-semibold text-gray-800 mb-2">CPF ou CNPJ</label>
                  <input
                    className="booking-input"
                    inputMode="numeric"
                    placeholder="000.000.000-00"
                    value={formatDoc(doc)}
                    onChange={e => setDoc(e.target.value.replace(/\D/g,''))}
                    onKeyDown={e => e.key === 'Enter' && handleLookup()}
                  />
                </div>
                <button onClick={handleLookup} disabled={searching || doc.replace(/\D/g,'').length < 11}
                  className="booking-btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                  {searching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                  {searching ? 'Buscando…' : 'Continuar'}
                </button>
                <p className="text-center text-sm text-gray-400">Não tem cadastro? Será criado automaticamente.</p>
              </div>
            )}

            {/* ── Step: Register ── */}
            {step === 'register' && (
              <div className="space-y-4 animate-fade-in">
                <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-sm text-blue-700">
                  Bem-vindo! Preencha seus dados para continuar.
                </div>
                <div>
                  <label className="block text-base font-semibold text-gray-800 mb-2">Nome completo *</label>
                  <input className="booking-input" placeholder="João da Silva" value={regName} onChange={e => setRegName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-base font-semibold text-gray-800 mb-2">Telefone / WhatsApp *</label>
                  <input className="booking-input" inputMode="tel" placeholder="(11) 99999-9999" value={formatPhone(regPhone)} onChange={e => setRegPhone(e.target.value.replace(/\D/g,''))} />
                </div>
                <div>
                  <label className="block text-base font-semibold text-gray-800 mb-2">E-mail (opcional)</label>
                  <input className="booking-input" type="email" inputMode="email" placeholder="joao@email.com" value={regEmail} onChange={e => setRegEmail(e.target.value)} />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => goBack('register')} className="booking-btn-outline">
                    <ChevronLeft className="w-5 h-5" /> Voltar
                  </button>
                  <button onClick={handleRegister} disabled={saving} className="booking-btn-primary flex-1">
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                    Continuar <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {/* ── Step: Vehicle ── */}
            {step === 'vehicle' && (
              <div className="space-y-4 animate-fade-in">
                {vehicles.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-base font-semibold text-gray-800 mb-3">Seus veículos cadastrados:</p>
                    {vehicles.map(v => (
                      <button key={v.id} onClick={() => setVehicleId(v.id)}
                        className={`w-full text-left p-5 rounded-2xl border-2 transition-all ${vehicleId === v.id ? 'border-primary bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                        <div className="flex items-center gap-3">
                          <Car className={`w-6 h-6 ${vehicleId === v.id ? 'text-primary' : 'text-gray-400'}`} />
                          <div>
                            <p className="font-bold text-gray-900">{v.brand} {v.model}</p>
                            <p className="text-sm text-gray-400">{v.plate && `Placa ${v.plate}`} {v.color && `· ${v.color}`}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                    <div className="text-center py-2">
                      <button onClick={() => setVehicleId('')} className="text-sm text-primary font-medium">
                        + Adicionar outro veículo
                      </button>
                    </div>
                  </div>
                )}

                {(!vehicleId || vehicles.length === 0) && (
                  <div className="space-y-3">
                    <p className="text-base font-semibold text-gray-800">Dados do veículo:</p>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Marca *</label>
                      <input className="booking-input" placeholder="Ex: Toyota, Honda, Volkswagen" value={vBrand} onChange={e => setVBrand(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Modelo</label>
                      <input className="booking-input" placeholder="Ex: Corolla, Civic, Golf" value={vModel} onChange={e => setVModel(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Placa</label>
                        <input className="booking-input text-center uppercase" placeholder="ABC-1234" value={vPlate} onChange={e => setVPlate(e.target.value.toUpperCase())} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Cor</label>
                        <input className="booking-input" placeholder="Branco, Prata…" value={vColor} onChange={e => setVColor(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={() => goBack('vehicle')} className="booking-btn-outline">
                    <ChevronLeft className="w-5 h-5" /> Voltar
                  </button>
                  <button onClick={handleVehicle} disabled={saving || (!vehicleId && !vBrand)} className="booking-btn-primary flex-1 disabled:opacity-50">
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                    Continuar <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {/* ── Step: Service ── */}
            {step === 'service' && (
              <div className="space-y-4 animate-fade-in">
                {/* Type selector */}
                {plans.length > 0 && (
                  <div className="flex gap-2 mb-4">
                    <button onClick={() => setBookingType('service')}
                      className={`flex-1 py-3 rounded-xl font-semibold text-sm border-2 transition-all ${bookingType === 'service' ? 'border-primary bg-primary text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                      <Package className="w-4 h-4 inline mr-1.5" />Serviço avulso
                    </button>
                    <button onClick={() => setBookingType('plan')}
                      className={`flex-1 py-3 rounded-xl font-semibold text-sm border-2 transition-all ${bookingType === 'plan' ? 'border-primary bg-primary text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                      <Repeat className="w-4 h-4 inline mr-1.5" />Combo / Assinatura
                    </button>
                  </div>
                )}

                {/* Services */}
                {bookingType === 'service' && (
                  <div className="space-y-3">
                    {services.length === 0 && <p className="text-center text-gray-400 py-8">Nenhum serviço disponível.</p>}
                    {services.map(s => (
                      <button key={s.id} onClick={() => setSelectedServiceId(s.id)}
                        className={`w-full text-left rounded-2xl border-2 p-5 transition-all ${selectedServiceId === s.id ? 'border-primary bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${selectedServiceId === s.id ? 'bg-primary' : 'bg-gray-100'}`}>
                              <Car className={`w-5 h-5 ${selectedServiceId === s.id ? 'text-white' : 'text-gray-500'}`} />
                            </div>
                            <div>
                              <p className="font-bold text-gray-900 text-base">{s.name}</p>
                              {s.duration_min && <p className="text-sm text-gray-400"><Clock className="w-3 h-3 inline mr-1" />{s.duration_min} min</p>}
                            </div>
                          </div>
                          <span className="font-black text-primary text-lg">R$ {s.price?.toFixed(2) ?? '—'}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Plans */}
                {bookingType === 'plan' && (
                  <div className="space-y-3">
                    {plans.length === 0 && <p className="text-center text-gray-400 py-8">Nenhum combo disponível no momento.</p>}
                    {plans.map(p => (
                      <button key={p.id} onClick={() => setSelectedPlanId(p.id)}
                        className={`w-full text-left rounded-2xl border-2 p-5 transition-all ${selectedPlanId === p.id ? 'border-primary bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${selectedPlanId === p.id ? 'bg-primary' : 'bg-gray-100'}`}>
                              <Repeat className={`w-5 h-5 ${selectedPlanId === p.id ? 'text-white' : 'text-gray-500'}`} />
                            </div>
                            <div>
                              <p className="font-bold text-gray-900 text-base">{p.name}</p>
                              {p.description && <p className="text-sm text-gray-500 mt-0.5">{p.description}</p>}
                              <span className="text-xs font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full mt-1 inline-block">
                                {p.interval === 'monthly' ? 'Mensal' : p.interval === 'quarterly' ? 'Trimestral' : 'Anual'}
                              </span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-black text-primary text-lg">R$ {p.price.toFixed(2)}</p>
                            <p className="text-xs text-gray-400">/{p.interval === 'monthly' ? 'mês' : 'período'}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={() => goBack('service')} className="booking-btn-outline">
                    <ChevronLeft className="w-5 h-5" /> Voltar
                  </button>
                  <button onClick={() => goNext('service')} disabled={!selectedServiceId && !selectedPlanId}
                    className="booking-btn-primary flex-1 disabled:opacity-50">
                    Continuar <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {/* ── Step: Datetime ── */}
            {step === 'datetime' && (
              <div className="space-y-5 animate-fade-in">
                <div>
                  <label className="block text-base font-semibold text-gray-800 mb-2">
                    <Calendar className="w-5 h-5 inline mr-2 text-primary" />Data do agendamento
                  </label>
                  <input type="date" className="booking-input"
                    min={new Date().toISOString().split('T')[0]}
                    value={date} onChange={e => setDate(e.target.value)} />
                </div>
                {date && (
                  <div>
                    <label className="block text-base font-semibold text-gray-800 mb-3">
                      <Clock className="w-5 h-5 inline mr-2 text-primary" />Horário
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {generateSlots().map(slot => (
                        <button key={slot} onClick={() => setTime(slot)}
                          className={`h-12 rounded-xl border-2 font-semibold text-base transition-all ${time === slot ? 'border-primary bg-primary text-white shadow-md' : 'border-gray-200 bg-white text-gray-700 hover:border-primary/40'}`}>
                          {slot}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => goBack('datetime')} className="booking-btn-outline">
                    <ChevronLeft className="w-5 h-5" /> Voltar
                  </button>
                  <button onClick={() => goNext('datetime')} disabled={!date || !time}
                    className="booking-btn-primary flex-1 disabled:opacity-50">
                    Continuar <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {/* ── Step: Payment ── */}
            {step === 'payment' && (
              <div className="space-y-4 animate-fade-in">
                {/* Summary */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Resumo</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-gray-600">Serviço</span><span className="font-semibold">{selectedService?.name ?? selectedPlan?.name}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Data</span><span className="font-semibold">{date ? new Date(date+'T12:00').toLocaleDateString('pt-BR') : ''} às {time}</span></div>
                    <div className="flex justify-between border-t border-gray-100 pt-2 mt-2">
                      <span className="font-bold text-gray-900">Total</span>
                      <span className="font-black text-primary text-xl">R$ {totalAmount.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <p className="text-base font-semibold text-gray-800">Como deseja pagar?</p>
                <button onClick={() => setPayOption('local')}
                  className={`w-full text-left rounded-2xl border-2 p-5 transition-all ${payOption === 'local' ? 'border-primary bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${payOption === 'local' ? 'bg-primary' : 'bg-gray-100'}`}>
                      <DollarSign className={`w-6 h-6 ${payOption === 'local' ? 'text-white' : 'text-gray-500'}`} />
                    </div>
                    <div>
                      <p className="font-bold text-gray-900 text-base">Pagar na hora</p>
                      <p className="text-sm text-gray-500">Dinheiro, cartão ou Pix no local</p>
                    </div>
                  </div>
                </button>
                <button onClick={() => setPayOption('now')}
                  className={`w-full text-left rounded-2xl border-2 p-5 transition-all ${payOption === 'now' ? 'border-primary bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${payOption === 'now' ? 'bg-primary' : 'bg-gray-100'}`}>
                      <CreditCard className={`w-6 h-6 ${payOption === 'now' ? 'text-white' : 'text-gray-500'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-gray-900 text-base">Pagar agora online</p>
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">Seguro</span>
                      </div>
                      <p className="text-sm text-gray-500">Cartão de crédito ou Pix via Stripe</p>
                    </div>
                  </div>
                </button>

                <div className="flex gap-3">
                  <button onClick={() => goBack('payment')} className="booking-btn-outline">
                    <ChevronLeft className="w-5 h-5" /> Voltar
                  </button>
                  <button onClick={handleBook} disabled={saving}
                    className="booking-btn-primary flex-1 disabled:opacity-50">
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                    {saving ? 'Agendando…' : 'Confirmar agendamento'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
