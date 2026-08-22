import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import {
  CreditCard, CheckCircle2, AlertTriangle, Loader2, ExternalLink,
  TrendingUp, ShieldCheck, Percent, ArrowUpRight, Banknote, Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ══════════════════════════════════════════════════════════════
   Onboarding do Stripe Connect para a estética.

   O dono conecta a conta bancária dele em ~5 minutos, direto no
   fluxo hospedado pela Stripe. A partir daí, quando um cliente
   paga o agendamento antecipadamente, o dinheiro cai na conta
   dele e a comissão da plataforma é retida automaticamente.
   ══════════════════════════════════════════════════════════════ */

type Status = 'loading' | 'not_connected' | 'onboarding' | 'pending' | 'active' | 'restricted' | 'rejected'

interface ConnectState {
  status: Status
  accountId?: string
  chargesEnabled?: boolean
  payoutsEnabled?: boolean
  requirements?: string[]
  disabledReason?: string | null
  continueUrl?: string | null
  commissionPct?: number
  planType?: string
  earnings?: {
    paid_transactions: number
    gross_volume: number
    platform_revenue: number
    tenant_revenue: number
    last_sale_at: string | null
  } | null
  error?: string
}

const money = (n: number) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const PLAN_LABEL: Record<string, string> = {
  starter: 'Padrão', pro: 'Especialista', enterprise: 'Premium',
}

function callFn(action: string, token: string) {
  return fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-connect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ action }),
  }).then(r => r.json())
}

