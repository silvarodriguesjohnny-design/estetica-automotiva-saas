import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Calendar as CalendarIcon, Clock, Car, User, Phone, ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, PlayCircle, Globe, Repeat, DollarSign, List, LayoutGrid,
  MessageCircle, AlertCircle, Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ══════════════════════════════════════════════════════════════ */

interface Booking {
  id: string
  order_number: number
  status: string
  start_time: string
  total_amount: number
  payment_status: string
  source: string | null
  customer_notes: string | null
  subscription_plan_id: string | null
  customer: { id: string; name: string; phone: string | null } | null
  vehicle: { brand: string; model: string; plate: string | null; color: string | null } | null
  plan: { name: string; interval: string } | null
}

const STATUS = {
  pending:     { label: 'Aguardando',   cls: 'bg-amber-100 text-amber-700 border-amber-200',  dot: 'bg-amber-500' },
  confirmed:   { label: 'Confirmado',   cls: 'bg-blue-100 text-blue-700 border-blue-200',     dot: 'bg-blue-500' },
  in_progress: { label: 'Em andamento', cls: 'bg-purple-100 text-purple-700 border-purple-200', dot: 'bg-purple-500' },
  completed:   { label: 'Concluído',    cls: 'bg-green-100 text-green-700 border-green-200',  dot: 'bg-green-500' },
  cancelled:   { label: 'Cancelado',    cls: 'bg-gray-100 text-gray-500 border-gray-200',     dot: 'bg-gray-400' },
} as const

type StatusKey = keyof typeof STATUS

const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const iso = (d: Date) => d.toISOString().slice(0, 10)
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/* ══════════════════════════════════════════════════════════════ */

