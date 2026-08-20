import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import {
  MessageCircle, CheckCircle2, AlertTriangle, Loader2, RefreshCw,
  Smartphone, QrCode, Unplug, ShieldCheck, Info, Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ══════════════════════════════════════════════════════════════
   Componente de autoatendimento do WhatsApp.

   O dono da estética conecta o próprio número sem depender de
   ninguém: o sistema provisiona a instância, mostra o QR, detecta
   a conexão e avisa quando cai.
   ══════════════════════════════════════════════════════════════ */

type Status =
  | 'loading' | 'not_provisioned' | 'provisioning'
  | 'qr_pending' | 'connected' | 'disconnected' | 'error'

interface StatusResponse {
  status: Status
  instance?: string
  qrCode?: string | null
  qrExpiresAt?: string | null
  connectedNumber?: string | null
  connectedAt?: string | null
  lastError?: string | null
  retryCount?: number
  message?: string
  error?: string
}

const POLL_MS = 3000

function callFn(name: string, body: Record<string, unknown>, token: string) {
  return fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(body),
  }).then(r => r.json())
}

function formatNumber(n?: string | null) {
  if (!n) return null
  const d = n.replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return n
}

export default function WhatsAppConnect() {
  const [state, setState] = useState<StatusResponse>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const pollRef = useRef<number | null>(null)
  const tokenRef = useRef<string>('')

  /* ── token de sessão ── */
  const getToken = useCallback(async () => {
    if (tokenRef.current) return tokenRef.current
    const { data } = await supabase.auth.getSession()
    tokenRef.current = data.session?.access_token ?? ''
    return tokenRef.current
  }, [])

  /* ── consulta de status ── */
  const fetchStatus = useCallback(async (action = 'status') => {
    const token = await getToken()
    if (!token) return
    try {
      const res: StatusResponse = await callFn('whatsapp-status', { action }, token)
      if (res.error) { setState({ status: 'error', lastError: res.error }); return }
      setState(res)
      if (res.qrExpiresAt) {
        const secs = Math.max(0, Math.floor((new Date(res.qrExpiresAt).getTime() - Date.now()) / 1000))
        setCountdown(secs)
      }
    } catch {
      setState(s => ({ ...s, status: s.status === 'loading' ? 'error' : s.status }))
    }
  }, [getToken])

  /* ── polling enquanto aguarda o scan ── */
  useEffect(() => {
    fetchStatus()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchStatus])

  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    // Só faz polling nos estados transitórios
    if (['qr_pending', 'provisioning'].includes(state.status)) {
      pollRef.current = window.setInterval(() => fetchStatus(), POLL_MS)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [state.status, fetchStatus])

  /* ── contador de expiração do QR ── */
  useEffect(() => {
    if (state.status !== 'qr_pending' || countdown <= 0) return
    const t = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown, state.status])

  // QR expirou → pede um novo automaticamente
  useEffect(() => {
    if (state.status === 'qr_pending' && countdown === 0 && state.qrExpiresAt) {
      fetchStatus('refresh_qr')
    }
  }, [countdown, state.status, state.qrExpiresAt, fetchStatus])

  /* ── ações ── */
  const provision = async (force = false) => {
    setBusy(true)
    setState({ status: 'provisioning' })
    const token = await getToken()
    try {
      const res = await callFn('provision-whatsapp', { force }, token)
      if (res.error) {
        toast.error(res.error)
        setState({ status: 'error', lastError: res.detail ?? res.error })
      } else {
        toast.success(res.status === 'connected' ? 'WhatsApp já estava conectado!' : 'Escaneie o QR Code')
        await fetchStatus()
      }
    } catch {
      toast.error('Não foi possível provisionar agora')
      setState({ status: 'error' })
    } finally { setBusy(false) }
  }

  const disconnect = async () => {
    if (!confirm('Desconectar o WhatsApp? As confirmações passarão a sair pelo número geral do sistema.')) return
    setBusy(true)
    const token = await getToken()
    await callFn('whatsapp-status', { action: 'disconnect' }, token)
    toast.success('WhatsApp desconectado')
    await fetchStatus()
    setBusy(false)
  }

  const removeInstance = async () => {
    if (!confirm('Remover completamente a instância? Você precisará escanear o QR de novo para reconectar.')) return
    setBusy(true)
    const token = await getToken()
    await callFn('whatsapp-status', { action: 'delete' }, token)
    toast.success('Instância removida')
    await fetchStatus()
    setBusy(false)
  }

  /* ══════════════════════════════════════════════════════════ */

  return (
    <div className="space-y-5">
      {/* ── Cabeçalho de status ── */}
      <StatusBanner state={state} />

      {/* ══ CONECTADO ══ */}
      {state.status === 'connected' && (
        <div className="rounded-2xl border-2 border-green-200 bg-green-50/50 p-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-2xl flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-green-900">WhatsApp conectado</p>
              <p className="text-sm text-green-700 mt-0.5">
                As confirmações de agendamento saem do seu próprio número.
              </p>
              {state.connectedNumber && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-mono font-bold text-green-800 bg-white px-3 py-1.5 rounded-lg border border-green-200">
                  <Smartphone className="w-3.5 h-3.5" />
                  {formatNumber(state.connectedNumber)}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <Button size="sm" variant="outline" onClick={() => fetchStatus()} disabled={busy}
              className="gap-1.5 border-green-300 text-green-700 hover:bg-green-100">
              <RefreshCw className="w-3.5 h-3.5" />Verificar
            </Button>
            <Button size="sm" variant="outline" onClick={disconnect} disabled={busy}
              className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50">
              <Unplug className="w-3.5 h-3.5" />Desconectar
            </Button>
            <Button size="sm" variant="outline" onClick={removeInstance} disabled={busy}
              className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50 ml-auto">
              <Trash2 className="w-3.5 h-3.5" />Remover
            </Button>
          </div>
        </div>
      )}

      {/* ══ QR PENDENTE ══ */}
      {state.status === 'qr_pending' && (
        <div className="rounded-2xl border-2 border-blue-200 bg-white p-5">
          <div className="grid md:grid-cols-2 gap-6 items-center">
            {/* QR */}
            <div className="flex flex-col items-center">
              <div className="relative p-3 bg-white rounded-2xl border-2 border-gray-100 shadow-sm">
                {state.qrCode ? (
                  <img
                    src={state.qrCode.startsWith('data:') ? state.qrCode : `data:image/png;base64,${state.qrCode}`}
                    alt="QR Code do WhatsApp"
                    className="w-56 h-56 object-contain"
                  />
                ) : (
                  <div className="w-56 h-56 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                  </div>
                )}
                {countdown <= 5 && countdown > 0 && (
                  <div className="absolute inset-0 bg-white/80 rounded-2xl flex items-center justify-center">
                    <p className="text-sm font-bold text-gray-600">Renovando…</p>
                  </div>
                )}
              </div>

              {/* Contador */}
              <div className="mt-3 flex items-center gap-2">
                <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all duration-1000',
                    countdown > 20 ? 'bg-green-500' : countdown > 10 ? 'bg-amber-500' : 'bg-red-500')}
                    style={{ width: `${Math.min(100, (countdown / 60) * 100)}%` }} />
                </div>
                <span className="text-xs text-gray-400 tabular-nums">
                  {countdown > 0 ? `expira em ${countdown}s` : 'renovando…'}
                </span>
              </div>

              <Button size="sm" variant="ghost" onClick={() => fetchStatus('refresh_qr')} disabled={busy}
                className="mt-2 gap-1.5 text-xs text-gray-500">
                <RefreshCw className="w-3 h-3" />Gerar novo QR
              </Button>
            </div>

            {/* Instruções */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <QrCode className="w-5 h-5 text-blue-600" />
                <p className="font-bold text-gray-900">Conecte seu WhatsApp</p>
              </div>
              <ol className="space-y-3">
                {[
                  'Abra o WhatsApp no celular da estética',
                  'Toque em ⋮ (Android) ou Ajustes (iPhone)',
                  'Escolha "Aparelhos conectados"',
                  'Toque em "Conectar aparelho"',
                  'Aponte a câmera para o QR ao lado',
                ].map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-gray-600 pt-0.5">{s}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex items-center gap-2 text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                Detectamos a conexão automaticamente
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ NÃO PROVISIONADO ══ */}
      {state.status === 'not_provisioned' && (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <MessageCircle className="w-8 h-8 text-green-600" />
          </div>
          <p className="font-bold text-gray-900">Conecte seu WhatsApp</p>
          <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">
            Enquanto não conectar, as confirmações saem pelo número geral do sistema —
            mas seus clientes não conseguem responder para você.
          </p>
          <Button onClick={() => provision()} disabled={busy}
            className="mt-5 gap-2 bg-green-600 hover:bg-green-700 text-white">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
            {busy ? 'Preparando…' : 'Conectar meu número'}
          </Button>
        </div>
      )}

      {/* ══ PROVISIONANDO ══ */}
      {state.status === 'provisioning' && (
        <div className="rounded-2xl border-2 border-blue-100 bg-blue-50/50 p-8 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="font-bold text-blue-900">Preparando sua conexão…</p>
          <p className="text-sm text-blue-700 mt-1">Isso leva alguns segundos.</p>
        </div>
      )}

      {/* ══ DESCONECTADO ══ */}
      {state.status === 'disconnected' && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center shrink-0">
              <AlertTriangle className="w-6 h-6 text-amber-600" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-amber-900">WhatsApp desconectado</p>
              <p className="text-sm text-amber-700 mt-0.5">
                Pode ter sido o celular desligado, sem internet, ou a sessão removida no aparelho.
                As confirmações estão saindo pelo número geral do sistema.
              </p>
              {state.disconnectedAt && (
                <p className="text-xs text-amber-600 mt-1.5">
                  Desde {new Date(state.disconnectedAt).toLocaleString('pt-BR')}
                </p>
              )}
            </div>
          </div>
          <Button onClick={() => provision(true)} disabled={busy}
            className="mt-4 w-full gap-2 bg-amber-600 hover:bg-amber-700 text-white">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Reconectar agora
          </Button>
        </div>
      )}

      {/* ══ ERRO ══ */}
      {state.status === 'error' && (
        <div className="rounded-2xl border-2 border-red-200 bg-red-50/50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-red-900">Não conseguimos conectar</p>
              {state.lastError && (
                <p className="text-xs text-red-700 mt-1 font-mono bg-white p-2 rounded border border-red-100 break-all">
                  {state.lastError}
                </p>
              )}
              <p className="text-sm text-red-700 mt-2">
                Seus agendamentos continuam funcionando normalmente — só a confirmação
                sai pelo número geral.
              </p>
            </div>
          </div>
          <Button onClick={() => provision(true)} disabled={busy}
            className="mt-4 w-full gap-2" variant="outline">
            <RefreshCw className="w-4 h-4" />Tentar novamente
          </Button>
        </div>
      )}

      {/* ══ CARREGANDO ══ */}
      {state.status === 'loading' && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-300" />
        </div>
      )}

      {/* ── Rodapé explicativo ── */}
      <div className="flex gap-3 p-4 bg-gray-50 rounded-xl text-xs text-gray-500">
        <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
        <div className="space-y-1">
          <p>
            <strong className="text-gray-700">Como funciona:</strong> criamos uma conexão dedicada
            para a sua estética. Seus clientes recebem as confirmações do seu número e podem
            responder direto para você.
          </p>
          <p>
            O celular precisa ficar ligado e com internet — é o mesmo funcionamento do
            WhatsApp Web.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ── Faixa de status no topo ── */
function StatusBanner({ state }: { state: StatusResponse }) {
  const map: Record<string, { label: string; cls: string; dot: string }> = {
    loading:         { label: 'Carregando…',     cls: 'bg-gray-100 text-gray-500',    dot: 'bg-gray-400' },
    not_provisioned: { label: 'Não conectado',   cls: 'bg-gray-100 text-gray-600',    dot: 'bg-gray-400' },
    provisioning:    { label: 'Preparando',      cls: 'bg-blue-100 text-blue-700',    dot: 'bg-blue-500 animate-pulse' },
    qr_pending:      { label: 'Aguardando scan', cls: 'bg-blue-100 text-blue-700',    dot: 'bg-blue-500 animate-pulse' },
    connected:       { label: 'Conectado',       cls: 'bg-green-100 text-green-700',  dot: 'bg-green-500' },
    disconnected:    { label: 'Desconectado',    cls: 'bg-amber-100 text-amber-700',  dot: 'bg-amber-500' },
    error:           { label: 'Erro',            cls: 'bg-red-100 text-red-700',      dot: 'bg-red-500' },
  }
  const s = map[state.status] ?? map.loading
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <MessageCircle className="w-5 h-5 text-green-600" />
        <h3 className="font-bold text-foreground">WhatsApp da estética</h3>
      </div>
      <span className={cn('flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold', s.cls)}>
        <span className={cn('w-1.5 h-1.5 rounded-full', s.dot)} />
        {s.label}
      </span>
    </div>
  )
}
