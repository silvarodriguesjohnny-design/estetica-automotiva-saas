import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  CheckCircle2, X, ArrowRight, Star, Zap, Shield, BarChart3,
  MessageSquare, Users, ClipboardList, Package, Wrench,
  TrendingUp, Clock, ChevronDown, ChevronUp, Car, Smartphone
} from 'lucide-react'

const PLANS = [
  {
    id: 'starter',
    name: 'Padrão',
    subtitle: 'Para quem está começando',
    price: 97.33,
    color: 'from-blue-500 to-blue-700',
    accent: 'blue',
    badge: null,
    maxServices: 2,
    services: ['Lavagem Automotiva Completa', 'Ducha'],
    features: [
      'Até 2 serviços cadastrados',
      'Clientes ilimitados',
      'Ordens de serviço',
      'Financeiro básico',
      'WhatsApp integrado',
      'Relatórios essenciais',
    ],
    missing: ['Serviços extras', 'Campanhas em massa', 'Múltiplos técnicos'],
  },
  {
    id: 'pro',
    name: 'Especialista',
    subtitle: 'Para quem já é referência',
    price: 159.90,
    color: 'from-purple-500 to-purple-700',
    accent: 'purple',
    badge: 'Mais popular',
    maxServices: 4,
    services: ['Lavagem Automotiva Completa', 'Ducha', 'Higienização Interna', 'Polimento'],
    features: [
      'Até 4 serviços cadastrados',
      'Clientes ilimitados',
      'Ordens de serviço completas',
      'Financeiro avançado',
      'WhatsApp + campanhas',
      'Múltiplos técnicos',
      'Estoque de produtos',
      'Templates de mensagens',
    ],
    missing: ['Serviços ilimitados'],
  },
  {
    id: 'enterprise',
    name: 'Multi Serviços',
    subtitle: 'Para estruturas completas',
    price: 297.90,
    color: 'from-orange-500 to-red-600',
    accent: 'orange',
    badge: 'Completo',
    maxServices: null,
    services: ['Todos os serviços — sem limite'],
    features: [
      'Serviços ilimitados',
      'Clientes ilimitados',
      'OS + agendamento online',
      'Financeiro + DRE',
      'WhatsApp + campanhas segmentadas',
      'Múltiplos técnicos e unidades',
      'Estoque completo com alertas',
      'Templates e automações',
      'Relatórios avançados',
      'Suporte prioritário',
    ],
    missing: [],
  },
]

const FEATURES = [
  { icon: ClipboardList, title: 'Ordens de Serviço', desc: 'Crie, acompanhe e finalize OS com um clique. Histórico completo de cada veículo.' },
  { icon: Users, title: 'Gestão de Clientes', desc: 'Ficha completa de cada cliente. Saiba quem não volta há 45 dias e aja antes de perder.' },
  { icon: MessageSquare, title: 'WhatsApp Automático', desc: 'Confirmações, lembretes e reativação de inativos — tudo no automático pelo WhatsApp.' },
  { icon: BarChart3, title: 'Financeiro em Tempo Real', desc: 'Receitas, despesas e receita em risco. Saiba exatamente quanto está deixando na mesa.' },
  { icon: Package, title: 'Controle de Estoque', desc: 'Produtos de limpeza e estética com alertas de estoque mínimo. Nunca fique sem insumos.' },
  { icon: Wrench, title: 'Catálogo de Serviços', desc: 'Cadastre seus serviços com tempo e valor. Ative ou desative conforme a demanda.' },
  { icon: TrendingUp, title: 'Campanhas Segmentadas', desc: 'Envie promoções para clientes inativos, aniversariantes ou por volume de serviços.' },
  { icon: Shield, title: 'Segurança Total', desc: 'Dados da sua empresa isolados com criptografia. Conformidade com LGPD.' },
]

const TESTIMONIALS = [
  {
    name: 'Rodrigo M.',
    role: 'Dono de estética em SP',
    text: 'Antes eu controlava tudo no papel. Agora com o Auto Estética Flow tenho todas as OS organizadas, o WhatsApp manda mensagem automático e o financeiro fecha certinho.',
    stars: 5,
  },
  {
    name: 'Ana P.',
    role: 'Estética em BH',
    text: 'O módulo de clientes inativos me salvou. Recuperei R$3.400 em um mês só mandando mensagem para quem sumiu. Simples e direto.',
    stars: 5,
  },
  {
    name: 'Carlos T.',
    role: 'Multi-unidades no RJ',
    text: 'Uso o plano Multi Serviços com 3 unidades. Consigo ver tudo centralizado, técnicos, OS e financeiro de cada unidade separado.',
    stars: 5,
  },
]

