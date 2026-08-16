import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  CheckCircle2, X, ArrowRight, Star, Zap, Shield, BarChart3,
  MessageSquare, Users, ClipboardList, Package, Wrench,
  TrendingUp, Clock, ChevronDown, ChevronUp, Car, Smartphone,
  TrendingDown, AlertTriangle, DollarSign, Flame, Calendar
} from 'lucide-react'

/* ── Data ──────────────────────────────────────────────────────────── */

const PLANS = [
  {
    id: 'starter', name: 'Padrão', subtitle: 'Para quem está começando',
    price: 97.33, priceInt: '97', priceDec: '33',
    color: 'from-blue-500 to-blue-700', badge: null, maxServices: 2,
    services: ['Lavagem Automotiva Completa', 'Ducha'],
    features: ['Até 2 serviços cadastrados', 'Clientes ilimitados', 'Ordens de serviço', 'Financeiro básico', 'WhatsApp integrado', 'Relatórios essenciais'],
    missing: ['Serviços extras', 'Campanhas em massa', 'Múltiplos técnicos'],
  },
  {
    id: 'pro', name: 'Especialista', subtitle: 'Para quem já é referência',
    price: 159.90, priceInt: '159', priceDec: '90',
    color: 'from-violet-500 to-purple-700', badge: '⭐ Mais popular', maxServices: 4,
    services: ['Lavagem Automotiva Completa', 'Ducha', 'Higienização Interna', 'Polimento'],
    features: ['Até 4 serviços cadastrados', 'Clientes ilimitados', 'OS completas', 'Financeiro avançado', 'WhatsApp + campanhas', 'Múltiplos técnicos', 'Estoque de produtos', 'Templates de mensagens'],
    missing: ['Serviços ilimitados'],
  },
  {
    id: 'enterprise', name: 'Multi Serviços', subtitle: 'Para estruturas completas',
    price: 297.90, priceInt: '297', priceDec: '90',
    color: 'from-orange-500 to-red-600', badge: '🔥 Completo', maxServices: null,
    services: ['Todos os serviços — sem limite'],
    features: ['Serviços ilimitados', 'Clientes ilimitados', 'OS + agendamento online', 'Financeiro + DRE', 'WhatsApp + campanhas segmentadas', 'Múltiplos técnicos e unidades', 'Estoque completo', 'Automações avançadas', 'Suporte prioritário'],
    missing: [],
  },
]

const FEATURES = [
  { icon: ClipboardList, title: 'Ordens de Serviço', desc: 'Crie, acompanhe e finalize OS com um clique. Histórico completo de cada veículo.' },
  { icon: Users, title: 'Gestão de Clientes', desc: 'Ficha completa de cada cliente. Saiba quem não voltou há 45 dias e aja antes de perder.' },
  { icon: MessageSquare, title: 'WhatsApp Automático', desc: 'Confirmações, lembretes e reativação de inativos — tudo automático pelo WhatsApp.' },
  { icon: BarChart3, title: 'Financeiro em Tempo Real', desc: 'Receitas, despesas e receita em risco. Saiba exatamente quanto está deixando na mesa.' },
  { icon: Package, title: 'Controle de Estoque', desc: 'Alertas de estoque mínimo. Nunca fique sem produto na hora do serviço.' },
  { icon: Calendar, title: 'Agenda Online Pública', desc: 'Link para o cliente agendar pelo celular ou tablet. Combos e assinaturas incluídos.' },
  { icon: TrendingUp, title: 'Campanhas Segmentadas', desc: 'Envie promoções para clientes inativos, aniversariantes ou por volume de serviços.' },
  { icon: Shield, title: 'Segurança Total', desc: 'Dados isolados com criptografia, backups automáticos e conformidade com LGPD.' },
]

const TESTIMONIALS = [
  { name: 'Rodrigo M.', role: 'Estética em SP', text: 'Antes controlava tudo no papel. Agora tenho OS organizadas, WhatsApp automático e financeiro fechando certinho. Economizo 4 horas por semana.', stars: 5 },
  { name: 'Ana P.', role: 'Estética em BH', text: 'O módulo de clientes inativos me salvou. Recuperei R$3.400 em um mês só mandando mensagem para quem sumiu. Simples e direto.', stars: 5 },
  { name: 'Carlos T.', role: 'Multi-unidades no RJ', text: 'Uso o plano Multi Serviços com 3 unidades. Vejo tudo centralizado: técnicos, OS e financeiro de cada unidade separado.', stars: 5 },
]

