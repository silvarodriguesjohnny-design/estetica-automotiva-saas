import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import {
  CheckCircle2, Circle, ChevronRight, X, Rocket, MessageCircle,
  Wrench, Share2, ClipboardList, Repeat, CreditCard, PartyPopper,
  ChevronDown, Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ══════════════════════════════════════════════════════════════
   CHECKLIST DE PRIMEIROS PASSOS

   O problema que resolve: o dono da estética entra no sistema pela
   primeira vez, vê um dashboard vazio e não sabe por onde começar.
   Ele fecha a aba e volta "depois" — que costuma virar nunca. Esse
   é o momento em que a maioria dos trials morre.

   A ORDEM IMPORTA. Não está por complexidade técnica, e sim por
   velocidade até o primeiro resultado visível:

     1. WhatsApp    → sem isso nada do resto se comunica
     2. Serviços    → os preços padrão não são os dele
     3. Divulgar    → é aqui que o primeiro agendamento nasce
     4. Agendamento → o momento "funcionou!"
     5. Combo       → receita recorrente
     6. Pagamento   → reduz falta e antecipa caixa

   Cada item é DETECTADO no banco, não marcado à mão. Checklist com
   caixinha manual vira mentira: a pessoa marca sem fazer.
   ══════════════════════════════════════════════════════════════ */

interface StepDef {
  id: string
  title: string
  why: string            // o benefício, não a tarefa
  cta: string
  icon: React.ElementType
  action: () => void
  done: boolean
  /** Passos essenciais aparecem mesmo com o checklist recolhido */
  essential?: boolean
}

interface Progress {
  whatsapp: boolean
  services: boolean
  shared: boolean
  booking: boolean
  combo: boolean
  payments: boolean
}

const DISMISS_KEY = 'aef_checklist_dismissed'
const SHARED_KEY = 'aef_agenda_compartilhada'

export default function OnboardingChecklist() {
  const { tenant } = useAuth()
  const navigate = useNavigate()

  const [progress, setProgress] = useState<Progress | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === '1',
  )

  const bookingUrl = `${window.location.origin}/agendar/${tenant?.id ?? ''}`

  /* ── Detecta o que já foi feito ── */
  const check = useCallback(async () => {
    if (!tenant?.id) return

    const [msg, srv, ord, plans] = await Promise.all([
      supabase.from('messaging_configs').select('status')
        .eq('tenant_id', tenant.id).maybeSingle(),
      supabase.from('services').select('id, price', { count: 'exact' })
        .eq('tenant_id', tenant.id).eq('is_active', true),
      supabase.from('service_orders').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id),
      supabase.from('subscription_plans').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id),
    ])

    /* Serviços: o tenant nasce com 5 padrões. Consideramos "revisado"
       quando a quantidade mudou — ele adicionou os dele ou removeu os
       que não faz. Não é perfeito, mas evita pedir confirmação manual. */
    const servicesCount = srv.count ?? 0
    const servicesTouched = servicesCount > 0 && servicesCount !== 5

    setProgress({
      whatsapp: msg.data?.status === 'connected',
      services: servicesTouched,
      shared: localStorage.getItem(SHARED_KEY) === '1',
      booking: (ord.count ?? 0) > 0,
      combo: (plans.count ?? 0) > 0,
      payments: (tenant as { stripe_account_status?: string })?.stripe_account_status === 'active',
    })
  }, [tenant])

  useEffect(() => { check() }, [check])

  // Revalida ao voltar para a aba — o dono pode ter conectado o
  // WhatsApp noutra janela e espera ver o check aqui.
  useEffect(() => {
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [check])

  const shareAgenda = () => {
    navigator.clipboard.writeText(
      `Olá! 🚗 Agende seu horário na ${tenant?.name} pelo link:\n${bookingUrl}`,
    )
    localStorage.setItem(SHARED_KEY, '1')
    toast.success('Mensagem copiada! Mande no seu grupo de clientes.')
    check()
  }

  if (!progress || dismissed) return null

  const steps: StepDef[] = [
    {
      id: 'whatsapp',
      title: 'Conectar seu WhatsApp',
      why: 'Confirmações e lembretes saem do seu número, e o cliente responde direto pra você',
      cta: 'Conectar agora',
      icon: MessageCircle,
      done: progress.whatsapp,
      essential: true,
      action: () => navigate('/settings?tab=whatsapp'),
    },
    {
      id: 'services',
      title: 'Ajustar seus serviços e preços',
      why: 'Deixamos alguns exemplos. Troque pelos que você faz de verdade',
      cta: 'Revisar serviços',
      icon: Wrench,
      done: progress.services,
      essential: true,
      action: () => navigate('/servicos'),
    },
    {
      id: 'shared',
      title: 'Divulgar sua agenda online',
      why: 'É por aqui que os agendamentos começam a chegar sozinhos',
      cta: 'Copiar mensagem',
      icon: Share2,
      done: progress.shared,
      essential: true,
      action: shareAgenda,
    },
    {
      id: 'booking',
      title: 'Receber o primeiro agendamento',
      why: 'Quando o primeiro cliente agendar, ele aparece aqui automaticamente',
      cta: 'Ver agenda',
      icon: ClipboardList,
      done: progress.booking,
      action: () => navigate('/agenda'),
    },
    {
      id: 'combo',
      title: 'Criar um plano de assinatura',
      why: 'Cliente que assina volta todo mês — é a receita que não depende de captação',
      cta: 'Criar combo',
      icon: Repeat,
      done: progress.combo,
      action: () => navigate('/combos'),
    },
    {
      id: 'payments',
      title: 'Aceitar pagamento antecipado',
      why: 'Quem paga na hora de agendar praticamente não falta',
      cta: 'Configurar',
      icon: CreditCard,
      done: progress.payments,
      action: () => navigate('/settings?tab=pagamentos'),
    },
  ]

  const doneCount = steps.filter(s => s.done).length
  const total = steps.length
  const pct = Math.round((doneCount / total) * 100)
  const allDone = doneCount === total

  /* Próximo passo pendente — o foco da tela quando recolhido */
  const next = steps.find(s => !s.done)

  /* ── Tudo pronto: celebra e some ── */
  if (allDone) {
    return (
      <div className="rounded-2xl border-2 border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 p-5">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-green-100 rounded-2xl flex items-center justify-center shrink-0">
            <PartyPopper className="w-6 h-6 text-green-600" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-green-900">Configuração completa! 🎉</p>
            <p className="text-sm text-green-700 mt-0.5">
              Sua estética está pronta para operar. Agora é só cuidar dos carros.
            </p>
          </div>
          <button
            onClick={() => { localStorage.setItem(DISMISS_KEY, '1'); setDismissed(true) }}
            className="p-1.5 rounded-lg hover:bg-green-100 text-green-600 shrink-0"
            title="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    )
  }

  /* ══════════════════════════════════════════════════════════ */

  return (
    <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50/60 to-white overflow-hidden">

      {/* ── Cabeçalho com progresso ── */}
      <div className="p-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-11 h-11 bg-blue-600 rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-blue-600/25">
              <Rocket className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900">Deixe sua estética pronta</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                {doneCount === 0
                  ? 'Leva uns 10 minutos no total'
                  : `${doneCount} de ${total} concluídos — falta pouco`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setCollapsed(c => !c)}
              className="p-1.5 rounded-lg hover:bg-blue-100 text-blue-600"
              title={collapsed ? 'Expandir' : 'Recolher'}>
              <ChevronDown className={cn('w-5 h-5 transition-transform', collapsed && '-rotate-90')} />
            </button>
            <button
              onClick={() => { localStorage.setItem(DISMISS_KEY, '1'); setDismissed(true) }}
              className="p-1.5 rounded-lg hover:bg-blue-100 text-blue-400"
              title="Não mostrar mais">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Barra */}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 h-2 bg-blue-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-bold text-blue-700 tabular-nums shrink-0">{pct}%</span>
        </div>
      </div>

      {/* ── Recolhido: só o próximo passo ── */}
      {collapsed && next && (
        <div className="px-5 pb-5">
          <button onClick={next.action}
            className="w-full flex items-center gap-3 p-3 bg-white rounded-xl border-2 border-blue-200 hover:border-blue-400 transition-all text-left">
            <next.icon className="w-5 h-5 text-blue-600 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-400">Próximo passo</p>
              <p className="font-semibold text-sm text-gray-900 truncate">{next.title}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-blue-400 shrink-0" />
          </button>
        </div>
      )}

      {/* ── Expandido: lista completa ── */}
      {!collapsed && (
        <div className="px-3 pb-3 space-y-1.5">
          {steps.map((s, i) => (
            <div key={s.id}
              className={cn(
                'flex items-start gap-3 p-3 rounded-xl transition-all',
                s.done
                  ? 'bg-transparent'
                  : 'bg-white border border-gray-100 hover:border-blue-200',
              )}>

              {/* Status */}
              <div className="shrink-0 mt-0.5">
                {s.done
                  ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                  : (
                    <div className="relative">
                      <Circle className="w-5 h-5 text-gray-300" />
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-gray-400">
                        {i + 1}
                      </span>
                    </div>
                  )}
              </div>

              {/* Conteúdo */}
              <div className="min-w-0 flex-1">
                <p className={cn('font-semibold text-sm',
                  s.done ? 'text-gray-400 line-through' : 'text-gray-900')}>
                  {s.title}
                </p>
                {!s.done && (
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{s.why}</p>
                )}
              </div>

              {/* Ação */}
              {!s.done && (
                <Button size="sm" variant="outline"
                  onClick={s.action}
                  className="shrink-0 gap-1 text-xs h-8 border-blue-200 text-blue-700 hover:bg-blue-50">
                  {s.cta}
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Aviso de trial curto ── */}
      {tenant?.subscription_type === 'trial' && tenant.trial_ends_at && (() => {
        const dias = Math.ceil(
          (new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86400000,
        )
        if (dias > 7 || dias < 0) return null
        return (
          <div className="px-5 py-3 bg-amber-50 border-t border-amber-200 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-xs text-amber-800">
              Seu período de testes termina em <strong>{dias} dia{dias !== 1 ? 's' : ''}</strong>.
              Complete a configuração para aproveitar melhor.
            </p>
          </div>
        )
      })()}
    </div>
  )
}
