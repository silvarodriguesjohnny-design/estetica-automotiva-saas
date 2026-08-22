import { useMemo, useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/lib/supabase/client'
import { PLANS, getPriceId, type PlanId } from '@/config/plans'
import {
  ArrowUpCircle, Check, Loader2, AlertTriangle, Sparkles,
  ShieldCheck, X, CreditCard,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

/* ══════════════════════════════════════════════════════════════
   Upgrade de plano

   Duas decisões de produto embutidas aqui:

   1. Só planos SUPERIORES aparecem. Antes a tela listava todos
      os planos diferentes do atual — então quem estava no Pro
      via o Padrão com um botão "Fazer upgrade". Chamar de upgrade
      algo que remove recursos não é só feio, é a UI dizendo ao
      cliente que ninguém revisou aquela tela.

   2. O valor é mostrado ANTES de confirmar. Cobrança proporcional
      surpresa é a origem clássica de chargeback: o cliente não
      reconhece R$ 98 que não são nem o preço velho nem o novo.
      Mostrar o cálculo transforma uma disputa em uma confirmação.
   ══════════════════════════════════════════════════════════════ */

const RANK: Record<PlanId, number> = { starter: 1, pro: 2, enterprise: 3 }

interface Preview {
  planoNovo: string
  cobrancaAgora: number
  creditoProporcional: number
  proximoCiclo: string | null
}

const money = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function PlanUpgrade() {
  const { tenant, refreshAuth } = useAuth()
  const atual = (tenant?.plan_type ?? 'starter') as PlanId

  const [alvo, setAlvo] = useState<PlanId | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)

  /* Só o que está acima do plano atual */
  const superiores = useMemo(
    () => PLANS.filter(p => RANK[p.id] > (RANK[atual] ?? 0)),
    [atual],
  )

  const planoAtual = PLANS.find(p => p.id === atual) ?? PLANS[0]

  const call = async (action: 'preview' | 'confirm', planId: PlanId) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-change-plan`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ action, planId, priceId: getPriceId(planId) }),
      },
    )
    const raw = await res.text()
    try { return { ok: res.ok, data: JSON.parse(raw) } }
    catch { return { ok: false, data: { error: raw.slice(0, 200) } } }
  }

  const abrirPreview = async (planId: PlanId) => {
    setAlvo(planId)
    setCarregando(true)
    setPreview(null)

    const { ok, data } = await call('preview', planId)
    setCarregando(false)

    if (!ok) {
      toast.error(data.error ?? 'Não foi possível calcular o valor')
      setAlvo(null)
      return
    }

    /* Sem assinatura ativa (trial sem cartão, tenant manual):
       o caminho é um checkout novo, não um update. */
    if (data.needsCheckout) {
      toast.info('Você será redirecionado para concluir o pagamento.')
      window.location.href = `/onboarding?plan=${planId}&upgrade=1`
      return
    }

    setPreview(data as Preview)
  }

  const confirmar = async () => {
    if (!alvo) return
    setConfirmando(true)

    const { ok, data } = await call('confirm', alvo)
    setConfirmando(false)

    if (!ok) {
      toast.error(data.error ?? 'Não foi possível alterar o plano')
      return
    }

    /* 3D Secure: o banco pediu autenticação extra. A troca só
       vale depois que o cliente concluir na página do Stripe. */
    if (data.acaoNecessaria) {
      toast.info('Seu banco pediu confirmação. Abrindo a página segura...')
      window.location.href = data.acaoNecessaria
      return
    }

    toast.success(`Plano alterado para ${PLANS.find(p => p.id === alvo)?.name}!`)
    setAlvo(null)
    setPreview(null)
    await refreshAuth()
  }

  /* ── Já está no topo ── */
  if (superiores.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-5 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <p className="font-bold text-amber-900">
            Você está no {planoAtual.name}, nosso plano mais completo
          </p>
          <p className="text-sm text-amber-700 mt-0.5">
            Todos os recursos já estão liberados. Para reduzir o plano ou
            ajustar a cobrança, fale com o suporte.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-900">Fazer upgrade</p>
        <p className="text-xs text-gray-500">
          A troca é imediata e você paga só a diferença proporcional do
          período restante.
        </p>
      </div>

      <div className={`grid gap-3 ${superiores.length === 1 ? '' : 'md:grid-cols-2'}`}>
        {superiores.map(p => {
          const dif = p.price - planoAtual.price
          return (
            <div key={p.id}
              className="p-4 border-2 border-gray-200 rounded-2xl hover:border-blue-300 transition-colors bg-white">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="font-bold text-gray-900">{p.name}</p>
                {p.badge && (
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    {p.badge}
                  </span>
                )}
              </div>

              <p className="text-2xl font-black text-gray-900">
                {money(p.price)}
                <span className="text-xs font-normal text-gray-400">/mês</span>
              </p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                +{money(dif)} sobre o {planoAtual.name}
              </p>

              {/* Só o que ele GANHA — a lista completa ele já conhece */}
              <ul className="mt-3 space-y-1">
                {p.features
                  .filter(f => !planoAtual.features.includes(f))
                  .slice(0, 4)
                  .map(f => (
                    <li key={f} className="flex items-start gap-1.5 text-xs text-gray-600">
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
              </ul>

              <Button
                className="w-full mt-4 gap-1.5"
                disabled={carregando && alvo === p.id}
                onClick={() => abrirPreview(p.id)}>
                {carregando && alvo === p.id
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Calculando...</>
                  : <><ArrowUpCircle className="w-4 h-4" />Migrar para o {p.name}</>}
              </Button>
            </div>
          )
        })}
      </div>

      {/* ── Confirmação com o valor exato ── */}
      {preview && alvo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !confirmando && (setPreview(null), setAlvo(null))}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4"
            onClick={e => e.stopPropagation()}>

            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-bold text-gray-900">Confirmar upgrade</p>
                <p className="text-sm text-gray-500">
                  {planoAtual.name} → {PLANS.find(p => p.id === alvo)?.name}
                </p>
              </div>
              <button onClick={() => { setPreview(null); setAlvo(null) }}
                disabled={confirmando}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-xl border border-gray-200 divide-y divide-gray-100">
              {preview.creditoProporcional < 0 && (
                <div className="flex justify-between px-4 py-2.5 text-sm">
                  <span className="text-gray-600">Crédito do período não usado</span>
                  <span className="font-semibold text-emerald-600">
                    {money(preview.creditoProporcional)}
                  </span>
                </div>
              )}
              <div className="flex justify-between px-4 py-3 bg-gray-50">
                <span className="font-bold text-gray-900">Cobrança agora</span>
                <span className="font-black text-lg text-gray-900">
                  {money(preview.cobrancaAgora)}
                </span>
              </div>
            </div>

            <div className="flex gap-2 p-3 rounded-xl bg-blue-50 border border-blue-100">
              <ShieldCheck className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-800 leading-relaxed">
                Cobramos no mesmo cartão já cadastrado — você não precisa
                digitar nada de novo.
                {preview.proximoCiclo && (
                  <> A partir de{' '}
                  <strong>
                    {new Date(preview.proximoCiclo).toLocaleDateString('pt-BR')}
                  </strong>
                  {' '}o valor passa a ser{' '}
                  {money(PLANS.find(p => p.id === alvo)?.price ?? 0)}/mês.</>
                )}
              </p>
            </div>

            {preview.cobrancaAgora === 0 && (
              <div className="flex gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800">
                  Nada será cobrado agora — o crédito do plano atual cobre
                  a diferença deste período.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1"
                disabled={confirmando}
                onClick={() => { setPreview(null); setAlvo(null) }}>
                Cancelar
              </Button>
              <Button className="flex-1 gap-1.5" disabled={confirmando} onClick={confirmar}>
                {confirmando
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Processando...</>
                  : <><CreditCard className="w-4 h-4" />Confirmar</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
