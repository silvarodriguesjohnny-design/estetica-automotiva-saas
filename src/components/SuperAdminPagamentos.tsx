import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import {
  Landmark, RefreshCw, Search, ExternalLink, AlertTriangle,
  CheckCircle2, PowerOff, Clock, Link2Off, Copy, TrendingUp,
} from 'lucide-react'
import { toast } from 'sonner'

/* ══════════════════════════════════════════════════════════════
   Recebimentos — visão consolidada da plataforma

   Modelo híbrido: o dinheiro da venda vai DIRETO para a conta
   Connect da estética (destination charge). Você nunca segura o
   valor dela — o que te mantém fora do papel de intermediário
   financeiro e da obrigação fiscal de faturar receita que não é sua.

   O que aparece aqui é espelho de leitura, vindo da API do Stripe:
   quem já está apto a receber, para qual banco vai, e quanto a
   plataforma já reteve de comissão. Nada aqui é editável — se
   estivesse, seria um vetor de fraude interna óbvio.
   ══════════════════════════════════════════════════════════════ */

type Situacao = 'recebendo' | 'pronto_desligado' | 'cadastro_incompleto' | 'nao_conectado'

interface Row {
  tenant_id: string
  tenant_name: string
  plan_type: string | null
  online_payments_enabled: boolean
  stripe_account_id: string | null
  stripe_account_status: string | null
  stripe_charges_enabled: boolean
  stripe_payouts_enabled: boolean
  bank_name: string | null
  bank_last4: string | null
  bank_holder_name: string | null
  bank_synced_at: string | null
  commission_pct: number
  paid_transactions: number
  gross_volume: number
  platform_revenue: number
  tenant_revenue: number
  last_sale_at: string | null
  situacao: Situacao
}

const money = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const SITUACAO: Record<Situacao, {
  label: string; hint: string; cls: string; Icon: typeof CheckCircle2
}> = {
  recebendo: {
    label: 'Recebendo',
    hint: 'Conta apta e pagamento online ligado na agenda pública',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Icon: CheckCircle2,
  },
  pronto_desligado: {
    label: 'Pronto, desligado',
    hint: 'A conta pode receber, mas a estética não ativou o pagamento online',
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
    Icon: PowerOff,
  },
  cadastro_incompleto: {
    label: 'Cadastro pendente',
    hint: 'Começou o onboarding no Stripe mas faltam documentos ou dados bancários',
    cls: 'bg-orange-50 text-orange-700 border-orange-200',
    Icon: Clock,
  },
  nao_conectado: {
    label: 'Sem conta',
    hint: 'Nunca iniciou a conexão com o Stripe',
    cls: 'bg-gray-50 text-gray-500 border-gray-200',
    Icon: Link2Off,
  },
}