const FAQS = [
  { q: 'Preciso instalar alguma coisa?', a: 'Não. O Auto Estética Flow roda 100% no navegador, em qualquer celular, tablet ou computador. Sem instalação.' },
  { q: 'Posso mudar de plano depois?', a: 'Sim, a qualquer momento. Faça upgrade ou downgrade pelo painel de configurações.' },
  { q: 'E o WhatsApp, como funciona?', a: 'Você conecta o número da sua estética via QR code. A partir daí, o sistema envia mensagens pelo seu próprio número.' },
  { q: 'Meus dados ficam seguros?', a: 'Sim. Cada empresa tem seus dados totalmente isolados, com criptografia e backups automáticos.' },
  { q: 'Tem fidelidade?', a: 'Não. Você paga mês a mês e pode cancelar quando quiser, sem multa.' },
]

export default function Landing() {
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">

      {/* NAV */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-white/95 backdrop-blur shadow-sm' : 'bg-transparent'}`}>
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
              <Car className="w-5 h-5 text-white"/>
            </div>
            <span className={`font-bold text-lg ${scrolled ? 'text-gray-900' : 'text-white'}`}>Auto Estética Flow</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login">
              <Button variant="ghost" className={scrolled ? '' : 'text-white hover:text-white hover:bg-white/20'}>Entrar</Button>
            </Link>
            <Link to="/onboarding">
              <Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white border-0">
                Teste grátis
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-950 to-purple-950"/>
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: `url("https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?w=1600&q=80")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
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
              Chega de caderno, planilha e WhatsApp bagunçado. Com o Auto Estética Flow você controla OS, clientes, financeiro e WhatsApp em um só lugar — do celular ou computador.
            </p>
            <div className="flex flex-wrap gap-4 mb-12">
              <Link to="/onboarding">
                <Button size="lg" className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white border-0 text-lg px-8 gap-2 shadow-xl shadow-blue-500/30">
                  Começar 14 dias grátis <ArrowRight className="w-5 h-5"/>
                </Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="ghost" className="bg-slate-800/80 border border-slate-600 text-slate-100 hover:bg-slate-700 hover:text-white text-lg px-8">
                  Já tenho conta
                </Button>
              </Link>
            </div>
            <div className="flex flex-wrap gap-6 text-slate-400 text-sm">
              {['Sem cartão de crédito', 'Cancele quando quiser', 'Suporte em português'].map(t => (
                <span key={t} className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-green-400"/>{t}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronDown className="w-6 h-6 text-white/50"/>
        </div>
      </section>

      {/* PROBLEMA → SOLUÇÃO */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-black mb-6 leading-tight">
                Você ainda controla sua estética<br/>
                <span className="text-red-500">no papel ou na planilha?</span>
              </h2>
              <div className="space-y-4">
                {[
                  'Perde OS porque não tem controle centralizado',
                  'Não sabe quais clientes sumiram',
                  'O financeiro fecha no achismo',
                  'WhatsApp manual toma tempo que você não tem',
                  'Estoque acaba na hora errada',
                ].map(p => (
                  <div key={p} className="flex items-start gap-3 text-gray-600">
                    <X className="w-5 h-5 text-red-400 shrink-0 mt-0.5"/>
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-3xl p-8 border border-blue-100">
              <h3 className="text-xl font-bold mb-5 text-gray-900">Com o Auto Estética Flow:</h3>
              <div className="space-y-4">
                {[
                  'OS organizadas por status, técnico e veículo',
                  'Alerta automático de clientes inativos há 45d+',
                  'Financeiro em tempo real com receita em risco',
                  'WhatsApp automático para confirmação e lembrete',
                  'Estoque com alertas de reposição',
                ].map(p => (
                  <div key={p} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5"/>
                    <span className="text-gray-700">{p}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-4xl font-black mb-4">Tudo que sua estética precisa</h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">Um sistema completo, pensado para o dia a dia de quem trabalha com carro.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map(f => (
              <div key={f.title} className="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-lg hover:-translate-y-1 transition-all group">
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

      {/* PLANS */}
      <section id="planos" className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-4xl font-black mb-4">Planos simples, sem surpresa</h2>
            <p className="text-gray-500 text-lg">Escolha pelo tamanho da sua operação. Mude quando quiser.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 items-start">
            {PLANS.map((plan, i) => (
              <div key={plan.id} className={`rounded-3xl overflow-hidden border-2 ${i === 1 ? 'border-purple-400 shadow-2xl shadow-purple-200 scale-105' : 'border-gray-200'}`}>
                {/* Header */}
                <div className={`bg-gradient-to-br ${plan.color} p-8 text-white`}>
                  {plan.badge && (
                    <Badge className="mb-3 bg-white/20 text-white border-0 text-xs">{plan.badge}</Badge>
                  )}
                  <h3 className="text-2xl font-black mb-1">{plan.name}</h3>
                  <p className="text-white/70 text-sm mb-6">{plan.subtitle}</p>
                  <div className="flex items-end gap-1">
                    <span className="text-sm text-white/70">R$</span>
                    <span className="text-5xl font-black">{plan.price.toFixed(2).replace('.', ',').split(',')[0]}</span>
                    <span className="text-2xl font-bold">,{plan.price.toFixed(2).split('.')[1]}</span>
                  </div>
                  <p className="text-white/60 text-sm mt-1">/mês</p>
                </div>

                {/* Serviços incluídos */}
                <div className="bg-white p-6 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                    {plan.maxServices ? `${plan.maxServices} serviços incluídos` : 'Serviços ilimitados'}
                  </p>
                  <div className="space-y-2">
                    {plan.services.map(s => (
                      <div key={s} className="flex items-center gap-2 text-sm">
                        <Wrench className="w-3.5 h-3.5 text-blue-500 shrink-0"/>
                        <span className="text-gray-700">{s}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Features */}
                <div className="bg-white p-6">
                  <div className="space-y-2.5 mb-6">
                    {plan.features.map(f => (
                      <div key={f} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0"/>
                        <span className="text-gray-700">{f}</span>
                      </div>
                    ))}
                    {plan.missing.map(f => (
                      <div key={f} className="flex items-center gap-2 text-sm opacity-40">
                        <X className="w-4 h-4 text-gray-400 shrink-0"/>
                        <span className="text-gray-500 line-through">{f}</span>
                      </div>
                    ))}
                  </div>
                  <Link to="/onboarding">
                    <Button className={`w-full bg-gradient-to-r ${plan.color} text-white border-0 font-semibold`}>
                      Começar grátis <ArrowRight className="w-4 h-4 ml-1"/>
                    </Button>
                  </Link>
                  <p className="text-center text-xs text-gray-400 mt-2">14 dias grátis • Sem cartão</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MOBILE */}
      <section className="py-20 px-4 bg-gradient-to-br from-slate-900 to-blue-950">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center text-white">
            <div>
              <h2 className="text-4xl font-black mb-6 leading-tight">
                Na palma da mão.<br/>
                <span className="text-blue-400">No celular ou no computador.</span>
              </h2>
              <p className="text-slate-300 text-lg mb-8 leading-relaxed">
                Abre uma OS enquanto atende o cliente. Vê o financeiro no caminho para casa. Manda campanha pelo WhatsApp enquanto toma café.
              </p>
              <div className="flex flex-wrap gap-4">
                {['iOS e Android', 'PC e Mac', 'Funciona offline'].map(t => (
                  <div key={t} className="flex items-center gap-2 bg-white/10 rounded-full px-4 py-2 text-sm">
                    <Smartphone className="w-4 h-4 text-blue-400"/>{t}
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: Clock, title: 'Economize tempo', desc: 'Média de 3h/semana a menos em gestão manual' },
                { icon: TrendingUp, title: 'Aumente receita', desc: 'Clientes reativos geram 23% mais faturamento' },
                { icon: Users, title: 'Fidelize mais', desc: 'Lembretes automáticos = clientes que voltam' },
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

      {/* TESTIMONIALS */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-4xl font-black mb-4">Quem usa, aprova</h2>
            <p className="text-gray-500">Estéticas automotivas de todo o Brasil</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {TESTIMONIALS.map(t => (
              <div key={t.name} className="bg-white rounded-2xl p-7 border border-gray-100 shadow-sm">
                <div className="flex gap-0.5 mb-4">
                  {Array(t.stars).fill(0).map((_, i) => (
                    <Star key={i} className="w-4 h-4 text-yellow-400 fill-yellow-400"/>
                  ))}
                </div>
                <p className="text-gray-700 leading-relaxed mb-5 italic">"{t.text}"</p>
                <div>
                  <p className="font-bold text-gray-900">{t.name}</p>
                  <p className="text-gray-400 text-sm">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-4xl font-black mb-4">Dúvidas frequentes</h2>
          </div>
          <div className="space-y-3">
            {FAQS.map((faq, i) => (
              <div key={i} className="border border-gray-200 rounded-2xl overflow-hidden">
                <button
                  className="w-full text-left px-6 py-5 flex items-center justify-between font-semibold text-gray-900 hover:bg-gray-50 transition-colors"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  {faq.q}
                  {openFaq === i ? <ChevronUp className="w-5 h-5 text-gray-400 shrink-0"/> : <ChevronDown className="w-5 h-5 text-gray-400 shrink-0"/>}
                </button>
                {openFaq === i && (
                  <div className="px-6 pb-5 text-gray-600 leading-relaxed border-t border-gray-100 pt-4">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="py-24 px-4 bg-gradient-to-br from-blue-600 via-purple-600 to-blue-800 text-white text-center">
        <div className="max-w-3xl mx-auto">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Car className="w-9 h-9 text-white"/>
          </div>
          <h2 className="text-4xl md:text-5xl font-black mb-6 leading-tight">
            Sua estética merece uma gestão profissional.
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

      {/* FOOTER */}
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