const FAQS = [
  { q: 'Preciso instalar alguma coisa?', a: 'Não. O Auto Estética Flow roda 100% no navegador — celular, tablet ou computador. Sem instalação.' },
  { q: 'Posso mudar de plano depois?', a: 'Sim, a qualquer momento. Upgrade ou downgrade pelo painel de configurações.' },
  { q: 'E o WhatsApp, como funciona?', a: 'Você conecta o número da sua estética via QR code. O sistema envia mensagens pelo seu próprio número.' },
  { q: 'Meus dados ficam seguros?', a: 'Sim. Cada empresa tem dados totalmente isolados, com criptografia e backups automáticos.' },
  { q: 'Tem fidelidade?', a: 'Não. Você paga mês a mês e cancela quando quiser, sem multa.' },
  { q: 'Como funciona o agendamento online?', a: 'Você recebe um link único da sua estética. O cliente acessa, informa o CPF/CNPJ, escolhe serviço e horário. Pode até pagar antecipado.' },
]

/* ── Revenue Loss Calculator ────────────────────────────────────────── */

function RevenueLossCalculator() {
  const [clients, setClients] = useState(150)
  const [inactiveRate, setInactiveRate] = useState(30)
  const [ticket, setTicket] = useState(120)
  const [animated, setAnimated] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const inactiveCount = Math.round(clients * (inactiveRate / 100))
  const monthlyLoss = inactiveCount * ticket
  const yearlyLoss = monthlyLoss * 12

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setAnimated(true) }, { threshold: 0.3 })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])

  const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

  return (
    <section ref={ref} className="py-24 px-4 bg-gradient-to-br from-slate-950 via-red-950/30 to-slate-950 relative overflow-hidden">
      {/* Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-red-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto relative">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-full px-4 py-1.5 mb-6">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-red-400 text-sm font-semibold">Calculadora de Receita Perdida</span>
          </div>
          <h2 className="text-5xl md:text-6xl font-black text-white leading-tight mb-6">
            Você sabe quanto está<br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-orange-400">
              deixando na mesa?
            </span>
          </h2>
          <p className="text-slate-200 text-xl max-w-2xl mx-auto">
            Todo cliente que não volta é dinheiro que você trabalhou para ganhar — e perdeu.
            Veja quanto <strong className="text-white">sua estética</strong> está perdendo agora.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Sliders */}
          <div className="space-y-8">
            <SliderInput
              label="Clientes na sua base"
              value={clients} min={20} max={1000} step={10}
              onChange={setClients}
              display={`${clients} clientes`}
              color="blue"
            />
            <SliderInput
              label="Clientes inativos (não voltaram em 60 dias)"
              value={inactiveRate} min={5} max={80} step={5}
              onChange={setInactiveRate}
              display={`${inactiveRate}% — ${inactiveCount} pessoas`}
              color="orange"
            />
            <SliderInput
              label="Ticket médio por visita"
              value={ticket} min={50} max={600} step={10}
              onChange={setTicket}
              display={fmt(ticket)}
              color="purple"
            />
          </div>

          {/* Result card */}
          <div className={`${animated ? 'animate-fade-in' : 'opacity-0'}`}>
            <div className="bg-gradient-to-br from-slate-900 to-red-950/40 border border-red-500/20 rounded-3xl p-8 text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent" />
              <div className="relative">
                <TrendingDown className="w-12 h-12 text-red-400 mx-auto mb-4" />
                <p className="text-slate-300 text-sm font-medium uppercase tracking-widest mb-2">Você perdeu este mês</p>
                <div className="text-6xl md:text-7xl font-black text-white mb-2 tabular-nums">
                  {fmt(monthlyLoss)}
                </div>
                <p className="text-red-300 text-sm mb-8">com {inactiveCount} clientes que não voltaram</p>

                <div className="h-px bg-red-500/20 mb-6" />

                <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="bg-slate-800/60 rounded-2xl p-4">
                    <p className="text-slate-500 text-xs mb-1">Em 6 meses</p>
                    <p className="text-orange-400 font-black text-2xl">{fmt(monthlyLoss * 6)}</p>
                  </div>
                  <div className="bg-slate-800/60 rounded-2xl p-4">
                    <p className="text-slate-500 text-xs mb-1">No ano</p>
                    <p className="text-red-400 font-black text-2xl">{fmt(yearlyLoss)}</p>
                  </div>
                </div>

                <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-4 mb-6">
                  <Flame className="w-5 h-5 text-green-400 mx-auto mb-2" />
                  <p className="text-green-400 text-sm font-semibold">
                    Com o Auto Estética Flow você identifica esses {inactiveCount} clientes em segundos
                    e manda uma mensagem de reativação no WhatsApp com 1 clique.
                  </p>
                </div>

                <Link to="/onboarding">
                  <button className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-black text-lg py-4 px-8 rounded-2xl transition-all duration-200 hover:shadow-2xl hover:shadow-blue-500/30 hover:-translate-y-0.5 flex items-center justify-center gap-2">
                    Recuperar minha receita agora <ArrowRight className="w-5 h-5" />
                  </button>
                </Link>
                
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function SliderInput({ label, value, min, max, step, onChange, display, color }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; display: string; color: 'blue' | 'orange' | 'purple';
}) {
  const colors = {
    blue: 'accent-blue-500',
    orange: 'accent-orange-500',
    purple: 'accent-purple-500',
  }
  const textColors = { blue: 'text-blue-400', orange: 'text-orange-400', purple: 'text-purple-400' }
  const pct = ((value - min) / (max - min)) * 100

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <label className="text-slate-300 text-sm font-medium">{label}</label>
        <span className={`text-base font-bold ${textColors[color]}`}>{display}</span>
      </div>
      <div className="relative">
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full bg-gradient-to-r ${color === 'blue' ? 'from-blue-500 to-blue-400' : color === 'orange' ? 'from-orange-500 to-orange-400' : 'from-purple-500 to-purple-400'}`}
            style={{ width: `${pct}%` }} />
        </div>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className={`absolute inset-0 w-full h-2 opacity-0 cursor-pointer ${colors[color]}`}
          style={{ position: 'absolute', top: 0 }}
        />
        <div className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 border-white shadow-lg transition-all ${color === 'blue' ? 'bg-blue-500' : color === 'orange' ? 'bg-orange-500' : 'bg-purple-500'}`}
          style={{ left: `calc(${pct}% - 10px)`, pointerEvents: 'none' }} />
      </div>
    </div>
  )
}

