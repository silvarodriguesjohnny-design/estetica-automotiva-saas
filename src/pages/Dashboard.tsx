import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/lib/supabase/client'
import { useNavigate } from 'react-router-dom'
import {
  Car, ClipboardList, DollarSign, Users, TrendingUp, Clock,
  AlertTriangle, Send, TrendingDown, ChevronRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { format, subDays, startOfDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS, type ServiceOrderWithRelations } from '@/types'
import { cn } from '@/lib/utils'

const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6']

interface InactiveStats {
  count: number
  lostRevenue: number
  avgTicket: number
  withPhone: number
  monthlyLoss: number
}

export default function Dashboard() {
  const { tenant } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [inactiveDays, setInactiveDays] = useState(45)
  const [inactiveStats, setInactiveStats] = useState<InactiveStats>({
    count: 0, lostRevenue: 0, avgTicket: 0, withPhone: 0, monthlyLoss: 0,
  })
  const [metrics, setMetrics] = useState({
    totalRevenue: 0,
    ordensHoje: 0,
    ordensAbertas: 0,
    veiculosAtendidos: 0,
    ticketMedio: 0,
    clientesAtivos: 0,
  })
  const [revenueData, setRevenueData] = useState<{ day: string; receita: number }[]>([])
  const [categoryData, setCategoryData] = useState<{ name: string; value: number }[]>([])
  const [recentOrders, setRecentOrders] = useState<ServiceOrderWithRelations[]>([])

  const fetchInactiveStats = useCallback(async (days: number) => {
    if (!tenant) return
    const { data: customers } = await supabase
      .from('customers').select('id, phone').eq('tenant_id', tenant.id)
    const { data: orders } = await supabase
      .from('service_orders')
      .select('customer_id, total_amount, completed_at, created_at')
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')

    if (!customers) return
    const now = new Date()
    const lastVisitMap: Record<string, { date: string; tickets: number[] }> = {}
    customers.forEach(c => { lastVisitMap[c.id] = { date: '', tickets: [] } })
    orders?.forEach(o => {
      const date = o.completed_at || o.created_at
      const curr = lastVisitMap[o.customer_id]
      if (!curr) return
      if (!curr.date || date > curr.date) curr.date = date
      if (o.total_amount) curr.tickets.push(o.total_amount)
    })

    const inactive = customers.filter(c => {
      const d = lastVisitMap[c.id]
      if (!d?.date) return false
      return (now.getTime() - new Date(d.date).getTime()) / 86400000 >= days
    })

    const totalLost = inactive.reduce((s, c) => {
      const d = lastVisitMap[c.id]
      const avg = d?.tickets.length ? d.tickets.reduce((a, b) => a + b, 0) / d.tickets.length : 0
      return s + avg
    }, 0)

    // Projeção mensal: assume 1 visita/mês por cliente
    const monthlyLoss = totalLost

    setInactiveStats({
      count: inactive.length,
      lostRevenue: totalLost,
      avgTicket: inactive.length ? totalLost / inactive.length : 0,
      withPhone: inactive.filter(c => c.phone).length,
      monthlyLoss,
    })
  }, [tenant])

  const fetchDashboard = useCallback(async () => {
    if (!tenant) return
    try {
      setLoading(true)
      const today = startOfDay(new Date()).toISOString()
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString()

      const { count: ordensHoje } = await supabase
        .from('service_orders').select('*', { count: 'exact', head: true }).gte('start_time', today)

      const { count: ordensAbertas } = await supabase
        .from('service_orders').select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'confirmed', 'in_progress'])

      const { data: transactions } = await supabase
        .from('transactions').select('amount, created_at').eq('type', 'income').gte('created_at', thirtyDaysAgo)

      const totalRevenue = transactions?.reduce((sum, t) => sum + t.amount, 0) ?? 0

      const { count: veiculosAtendidos } = await supabase
        .from('service_orders').select('*', { count: 'exact', head: true })
        .eq('status', 'completed').gte('created_at', thirtyDaysAgo)

      const ticketMedio = veiculosAtendidos && veiculosAtendidos > 0 ? totalRevenue / veiculosAtendidos : 0

      const { count: clientesAtivos } = await supabase
        .from('customers').select('*', { count: 'exact', head: true })
        .gte('last_visit_at', subDays(new Date(), 60).toISOString())

      setMetrics({
        totalRevenue, ordensHoje: ordensHoje ?? 0, ordensAbertas: ordensAbertas ?? 0,
        veiculosAtendidos: veiculosAtendidos ?? 0, ticketMedio,
        clientesAtivos: clientesAtivos ?? 0,
      })

      // Gráfico receita 7 dias
      const last7 = Array.from({ length: 7 }, (_, i) => {
        const date = subDays(new Date(), 6 - i)
        return { day: format(date, 'EEE', { locale: ptBR }), date: format(date, 'yyyy-MM-dd'), receita: 0 }
      })
      transactions?.forEach((t) => {
        const day = t.created_at.slice(0, 10)
        const idx = last7.findIndex((d) => d.date === day)
        if (idx !== -1) last7[idx].receita += t.amount
      })
      setRevenueData(last7.map(({ day, receita }) => ({ day, receita })))

      // Por categoria
      const { data: items } = await supabase
        .from('service_order_items').select('name, price, service:services(category)').gte('created_at', thirtyDaysAgo)
      const catMap: Record<string, number> = {}
      items?.forEach((item: any) => { const cat = item.service?.category ?? 'outros'; catMap[cat] = (catMap[cat] ?? 0) + item.price })
      setCategoryData(Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, value]) => ({ name, value })))

      // OS recentes
      const { data: orders } = await supabase
        .from('service_orders')
        .select('*, customer:customers(id,name,phone), vehicle:vehicles(id,brand,model,plate,color), technician:technicians(id,name)')
        .order('created_at', { ascending: false }).limit(8)
      setRecentOrders((orders as ServiceOrderWithRelations[]) ?? [])
    } catch (err) {
      console.error('[Dashboard]', err)
    } finally {
      setLoading(false)
    }
  }, [tenant])

  useEffect(() => {
    if (!tenant) return
    fetchDashboard()
    fetchInactiveStats(inactiveDays)
  }, [tenant])

  const handleDaysChange = (val: string) => {
    const days = Number(val)
    setInactiveDays(days)
    fetchInactiveStats(days)
  }

  const metricCards = [
    { title: 'Receita (30 dias)', value: `R$ ${metrics.totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: DollarSign, color: 'text-green-600', bg: 'bg-green-50' },
    { title: 'OS Hoje', value: metrics.ordensHoje, icon: ClipboardList, color: 'text-blue-600', bg: 'bg-blue-50' },
    { title: 'OS em Aberto', value: metrics.ordensAbertas, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
    { title: 'Veículos Atendidos', value: metrics.veiculosAtendidos, icon: Car, color: 'text-purple-600', bg: 'bg-purple-50' },
    { title: 'Ticket Médio', value: `R$ ${metrics.ticketMedio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: TrendingUp, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { title: 'Clientes Ativos', value: metrics.clientesAtivos, icon: Users, color: 'text-teal-600', bg: 'bg-teal-50' },
  ]

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {metricCards.map(({ title, value, icon: Icon, color, bg }) => (
          <Card key={title}>
            <CardContent className="p-4">
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center mb-3', bg)}>
                <Icon className={cn('h-4 w-4', color)} />
              </div>
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{title}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── PAINEL RECEITA EM RISCO ── */}
      <Card className={cn(
        'border-2 overflow-hidden',
        inactiveStats.count > 0 ? 'border-orange-200 bg-gradient-to-br from-orange-50 to-red-50' : 'border-green-200 bg-green-50/30',
      )}>
        <CardContent className="p-0">
          {/* Cabeçalho do painel */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 pb-4 border-b border-orange-100">
            <div className="flex items-center gap-3">
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', inactiveStats.count > 0 ? 'bg-orange-100' : 'bg-green-100')}>
                {inactiveStats.count > 0
                  ? <TrendingDown className="h-5 w-5 text-orange-500" />
                  : <TrendingUp className="h-5 w-5 text-green-600" />}
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Receita em Risco — clientes inativos</h3>
                <p className="text-sm text-muted-foreground">Potencial não realizado baseado no ticket médio histórico</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Inativo há mais de</span>
              <Select value={String(inactiveDays)} onValueChange={handleDaysChange}>
                <SelectTrigger className="w-28 h-8 text-sm border-orange-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 dias</SelectItem>
                  <SelectItem value="45">45 dias</SelectItem>
                  <SelectItem value="60">60 dias</SelectItem>
                  <SelectItem value="90">90 dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {inactiveStats.count === 0 ? (
            <div className="p-5 flex items-center gap-3">
              <span className="text-2xl">🎉</span>
              <div>
                <p className="font-semibold text-green-800">Nenhum cliente inativo neste período!</p>
                <p className="text-sm text-green-700">Todos os clientes visitaram nos últimos {inactiveDays} dias.</p>
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-4">
              {/* Métricas */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white/70 rounded-xl p-3 border border-orange-100">
                  <p className="text-xs text-orange-600 font-medium">Clientes inativos</p>
                  <p className="text-3xl font-black text-orange-700 mt-1">{inactiveStats.count}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{inactiveStats.withPhone} com telefone</p>
                </div>
                <div className="bg-white/70 rounded-xl p-3 border border-orange-100">
                  <p className="text-xs text-orange-600 font-medium">Receita perdida</p>
                  <p className="text-2xl font-black text-orange-800 mt-1">
                    R$ {inactiveStats.lostRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">se viessem 1× neste período</p>
                </div>
                <div className="bg-white/70 rounded-xl p-3 border border-orange-100">
                  <p className="text-xs text-orange-600 font-medium">Projeção mensal</p>
                  <p className="text-2xl font-black text-red-700 mt-1">
                    R$ {inactiveStats.monthlyLoss.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">recorrência mensal perdida</p>
                </div>
                <div className="bg-white/70 rounded-xl p-3 border border-orange-100">
                  <p className="text-xs text-orange-600 font-medium">Ticket médio</p>
                  <p className="text-2xl font-black text-orange-800 mt-1">
                    R$ {inactiveStats.avgTicket.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">por cliente inativo</p>
                </div>
              </div>

              {/* Alerta + ações */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-orange-800">
                    <strong>{inactiveStats.count} clientes</strong> não voltaram há {inactiveDays}+ dias.{' '}
                    Uma campanha de reativação pode recuperar parte desse valor.
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm" variant="outline"
                    className="border-orange-300 text-orange-700 hover:bg-orange-100 gap-1.5 text-xs"
                    onClick={() => navigate('/financeiro')}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />Ver lista
                  </Button>
                  <Button
                    size="sm"
                    className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5 text-xs"
                    onClick={() => navigate('/campanhas')}
                  >
                    <Send className="w-3.5 h-3.5" />Criar campanha
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Receita — últimos 7 dias</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="colorReceita" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `R$${v}`} />
                <Tooltip formatter={(v: number) => [`R$ ${v.toFixed(2)}`, 'Receita']} />
                <Area type="monotone" dataKey="receita" stroke="#6366f1" strokeWidth={2} fill="url(#colorReceita)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Receita por categoria</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={categoryData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value">
                      {categoryData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => `R$ ${v.toFixed(2)}`} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-2">
                  {categoryData.map(({ name, value }, i) => (
                    <div key={name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="capitalize">{name}</span>
                      </div>
                      <span className="font-medium">R$ {value.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">Sem dados no período</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* OS Recentes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Ordens de Serviço Recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {recentOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhuma OS encontrada. Crie sua primeira ordem de serviço.
            </p>
          ) : (
            <div className="space-y-3">
              {recentOrders.map((order) => (
                <div key={order.id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                      <Car className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        {order.vehicle?.brand} {order.vehicle?.model}
                        {order.vehicle?.plate && <span className="ml-2 text-xs text-muted-foreground font-mono">{order.vehicle.plate}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{order.customer?.name} • OS #{order.order_number}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-semibold">R$ {order.total_amount.toFixed(2)}</span>
                    <Badge className={cn('text-xs', ORDER_STATUS_COLORS[order.status])}>
                      {ORDER_STATUS_LABELS[order.status]}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