export default function StripeConnect() {
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState<ConnectState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(false)
  const [savingToggle, setSavingToggle] = useState(false)
  const tokenRef = useRef('')

  const getToken = useCallback(async () => {
    if (tokenRef.current) return tokenRef.current
    const { data } = await supabase.auth.getSession()
    tokenRef.current = data.session?.access_token ?? ''
    return tokenRef.current
  }, [])

  const refresh = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    try {
      const res: ConnectState = await callFn('status', token)
      setState(res.error ? { status: 'not_connected', error: res.error } : res)
    } catch {
      setState({ status: 'not_connected', error: 'Falha ao consultar' })
    }
  }, [getToken])

  useEffect(() => { refresh() }, [refresh])

  /* Estado do "aceitar pagamento online" */
  useEffect(() => {
    supabase.from('tenants').select('online_payments_enabled').maybeSingle()
      .then(({ data }) => setOnline(!!data?.online_payments_enabled))
  }, [])

  /* Liga/desliga a opção "Pagar agora" na agenda pública.
     Só faz sentido se a conta já puder receber — por isso o
     controle fica desabilitado enquanto o Connect não está ativo. */
  const toggleOnline = async (value: boolean) => {
    setSavingToggle(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: prof } = await supabase
      .from('profiles').select('tenant_id').eq('id', user?.id ?? '').maybeSingle()

    const { error } = await supabase.from('tenants')
      .update({ online_payments_enabled: value })
      .eq('id', prof?.tenant_id ?? '')

    if (error) { toast.error('Não foi possível salvar'); setSavingToggle(false); return }
    setOnline(value)
    toast.success(value
      ? 'Pagamento online ativado na sua agenda'
      : 'Pagamento online desativado — seus clientes pagam no local')
    setSavingToggle(false)
  }

  /* Voltou do fluxo da Stripe → revalida e limpa a URL */
  useEffect(() => {
    if (params.get('done') || params.get('refresh')) {
      refresh()
      const p = new URLSearchParams(params)
      p.delete('done'); p.delete('refresh')
      setParams(p, { replace: true })
    }
  }, [params, refresh, setParams])

  const startOnboarding = async () => {
    setBusy(true)
    const token = await getToken()
    try {
      const res = await callFn('onboard', token)
      if (res.url) { window.location.href = res.url; return }
      toast.error(res.error ?? 'Não foi possível iniciar o cadastro')
    } catch {
      toast.error('Erro ao conectar com o Stripe')
    } finally { setBusy(false) }
  }

  const openDashboard = async () => {
    setBusy(true)
    const token = await getToken()
    try {
      const res = await callFn('dashboard', token)
      if (res.url) window.open(res.url, '_blank', 'noopener')
      else toast.error(res.error ?? 'Painel indisponível')
    } finally { setBusy(false) }
  }

  const e = state.earnings

  /* ══════════════════════════════════════════════════════════ */

  return (
    <div className="space-y-5">
      {/* ── Cabeçalho ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-indigo-600" />
          <h3 className="font-bold text-foreground">Receber pagamentos online</h3>
        </div>
        <StatusPill status={state.status} />
      </div>

      {/* ══ ATIVO ══ */}
      {state.status === 'active' && (
        <>
          <div className="rounded-2xl border-2 border-green-200 bg-green-50/50 p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-2xl flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-green-900">Conta ativa</p>
                <p className="text-sm text-green-700 mt-0.5">
                  Seus clientes já podem pagar antecipadamente. O dinheiro cai direto
                  na sua conta bancária, com repasse diário.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <Button size="sm" variant="outline" onClick={openDashboard} disabled={busy}
                className="gap-1.5 border-green-300 text-green-700 hover:bg-green-100">
                <ExternalLink className="w-3.5 h-3.5" />Ver extrato no Stripe
              </Button>
              <Button size="sm" variant="ghost" onClick={refresh} disabled={busy}
                className="gap-1.5 text-green-700">
                Atualizar
              </Button>
            </div>
          </div>

          {/* ── Aceitar pagamento online ──
              A única decisão que a estética precisa tomar aqui.
              Sem percentual, sem jargão financeiro. */}
          <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/40 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
                  <Banknote className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-indigo-900">Aceitar pagamento na agenda</p>
                  <p className="text-sm text-indigo-700 mt-0.5 leading-relaxed">
                    {online
                      ? 'Seus clientes veem a opção "Pagar agora" ao agendar. Quem paga antes praticamente não falta.'
                      : 'Ativando, seus clientes poderão pagar no momento do agendamento — por cartão ou Pix.'}
                  </p>
                </div>
              </div>
              <Switch
                checked={online}
                disabled={savingToggle}
                onCheckedChange={toggleOnline}
                className="shrink-0 mt-1"
              />
            </div>
          </div>

          {/* Faturamento */}
          {e && e.paid_transactions > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Metric icon={Banknote}   label="Pagamentos"    value={String(e.paid_transactions)} tone="blue" />
              <Metric icon={TrendingUp} label="Volume total"  value={money(e.gross_volume)}       tone="indigo" />
              <Metric icon={CheckCircle2} label="Você recebeu" value={money(e.tenant_revenue)}    tone="green" />
              <Metric icon={Percent}    label="Taxa aplicada" value={money(e.platform_revenue)}   tone="gray" />
            </div>
          )}
        </>
      )}

      {/* ══ NÃO CONECTADO ══ */}
      {state.status === 'not_connected' && (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-8 text-center">
          <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <CreditCard className="w-8 h-8 text-indigo-600" />
          </div>
          <p className="font-bold text-gray-900">Aceite pagamento antecipado</p>
          <p className="text-sm text-gray-500 mt-1.5 max-w-md mx-auto leading-relaxed">
            Quando o cliente paga na hora de agendar, a chance de ele faltar cai muito.
            Conecte sua conta bancária para liberar essa opção na sua agenda pública.
          </p>
          <Button onClick={startOnboarding} disabled={busy}
            className="mt-5 gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            {busy ? 'Abrindo…' : 'Conectar minha conta'}
          </Button>
          <p className="text-xs text-gray-400 mt-3">
            Cadastro seguro pelo Stripe · leva cerca de 5 minutos
          </p>
        </div>
      )}

      {/* ══ EM ANDAMENTO / PENDENTE / RESTRITO ══ */}
      {['onboarding', 'pending', 'restricted'].includes(state.status) && (
        <div className={cn('rounded-2xl border-2 p-5',
          state.status === 'pending' ? 'border-blue-200 bg-blue-50/50' : 'border-amber-200 bg-amber-50/50')}>
          <div className="flex items-start gap-4">
            <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center shrink-0',
              state.status === 'pending' ? 'bg-blue-100' : 'bg-amber-100')}>
              {state.status === 'pending'
                ? <Clock className="w-6 h-6 text-blue-600" />
                : <AlertTriangle className="w-6 h-6 text-amber-600" />}
            </div>
            <div className="flex-1">
              <p className={cn('font-bold', state.status === 'pending' ? 'text-blue-900' : 'text-amber-900')}>
                {state.status === 'pending' ? 'Cadastro em análise' : 'Cadastro incompleto'}
              </p>
              <p className={cn('text-sm mt-0.5', state.status === 'pending' ? 'text-blue-700' : 'text-amber-700')}>
                {state.status === 'pending'
                  ? 'O Stripe está verificando seus dados. Costuma levar até 24 horas.'
                  : 'Faltam algumas informações para você poder receber.'}
              </p>

              {(state.requirements?.length ?? 0) > 0 && (
                <ul className="mt-3 space-y-1">
                  {state.requirements!.slice(0, 5).map(r => (
                    <li key={r} className="text-xs text-amber-800 flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-amber-500 shrink-0" />
                      {translateRequirement(r)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {state.continueUrl && (
            <a href={state.continueUrl} className="block mt-4">
              <Button className={cn('w-full gap-2 text-white',
                state.status === 'pending' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-amber-600 hover:bg-amber-700')}>
                <ArrowUpRight className="w-4 h-4" />
                {state.status === 'pending' ? 'Revisar dados' : 'Completar cadastro'}
              </Button>
            </a>
          )}
          <Button variant="ghost" size="sm" onClick={refresh} disabled={busy} className="w-full mt-2 text-xs">
            Já completei — verificar novamente
          </Button>
        </div>
      )}

      {/* ══ REJEITADO ══ */}
      {state.status === 'rejected' && (
        <div className="rounded-2xl border-2 border-red-200 bg-red-50/50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-red-900">Cadastro não aprovado</p>
              <p className="text-sm text-red-700 mt-1">
                {state.disabledReason ?? 'O Stripe não aprovou esta conta.'} Entre em
                contato com o suporte do Stripe para entender o motivo.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ══ CARREGANDO ══ */}
      {state.status === 'loading' && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-300" />
        </div>
      )}

      {/* ── Rodapé ── */}
      <div className="flex gap-3 p-4 bg-gray-50 rounded-xl text-xs text-gray-500">
        <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
        <div className="space-y-1">
          <p>
            <strong className="text-gray-700">Seus dados bancários</strong> ficam com o Stripe,
            não com a gente. Não temos acesso à sua conta.
          </p>
          <p>Os valores caem na sua conta com repasse diário, direto do Stripe.</p>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════ */

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string; dot: string }> = {
    loading:       { label: 'Carregando…',  cls: 'bg-gray-100 text-gray-500',   dot: 'bg-gray-400' },
    not_connected: { label: 'Não conectado',cls: 'bg-gray-100 text-gray-600',   dot: 'bg-gray-400' },
    onboarding:    { label: 'Incompleto',   cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
    pending:       { label: 'Em análise',   cls: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500 animate-pulse' },
    active:        { label: 'Ativo',        cls: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
    restricted:    { label: 'Pendências',   cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
    rejected:      { label: 'Recusado',     cls: 'bg-red-100 text-red-700',     dot: 'bg-red-500' },
  }
  const s = map[status]
  return (
    <span className={cn('flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold shrink-0', s.cls)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', s.dot)} />{s.label}
    </span>
  )
}

function Metric({ icon: Icon, label, value, tone }: {
  icon: React.ElementType; label: string; value: string; tone: 'blue' | 'indigo' | 'green' | 'gray'
}) {
  const tones = {
    blue:   'bg-blue-50 text-blue-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    green:  'bg-green-50 text-green-600',
    gray:   'bg-gray-100 text-gray-500',
  }
  return (
    <div className="bg-card rounded-xl border p-3">
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center mb-2', tones[tone])}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

/** Traduz os códigos técnicos da Stripe para linguagem de dono de estética. */
function translateRequirement(code: string): string {
  const map: Record<string, string> = {
    'individual.verification.document': 'Documento com foto (RG ou CNH)',
    'individual.id_number': 'CPF',
    'individual.first_name': 'Nome',
    'individual.last_name': 'Sobrenome',
    'individual.dob.day': 'Data de nascimento',
    'individual.address.line1': 'Endereço',
    'individual.phone': 'Telefone',
    'individual.email': 'E-mail',
    'company.tax_id': 'CNPJ',
    'company.name': 'Razão social',
    'company.address.line1': 'Endereço da empresa',
    'company.verification.document': 'Contrato social',
    'external_account': 'Conta bancária para receber',
    'business_profile.url': 'Site ou rede social',
    'business_profile.mcc': 'Ramo de atividade',
    'tos_acceptance.date': 'Aceite dos termos',
  }
  return map[code] ?? code.replace(/[._]/g, ' ')
}