/* ── Main ────────────────────────────────────────────────────────────── */

export default function Landing() {
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const handlePlanClick = (planId: string) => {
    // Stripe checkout — quando configurado, redireciona para checkout
    // Por ora vai para onboarding com o plano pré-selecionado
    window.location.href = `/onboarding?plan=${planId}`
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">

      {/* ── NAV ── */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-white/95 backdrop-blur shadow-sm' : 'bg-transparent'}`}>
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
              <Car className="w-4 h-4 text-white"/>
            </div>
            <span className={`font-black text-lg ${scrolled ? 'text-gray-900' : 'text-white'}`}>Auto Estética Flow</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="#planos" className={`text-sm font-medium hidden sm:block ${scrolled ? 'text-gray-600 hover:text-gray-900' : 'text-white/80 hover:text-white'}`}>Planos</a>
            <Link to="/login">
              <Button variant="ghost" className={scrolled ? 'text-gray-600' : 'text-white hover:bg-white/20'}>Entrar</Button>
            </Link>
            <Link to="/onboarding">
              <Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white border-0 font-semibold shadow-lg shadow-blue-500/20">
                Teste grátis
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-950 to-purple-950"/>
        <div className="absolute inset-0 opacity-15" style={{
          backgroundImage: `url("https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?w=1600&q=80")`,
          backgroundSize: 'cover', backgroundPosition: 'center',
        }}/>
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent"/>
        <div className="relative max-w-6xl mx-auto px-4 pt-20 pb-16">
          <div className="max-w-3xl">
            <Badge className="mb-6 bg-blue-500/20 text-blue-300 border-blue-500/30 text-sm px-4 py-1.5">
              🚗 Sistema #1 para estéticas automotivas
            </Badge>
            <h1 className="text-5xl md:text-6xl font-black text-white leading-tight mb-6">
              Sua estética no<br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                próximo nível.
              </span>
            </h1>
            <p className="text-xl text-slate-300 mb-8 leading-relaxed max-w-2xl">
              Chega de caderno, planilha e WhatsApp bagunçado. Controle OS, clientes, financeiro, estoque e WhatsApp em um só lugar — com agendamento online para o seu cliente.
            </p>
            <div className="flex flex-wrap gap-4 mb-12">
              <Link to="/onboarding">
                <Button size="lg" className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white border-0 text-lg px-8 gap-2 shadow-2xl shadow-blue-500/30 font-bold">
                  Começar 14 dias grátis <ArrowRight className="w-5 h-5"/>
                </Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="outline" className="border-blue-300/60 text-blue-100 bg-white/10 hover:bg-white/20 hover:border-white text-lg px-8 backdrop-blur-sm">
                  Já tenho conta
                </Button>
              </Link>
            </div>

          </div>
        </div>
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronDown className="w-6 h-6 text-white/50"/>
        </div>
      </section>

      {/* ── REVENUE LOSS CALCULATOR ── */}
      <RevenueLossCalculator />

      {/* ── PROBLEMA → SOLUÇÃO ── */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-black mb-6 leading-tight">
                Você ainda controla sua estética<br/>
                <span className="text-red-500">no papel ou na planilha?</span>
              </h2>
              <div className="space-y-3">
                {[
                  'Perde OS porque não tem controle centralizado',
                  'Não sabe quais clientes sumiram',
                  'O financeiro fecha no achismo',
                  'WhatsApp manual consome tempo que não tem',
                  'Estoque acaba na hora errada',
                  'Nenhum link para o cliente agendar sozinho',
                ].map(p => (
                  <div key={p} className="flex items-center gap-3 text-gray-600">
                    <X className="w-5 h-5 text-red-400 shrink-0"/><span>{p}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-3xl p-8 border border-blue-100">
              <h3 className="text-xl font-bold mb-5 text-gray-900">Com o Auto Estética Flow:</h3>
              <div className="space-y-3">
                {[
                  'OS organizadas por status, técnico e veículo',
                  'Alerta de clientes inativos há 45d+ — reative com 1 clique',
                  'Financeiro em tempo real e receita em risco visível',
                  'WhatsApp automático para confirmação e lembrete',
                  'Estoque com alertas de reposição',
                  'Link de agendamento online para o cliente usar pelo celular',
                ].map(p => (
                  <div key={p} className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0"/><span className="text-gray-700">{p}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-4xl font-black mb-4">Tudo que sua estética precisa</h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">Um sistema completo, pensado para o dia a dia de quem vive de carro.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map(f => (
              <div key={f.title} className="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-lg hover:-translate-y-1 transition-all duration-200 group">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <f.icon className="w-6 h-6 text-white"/>
                </div>
                <h3 className="font-bold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AGENDAMENTO ONLINE SPOTLIGHT ── */}
      <section className="py-20 px-4 bg-gradient-to-br from-blue-600 via-blue-700 to-purple-800 text-white">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <Badge className="mb-4 bg-white/20 text-white border-0">Novidade</Badge>
              <h2 className="text-4xl font-black mb-6 leading-tight">
                Agendamento online<br/>
                <span className="text-blue-200">direto pelo celular do cliente</span>
              </h2>
              <p className="text-blue-100 text-lg mb-8 leading-relaxed">
                Você recebe um link único da sua estética. O cliente acessa pelo celular ou tablet,
                informa o CPF/CNPJ, escolhe o serviço ou combo, seleciona o horário
                e pode pagar antecipadamente — sem precisar ligar.
              </p>
              <div className="space-y-3 mb-8">
                {[
                  'Validação por CPF/CNPJ — reconhece clientes antigos automaticamente',
                  'Combos e planos de assinatura cadastráveis pelo dono',
                  'Pagamento antecipado via cartão ou Pix (Stripe)',
                  'Tela otimizada para tablet e celular com teclas grandes',
                ].map(f => (
                  <div key={f} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-blue-300 shrink-0 mt-0.5"/><span className="text-blue-100 text-sm">{f}</span>
                  </div>
                ))}
              </div>
              <Link to="/onboarding">
                <button className="bg-white text-blue-700 font-bold px-8 py-4 rounded-xl hover:bg-blue-50 transition-colors flex items-center gap-2">
                  Testar agendamento grátis <ArrowRight className="w-5 h-5"/>
                </button>
              </Link>
            </div>
            {/* Mockup tablet */}
            <div className="bg-white/10 backdrop-blur rounded-3xl p-6 border border-white/20">
              <div className="bg-white rounded-2xl p-5 text-gray-900">
                <div className="flex items-center gap-3 mb-5 pb-4 border-b border-gray-100">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
                    <Car className="w-5 h-5 text-white"/>
                  </div>
                  <div><p className="font-bold text-sm">Estética do João</p><p className="text-xs text-gray-400">Agendamento Online</p></div>
                </div>
                <div className="space-y-3">
                  <div className="h-12 bg-blue-50 rounded-xl border-2 border-blue-100 flex items-center px-4 text-sm text-gray-500">
                    🔍 Seu CPF ou CNPJ
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {['💧 Lavagem', '✨ Polimento', '🪞 Higienização', '🧴 Cristalização'].map(s => (
                      <div key={s} className={`h-14 rounded-xl border-2 flex items-center justify-center text-sm font-medium text-gray-700 ${s === '💧 Lavagem' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200'}`}>{s}</div>
                    ))}
                  </div>
                  <div className="h-12 bg-green-600 rounded-xl flex items-center justify-center text-white font-bold text-sm">
                    ✓ Confirmar Agendamento
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PLANS ── */}
      <section id="planos" className="py-24 px-4 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black mb-4">Planos simples, sem surpresa</h2>
            <p className="text-gray-500 text-lg">Escolha pelo tamanho da sua operação. Mude quando quiser.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 items-start">
            {PLANS.map((plan, i) => (
              <div key={plan.id} className={`rounded-3xl overflow-hidden border-2 transition-all duration-200 hover:shadow-2xl hover:-translate-y-1 ${i === 1 ? 'border-purple-400 shadow-2xl shadow-purple-100 scale-[1.02]' : 'border-gray-200 bg-white'}`}>
                <div className={`bg-gradient-to-br ${plan.color} p-8 text-white`}>
                  {plan.badge && <div className="mb-3 inline-block bg-white/20 text-white text-xs font-bold px-3 py-1 rounded-full">{plan.badge}</div>}
                  <h3 className="text-2xl font-black mb-1">{plan.name}</h3>
                  <p className="text-white/70 text-sm mb-6">{plan.subtitle}</p>
                  <div className="flex items-end gap-1">
                    <span className="text-sm text-white/70 mb-2">R$</span>
                    <span className="text-5xl font-black">{plan.priceInt}</span>
                    <span className="text-2xl font-bold mb-1">,{plan.priceDec}</span>
                  </div>
                  <p className="text-white/60 text-sm mt-1">/mês · cobrança mensal</p>
                </div>
                <div className="bg-white p-6 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                    {plan.maxServices ? `${plan.maxServices} serviços incluídos` : 'Serviços ilimitados'}
                  </p>
                  <div className="space-y-1.5">
                    {plan.services.map(s => (
                      <div key={s} className="flex items-center gap-2 text-sm">
                        <Wrench className="w-3.5 h-3.5 text-blue-500 shrink-0"/><span className="text-gray-700">{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white p-6">
                  <div className="space-y-2 mb-6">
                    {plan.features.map(f => (
                      <div key={f} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0"/><span className="text-gray-700">{f}</span>
                      </div>
                    ))}
                    {plan.missing.map(f => (
                      <div key={f} className="flex items-center gap-2 text-sm opacity-40">
                        <X className="w-4 h-4 text-gray-400 shrink-0"/><span className="text-gray-500 line-through">{f}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => handlePlanClick(plan.id)}
                    className={`w-full bg-gradient-to-r ${plan.color} text-white font-bold py-3.5 rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2`}>
                    Começar grátis <ArrowRight className="w-4 h-4"/>
                  </button>
                  <p className="text-center text-xs text-gray-400 mt-2">14 dias grátis • Sem cartão</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── MOBILE / ANYWHERE ── */}
      <section className="py-20 px-4 bg-gradient-to-br from-slate-900 to-blue-950">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center text-white">
            <div>
              <h2 className="text-4xl font-black mb-6 leading-tight">
                Na palma da mão.<br/><span className="text-blue-400">Em qualquer tela.</span>
              </h2>
              <p className="text-slate-300 text-lg mb-8 leading-relaxed">
                Abre OS enquanto atende o cliente. Vê o financeiro no caminho para casa. Manda campanha pelo WhatsApp enquanto toma café.
              </p>
              <div className="flex flex-wrap gap-3">
                {['iOS e Android', 'PC e Mac', 'Tablet otimizado'].map(t => (
                  <div key={t} className="flex items-center gap-2 bg-white/10 rounded-full px-4 py-2 text-sm">
                    <Smartphone className="w-4 h-4 text-blue-400"/>{t}
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: Clock, title: 'Economize tempo', desc: 'Média de 3h/semana a menos em gestão manual' },
                { icon: DollarSign, title: 'Aumente receita', desc: 'Clientes reativados geram 23% mais faturamento' },
                { icon: Users, title: 'Fidelize mais', desc: 'Lembretes automáticos = clientes que voltam sempre' },
                { icon: Zap, title: 'Comece hoje', desc: '15 minutos para configurar e já estar usando' },
              ].map(c => (
                <div key={c.title} className="bg-white/10 rounded-2xl p-5">
                  <c.icon className="w-7 h-7 text-blue-400 mb-3"/>
                  <h4 className="font-bold text-sm mb-1">{c.title}</h4>
                  <p className="text-slate-400 text-xs leading-relaxed">{c.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-4xl font-black mb-4">Quem usa, aprova</h2>
            <p className="text-gray-500">Estéticas automotivas de todo o Brasil</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {TESTIMONIALS.map(t => (
              <div key={t.name} className="bg-white rounded-2xl p-7 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex gap-0.5 mb-4">
                  {Array(t.stars).fill(0).map((_, i) => <Star key={i} className="w-4 h-4 text-yellow-400 fill-yellow-400"/>)}
                </div>
                <p className="text-gray-700 leading-relaxed mb-5 italic">"{t.text}"</p>
                <div><p className="font-bold text-gray-900">{t.name}</p><p className="text-gray-400 text-sm">{t.role}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-20 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-4xl font-black mb-4">Dúvidas frequentes</h2>
          </div>
          <div className="space-y-3">
            {FAQS.map((faq, i) => (
              <div key={i} className="border border-gray-200 rounded-2xl overflow-hidden">
                <button className="w-full text-left px-6 py-5 flex items-center justify-between font-semibold text-gray-900 hover:bg-gray-50 transition-colors"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  {faq.q}
                  {openFaq === i ? <ChevronUp className="w-5 h-5 text-gray-400 shrink-0"/> : <ChevronDown className="w-5 h-5 text-gray-400 shrink-0"/>}
                </button>
                {openFaq === i && <div className="px-6 pb-5 text-gray-600 leading-relaxed border-t border-gray-100 pt-4 animate-fade-in">{faq.a}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section className="py-24 px-4 bg-gradient-to-br from-blue-600 via-purple-600 to-blue-800 text-white text-center">
        <div className="max-w-3xl mx-auto">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Car className="w-9 h-9 text-white"/>
          </div>
          <h2 className="text-4xl md:text-5xl font-black mb-6 leading-tight">
            Sua estética merece uma<br/>gestão profissional.
          </h2>
          <p className="text-blue-100 text-xl mb-8 max-w-xl mx-auto">
            Comece hoje. 14 dias grátis, sem cartão de crédito, sem complicação.
          </p>
          <Link to="/onboarding">
            <Button size="lg" className="bg-white text-blue-700 hover:bg-blue-50 text-xl px-12 py-6 font-black shadow-2xl gap-2">
              Quero começar grátis <ArrowRight className="w-6 h-6"/>
            </Button>
          </Link>
          <p className="mt-4 text-blue-200 text-sm">Já são +500 estéticas usando. Junte-se a elas.</p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-slate-900 text-slate-400 py-10 px-4">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
              <Car className="w-4 h-4 text-white"/>
            </div>
            <span className="font-bold text-white">Auto Estética Flow</span>
          </div>
          <p className="text-sm">© 2026 Auto Estética Flow. Todos os direitos reservados.</p>
          <div className="flex gap-6 text-sm">
            <a href="#planos" className="hover:text-white transition-colors">Planos</a>
            <Link to="/login" className="hover:text-white transition-colors">Entrar</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