export default function Agenda() {
  const { tenant } = useAuth()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'list' | 'week'>('list')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [anchor, setAnchor] = useState(new Date())
  const [detail, setDetail] = useState<Booking | null>(null)

  /* ── range da semana atual ── */
  const weekStart = (() => {
    const d = new Date(anchor); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d
  })()
  const weekEnd = (() => {
    const d = new Date(weekStart); d.setDate(d.getDate() + 7); return d
  })()

  const load = useCallback(async () => {
    if (!tenant) return
    setLoading(true)
    const { data } = await supabase
      .from('service_orders')
      .select(`
        id, order_number, status, start_time, total_amount, payment_status,
        source, customer_notes, subscription_plan_id,
        customer:customers(id, name, phone),
        vehicle:vehicles(brand, model, plate, color),
        plan:subscription_plans(name, interval)
      `)
      .eq('tenant_id', tenant.id)
      .gte('start_time', new Date(Date.now() - 30 * 86400000).toISOString())
      .order('start_time', { ascending: true })
    setBookings((data as unknown as Booking[]) ?? [])
    setLoading(false)
  }, [tenant])

  useEffect(() => { load() }, [load])

  /* ── ações ── */
  async function updateStatus(b: Booking, status: StatusKey) {
    const { error } = await supabase.from('service_orders').update({ status }).eq('id', b.id)
    if (error) { toast.error('Erro ao atualizar'); return }
    toast.success(`Agendamento ${STATUS[status].label.toLowerCase()}`)
    setDetail(null)
    load()
  }

  /* ── filtros ── */
  const filtered = bookings.filter(b => {
    const st = statusFilter === 'all' ? true
      : statusFilter === 'active' ? ['pending', 'confirmed', 'in_progress'].includes(b.status)
      : b.status === statusFilter
    const sr = sourceFilter === 'all' ? true
      : sourceFilter === 'public' ? b.source === 'public_booking'
      : b.source !== 'public_booking'
    return st && sr
  })

  /* ── KPIs ── */
  const today = iso(new Date())
  const todayCount = bookings.filter(b => b.start_time.slice(0, 10) === today && b.status !== 'cancelled').length
  const pendingCount = bookings.filter(b => b.status === 'pending').length
  const fromPublic = bookings.filter(b => b.source === 'public_booking').length
  const weekRevenue = bookings
    .filter(b => {
      const d = new Date(b.start_time)
      return d >= weekStart && d < weekEnd && b.status !== 'cancelled'
    })
    .reduce((s, b) => s + (b.total_amount ?? 0), 0)

  /* ── agrupamento por dia (lista) ── */
  const grouped = filtered.reduce<Record<string, Booking[]>>((acc, b) => {
    const day = b.start_time.slice(0, 10)
    ;(acc[day] ??= []).push(b)
    return acc
  }, {})

  /* ── dias da semana (visão semanal) ── */
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i); return d
  })

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Agenda</h1>
          <p className="text-sm text-muted-foreground">Agendamentos recebidos pela agenda pública e internos</p>
        </div>
        <div className="flex gap-1 p-1 bg-muted rounded-xl">
          {([['list', List, 'Lista'], ['week', LayoutGrid, 'Semana']] as const).map(([k, Icon, label]) => (
            <button key={k} onClick={() => setView(k)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                view === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Kpi icon={CalendarIcon} label="Hoje" value={todayCount} color="text-blue-600" bg="bg-blue-50" />
        <Kpi icon={AlertCircle} label="Aguardando confirmação" value={pendingCount} color="text-amber-600" bg="bg-amber-50"
          highlight={pendingCount > 0} />
        <Kpi icon={Globe} label="Via agenda pública" value={fromPublic} color="text-purple-600" bg="bg-purple-50" />
        <div className="bg-card rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">Receita da semana</p>
          <p className="text-xl font-bold text-green-600 mt-1">{money(weekRevenue)}</p>
        </div>
      </div>

      {/* ── Alerta de pendentes ── */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800 flex-1">
            <strong>{pendingCount} agendamento{pendingCount > 1 ? 's' : ''}</strong> aguardando sua confirmação.
          </p>
          <Button size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-100"
            onClick={() => setStatusFilter('pending')}>
            Ver pendentes
          </Button>
        </div>
      )}

      {/* ── Filtros ── */}
      <div className="flex flex-wrap gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Ativos (não concluídos)</SelectItem>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="pending">🟡 Aguardando</SelectItem>
            <SelectItem value="confirmed">🔵 Confirmados</SelectItem>
            <SelectItem value="in_progress">🟣 Em andamento</SelectItem>
            <SelectItem value="completed">🟢 Concluídos</SelectItem>
            <SelectItem value="cancelled">⚪ Cancelados</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as origens</SelectItem>
            <SelectItem value="public">🌐 Agenda pública</SelectItem>
            <SelectItem value="internal">🏪 Cadastro interno</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ══ VISÃO LISTA ══ */}
      {view === 'list' && (
        loading ? <Skeletons /> :
        Object.keys(grouped).length === 0 ? (
          <Empty />
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([day, list]) => {
              const d = new Date(`${day}T12:00:00`)
              const isToday = day === today
              return (
                <div key={day}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={cn('px-3 py-1 rounded-lg text-sm font-bold',
                      isToday ? 'bg-blue-600 text-white' : 'bg-muted text-foreground')}>
                      {isToday ? 'Hoje' : `${WEEKDAYS[d.getDay()]}, ${day.split('-').reverse().slice(0, 2).join('/')}`}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {list.length} agendamento{list.length > 1 ? 's' : ''}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <div className="space-y-2">
                    {list.map(b => <BookingRow key={b.id} b={b} onClick={() => setDetail(b)} />)}
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* ══ VISÃO SEMANA ══ */}
      {view === 'week' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <Button variant="outline" size="sm" className="gap-1"
              onClick={() => setAnchor(new Date(anchor.getTime() - 7 * 86400000))}>
              <ChevronLeft className="w-4 h-4" />Anterior
            </Button>
            <p className="font-semibold text-sm">
              {weekStart.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
              {' — '}
              {new Date(weekEnd.getTime() - 86400000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
            </p>
            <Button variant="outline" size="sm" className="gap-1"
              onClick={() => setAnchor(new Date(anchor.getTime() + 7 * 86400000))}>
              Próxima<ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-2">
            {weekDays.map(d => {
              const key = iso(d)
              const dayList = filtered.filter(b => b.start_time.slice(0, 10) === key)
              const isToday = key === today
              return (
                <div key={key} className={cn('rounded-xl border p-2 min-h-[180px]',
                  isToday ? 'border-blue-400 bg-blue-50/40' : 'border-border bg-card')}>
                  <div className="text-center pb-2 mb-2 border-b border-border/60">
                    <p className="text-[10px] text-muted-foreground uppercase font-semibold">{WEEKDAYS[d.getDay()]}</p>
                    <p className={cn('text-lg font-bold', isToday && 'text-blue-600')}>{d.getDate()}</p>
                  </div>
                  <div className="space-y-1.5">
                    {dayList.length === 0 && <p className="text-[10px] text-muted-foreground/50 text-center py-3">livre</p>}
                    {dayList.map(b => {
                      const st = STATUS[b.status as StatusKey] ?? STATUS.pending
                      return (
                        <button key={b.id} onClick={() => setDetail(b)}
                          className={cn('w-full text-left p-1.5 rounded-lg border text-[11px] hover:shadow-sm transition-all', st.cls)}>
                          <p className="font-bold">{b.start_time.slice(11, 16)}</p>
                          <p className="truncate opacity-80">{b.customer?.name?.split(' ')[0]}</p>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ══ MODAL DETALHE ══ */}
      <Dialog open={!!detail} onOpenChange={() => setDetail(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-blue-600" />
              Agendamento #{detail?.order_number}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              {/* Status atual */}
              <div className="flex items-center gap-2">
                <span className={cn('px-3 py-1 rounded-full text-xs font-bold border',
                  (STATUS[detail.status as StatusKey] ?? STATUS.pending).cls)}>
                  {(STATUS[detail.status as StatusKey] ?? STATUS.pending).label}
                </span>
                {detail.source === 'public_booking' && (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700 flex items-center gap-1">
                    <Globe className="w-3 h-3" />Agenda pública
                  </span>
                )}
              </div>

              {/* Dados */}
              <div className="space-y-2.5 p-4 bg-muted rounded-xl text-sm">
                <Info icon={User}  label="Cliente" value={detail.customer?.name ?? '—'} />
                {detail.customer?.phone && <Info icon={Phone} label="Telefone" value={detail.customer.phone} />}
                <Info icon={Car} label="Veículo"
                  value={`${detail.vehicle?.brand ?? ''} ${detail.vehicle?.model ?? ''}${detail.vehicle?.plate ? ` · ${detail.vehicle.plate}` : ''}`.trim() || '—'} />
                <Info icon={Clock} label="Horário"
                  value={`${detail.start_time.slice(0, 10).split('-').reverse().join('/')} às ${detail.start_time.slice(11, 16)}`} />
                {detail.plan && (
                  <Info icon={Repeat} label="Assinatura" value={detail.plan.name} />
                )}
                <Info icon={DollarSign} label="Valor" value={money(detail.total_amount ?? 0)} />
              </div>

              {detail.customer_notes && (
                <div className="p-3 bg-blue-50 rounded-xl text-sm text-blue-800 flex gap-2">
                  <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />{detail.customer_notes}
                </div>
              )}

              {/* Ações */}
              <div className="grid grid-cols-2 gap-2">
                {detail.status === 'pending' && (
                  <Button className="col-span-2 gap-2 bg-blue-600 hover:bg-blue-700"
                    onClick={() => updateStatus(detail, 'confirmed')}>
                    <CheckCircle2 className="w-4 h-4" />Confirmar agendamento
                  </Button>
                )}
                {detail.status === 'confirmed' && (
                  <Button className="col-span-2 gap-2 bg-purple-600 hover:bg-purple-700"
                    onClick={() => updateStatus(detail, 'in_progress')}>
                    <PlayCircle className="w-4 h-4" />Iniciar atendimento
                  </Button>
                )}
                {detail.status === 'in_progress' && (
                  <Button className="col-span-2 gap-2 bg-green-600 hover:bg-green-700"
                    onClick={() => updateStatus(detail, 'completed')}>
                    <CheckCircle2 className="w-4 h-4" />Concluir
                  </Button>
                )}
                {detail.customer?.phone && (
                  <a href={`https://wa.me/55${detail.customer.phone.replace(/\D/g, '')}`}
                    target="_blank" rel="noopener noreferrer" className="col-span-2">
                    <Button variant="outline" className="w-full gap-2 border-green-200 text-green-700 hover:bg-green-50">
                      <MessageCircle className="w-4 h-4" />Chamar no WhatsApp
                    </Button>
                  </a>
                )}
                {detail.status !== 'cancelled' && detail.status !== 'completed' && (
                  <Button variant="outline" className="col-span-2 gap-2 border-red-200 text-red-600 hover:bg-red-50"
                    onClick={() => updateStatus(detail, 'cancelled')}>
                    <XCircle className="w-4 h-4" />Cancelar
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════ */

function Kpi({ icon: Icon, label, value, color, bg, highlight }: {
  icon: React.ElementType; label: string; value: number; color: string; bg: string; highlight?: boolean
}) {
  return (
    <div className={cn('bg-card rounded-xl border p-4 flex items-center gap-3', highlight && 'border-amber-300')}>
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', bg)}>
        <Icon className={cn('w-5 h-5', color)} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </div>
    </div>
  )
}

function BookingRow({ b, onClick }: { b: Booking; onClick: () => void }) {
  const st = STATUS[b.status as StatusKey] ?? STATUS.pending
  return (
    <button onClick={onClick}
      className="w-full bg-card rounded-xl border p-4 flex items-center gap-4 hover:border-blue-300 hover:shadow-sm transition-all text-left">
      {/* Hora */}
      <div className="text-center shrink-0 w-14">
        <p className="text-lg font-black text-foreground">{b.start_time.slice(11, 16)}</p>
        <div className={cn('w-2 h-2 rounded-full mx-auto mt-1', st.dot)} />
      </div>
      <div className="w-px h-10 bg-border shrink-0" />
      {/* Dados */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-bold text-foreground truncate">{b.customer?.name ?? 'Cliente'}</p>
          {b.source === 'public_booking' && <Globe className="w-3.5 h-3.5 text-purple-500 shrink-0" />}
          {b.plan && <Repeat className="w-3.5 h-3.5 text-purple-500 shrink-0" />}
        </div>
        <p className="text-sm text-muted-foreground truncate">
          {b.vehicle?.brand} {b.vehicle?.model}
          {b.vehicle?.plate && <span className="font-mono text-xs ml-1.5">{b.vehicle.plate}</span>}
        </p>
      </div>
      {/* Valor + status */}
      <div className="text-right shrink-0">
        <p className="font-bold text-foreground">{money(b.total_amount ?? 0)}</p>
        <Badge variant="outline" className={cn('text-[10px] mt-1', st.cls)}>{st.label}</Badge>
      </div>
    </button>
  )
}

function Info({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-semibold ml-auto text-right truncate">{value}</span>
    </div>
  )
}

function Skeletons() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}
    </div>
  )
}

function Empty() {
  return (
    <div className="text-center py-16 bg-card rounded-xl border">
      <CalendarIcon className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
      <p className="font-semibold text-muted-foreground">Nenhum agendamento neste filtro</p>
      <p className="text-sm text-muted-foreground/60 mt-1">
        Compartilhe o link da sua agenda pública para começar a receber agendamentos.
      </p>
    </div>
  )
}