export default function SuperAdminPagamentos() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<'todos' | Situacao>('todos')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('tenant_payment_overview')
      .select('*')
      .order('platform_revenue', { ascending: false })

    if (error) {
      /* Erro mais comum aqui: a migration 20260820 ainda não rodou. */
      toast.error(
        error.message.includes('does not exist')
          ? 'A view tenant_payment_overview ainda não existe. Rode a migration 20260820_fix_blockers.sql.'
          : error.message,
      )
      setRows([])
    } else {
      setRows((data ?? []) as Row[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return rows.filter(r =>
      (filtro === 'todos' || r.situacao === filtro) &&
      (!q || r.tenant_name?.toLowerCase().includes(q) ||
        (r.bank_name ?? '').toLowerCase().includes(q)),
    )
  }, [rows, busca, filtro])

  const totais = useMemo(() => ({
    bruto: rows.reduce((a, r) => a + Number(r.gross_volume || 0), 0),
    plataforma: rows.reduce((a, r) => a + Number(r.platform_revenue || 0), 0),
    transacoes: rows.reduce((a, r) => a + Number(r.paid_transactions || 0), 0),
    recebendo: rows.filter(r => r.situacao === 'recebendo').length,
  }), [rows])

  const contagem = (s: Situacao) => rows.filter(r => r.situacao === s).length

  return (
    <div className="space-y-5">

      {/* ── Números da plataforma ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Volume transacionado', value: money(totais.bruto), hint: 'Passou pelas agendas públicas', Icon: TrendingUp, cls: 'text-blue-600 bg-blue-50' },
          { label: 'Comissão da plataforma', value: money(totais.plataforma), hint: 'Retida automaticamente pelo Stripe', Icon: Landmark, cls: 'text-emerald-600 bg-emerald-50' },
          { label: 'Transações pagas', value: String(totais.transacoes), hint: 'Pagamentos confirmados', Icon: CheckCircle2, cls: 'text-purple-600 bg-purple-50' },
          { label: 'Estéticas recebendo', value: `${totais.recebendo}/${rows.length}`, hint: 'Aptas e com a opção ligada', Icon: Landmark, cls: 'text-amber-600 bg-amber-50' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2.5 ${c.cls}`}>
              <c.Icon className="w-4 h-4" />
            </div>
            <p className="text-xl font-bold text-gray-900 leading-tight">{c.value}</p>
            <p className="text-xs font-medium text-gray-600 mt-1">{c.label}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{c.hint}</p>
          </div>
        ))}
      </div>

      {/* ── Filtros ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por estética ou banco..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
            />
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => setFiltro('todos')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              filtro === 'todos' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            Todas ({rows.length})
          </button>
          {(Object.keys(SITUACAO) as Situacao[]).map(s => (
            <button key={s} onClick={() => setFiltro(s)} title={SITUACAO[s].hint}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                filtro === s ? 'bg-gray-900 text-white border-gray-900' : `${SITUACAO[s].cls} hover:opacity-80`}`}>
              {SITUACAO[s].label} ({contagem(s)})
            </button>
          ))}
        </div>
      </div>

      {/* ── Aviso de dado bancário ── */}
      <div className="flex gap-2.5 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
        <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-600 leading-relaxed">
          Os dados bancários abaixo são <strong>espelho de leitura da API do Stripe</strong> e
          sincronizam quando a estética abre a aba Pagamentos. O número completo da conta nunca
          é armazenado aqui — só os 4 últimos dígitos. Para alterar qualquer dado bancário,
          use o painel do Stripe.
        </p>
      </div>

      {/* ── Tabela ── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-semibold">Estética</th>
                <th className="px-4 py-3 font-semibold">Situação</th>
                <th className="px-4 py-3 font-semibold">Conta bancária</th>
                <th className="px-4 py-3 font-semibold text-right">Volume</th>
                <th className="px-4 py-3 font-semibold text-right">Sua comissão</th>
                <th className="px-4 py-3 font-semibold text-right">Stripe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  Carregando...
                </td></tr>
              )}

              {!loading && visiveis.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  Nenhuma estética neste filtro.
                </td></tr>
              )}

              {!loading && visiveis.map(r => {
                const st = SITUACAO[r.situacao] ?? SITUACAO.nao_conectado
                return (
                  <tr key={r.tenant_id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{r.tenant_name}</p>
                      <p className="text-[11px] text-gray-400 uppercase">
                        {r.plan_type ?? '—'} · {Number(r.commission_pct).toFixed(1)}% de comissão
                      </p>
                    </td>

                    <td className="px-4 py-3">
                      <span title={st.hint}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${st.cls}`}>
                        <st.Icon className="w-3 h-3" />{st.label}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      {r.bank_last4 ? (
                        <div>
                          <p className="font-medium text-gray-800">
                            {r.bank_name ?? 'Banco'} ····{r.bank_last4}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            {r.bank_holder_name ?? 'Titular não informado'}
                            {r.bank_synced_at && ` · sync ${new Date(r.bank_synced_at).toLocaleDateString('pt-BR')}`}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">Não informada</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <p className="font-semibold text-gray-900">{money(Number(r.gross_volume || 0))}</p>
                      <p className="text-[11px] text-gray-400">
                        {r.paid_transactions || 0} venda{Number(r.paid_transactions) === 1 ? '' : 's'}
                      </p>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <p className="font-bold text-emerald-600">{money(Number(r.platform_revenue || 0))}</p>
                      <p className="text-[11px] text-gray-400">
                        estética: {money(Number(r.tenant_revenue || 0))}
                      </p>
                    </td>

                    <td className="px-4 py-3 text-right">
                      {r.stripe_account_id ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            title="Copiar ID da conta Connect"
                            onClick={() => {
                              navigator.clipboard.writeText(r.stripe_account_id!)
                              toast.success('ID copiado')
                            }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <a
                            href={`https://dashboard.stripe.com/connect/accounts/${r.stripe_account_id}`}
                            target="_blank" rel="noopener noreferrer"
                            title="Abrir no Stripe"
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-600">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
