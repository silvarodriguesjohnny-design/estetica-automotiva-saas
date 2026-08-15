import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/lib/supabase/client'
import { Plus, TrendingUp, TrendingDown, DollarSign, Filter, UserX, Send, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { Transaction } from '@/types'
import { PAYMENT_METHODS } from '@/types'
import { cn } from '@/lib/utils'
import { sendWhatsAppMessage, sanitizePhone } from '@/lib/evolution/client'

const transactionSchema = z.object({
  type: z.enum(['income', 'expense']),
  amount: z.coerce.number().positive('Valor deve ser positivo'),
  description: z.string().min(1, 'Informe uma descrição'),
  category: z.string().optional(),
  payment_method: z.string().optional(),
})
type TransactionForm = z.infer<typeof transactionSchema>

const INCOME_CATEGORIES = ['servico', 'produto', 'taxa', 'outros']
const EXPENSE_CATEGORIES = ['produto', 'aluguel', 'salario', 'equipamento', 'marketing', 'energia', 'agua', 'outros']

interface InactiveClient {
  id: string; name: string; phone: string | null
  last_visit: string; avg_ticket: number; visits: number; days_inactive: number
}

export default function Financeiro() {
  const { tenant } = useAuth()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [period, setPeriod] = useState('month')
  const [summary, setSummary] = useState({ income: 0, expense: 0, balance: 0 })
  const [chartData, setChartData] = useState<{ day: string; receita: number; despesa: number }[]>([])
  const [inactiveClients, setInactiveClients] = useState<InactiveClient[]>([])
  const [lostRevenue, setLostRevenue] = useState(0)
  const [avgTicket, setAvgTicket] = useState(0)
  const [inactiveModalOpen, setInactiveModalOpen] = useState(false)
  const [bulkMessage, setBulkMessage] = useState(
    'Olá {nome}! 🚗 Sentimos sua falta! Seu veículo merece os melhores cuidados. Que tal agendar uma visita? Temos condições especiais esperando por você. 😊'
  )
  const [sendingBulk, setSendingBulk] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ sent: 0, total: 0, running: false })
  const [inactiveDays, setInactiveDays] = useState(45)

  const { register, handleSubmit, control, watch, reset, formState: { errors } } = useForm<TransactionForm>({
    resolver: zodResolver(transactionSchema),
    defaultValues: { type: 'income' },
  })
  const transactionType = watch('type')

  useEffect(() => { if (tenant) { fetchTransactions(); fetchInactiveClients(inactiveDays) } }, [tenant, period])

  const getDateRange = () => {
    const now = new Date()
    if (period === 'month') return { from: startOfMonth(now).toISOString(), to: endOfMonth(now).toISOString() }
    if (period === '7d') return { from: subDays(now, 7).toISOString(), to: now.toISOString() }
    if (period === '90d') return { from: subDays(now, 90).toISOString(), to: now.toISOString() }
    return { from: subDays(now, 30).toISOString(), to: now.toISOString() }
  }

  const fetchTransactions = async () => {
    setLoading(true)
    const { from, to } = getDateRange()
    const { data } = await supabase.from('transactions').select('*').gte('created_at', from).lte('created_at', to).order('created_at', { ascending: false })
    const list = (data as Transaction[]) ?? []
    setTransactions(list)
    const income = list.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
    const expense = list.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
    setSummary({ income, expense, balance: income - expense })
    const last7: Record<string, { receita: number; despesa: number }> = {}
    for (let i = 6; i >= 0; i--) { const d = format(subDays(new Date(), i), 'dd/MM'); last7[d] = { receita: 0, despesa: 0 } }
    list.forEach(t => { const d = format(new Date(t.created_at), 'dd/MM'); if (last7[d]) { if (t.type === 'income') last7[d].receita += t.amount; else last7[d].despesa += t.amount } })
    setChartData(Object.entries(last7).map(([day, v]) => ({ day, ...v })))
    setLoading(false)
  }

  const fetchInactiveClients = async (days: number) => {
    const { data: customers } = await supabase.from('customers').select('id, name, phone')
    if (!customers?.length) return
    const { data: orders } = await supabase.from('service_orders').select('customer_id, total_price, completed_at, created_at').eq('status', 'completed')
    const clientMap: Record<string, { lastVisit: string; tickets: number[]; name: string; phone: string | null }> = {}
    customers.forEach(c => { clientMap[c.id] = { lastVisit: '', tickets: [], name: c.name, phone: c.phone } })
    orders?.forEach(o => {
      const date = o.completed_at || o.created_at
      const curr = clientMap[o.customer_id]
      if (!curr) return
      if (!curr.lastVisit || date > curr.lastVisit) curr.lastVisit = date
      if (o.total_price) curr.tickets.push(o.total_price)
    })
    const now = new Date()
    const inactive: InactiveClient[] = []
    Object.entries(clientMap).forEach(([id, c]) => {
      if (!c.lastVisit && !c.tickets.length) return
      const lastDate = c.lastVisit ? new Date(c.lastVisit) : new Date(0)
      const daysInactive = Math.floor((now.getTime() - lastDate.getTime()) / 86400000)
      if (daysInactive >= days) {
        const avg = c.tickets.length ? c.tickets.reduce((s, v) => s + v, 0) / c.tickets.length : 0
        inactive.push({ id, name: c.name, phone: c.phone, last_visit: c.lastVisit, avg_ticket: avg, visits: c.tickets.length, days_inactive: daysInactive })
      }
    })
    inactive.sort((a, b) => b.days_inactive - a.days_inactive)
    setInactiveClients(inactive)
    const totalLost = inactive.reduce((s, c) => s + c.avg_ticket, 0)
    setLostRevenue(totalLost)
    setAvgTicket(inactive.length ? totalLost / inactive.length : 0)
  }

  const handleInactiveDaysChange = (days: number) => {
    setInactiveDays(days)
    fetchInactiveClients(days)
  }

  const onSubmit = async (data: TransactionForm) => {
    setSaving(true)
    try {
      const { error } = await supabase.from('transactions').insert({ tenant_id: tenant!.id, type: data.type, amount: data.amount, description: data.description, category: data.category || null, payment_method: data.payment_method || null })
      if (error) throw error
      toast.success('Lançamento registrado!')
      setModalOpen(false); reset(); fetchTransactions()
    } catch (err: any) { toast.error(err.message || 'Erro ao registrar lançamento') } finally { setSaving(false) }
  }

  const sendBulkMessage = async () => {
    const withPhone = inactiveClients.filter(c => c.phone)
    if (!withPhone.length) { toast.error('Nenhum cliente com telefone cadastrado'); return }
    const { data: config } = await supabase.from('messaging_configs').select('*').single()
    if (!config?.instance_name) { toast.error('Configure o WhatsApp primeiro em Mensagens'); return }
    setSendingBulk(true)
    setBulkProgress({ sent: 0, total: withPhone.length, running: true })
    let sent = 0
    for (const client of withPhone) {
      try {
        const msg = bulkMessage.replace(/{nome}/g, client.name.split(' ')[0]).replace(/{empresa}/g, tenant?.name ?? 'nossa empresa')
        await sendWhatsAppMessage(config.instance_name, sanitizePhone(client.phone!), msg)
        sent++
        setBulkProgress(p => ({ ...p, sent }))
        await new Promise(r => setTimeout(r, 1500))
      } catch { /* ignora */ }
    }
    setSendingBulk(false)
    setBulkProgress(p => ({ ...p, running: false }))
    toast.success(`✅ ${sent}/${withPhone.length} mensagens enviadas!`)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Financeiro</h1>
          <p className="text-sm text-muted-foreground">Controle de receitas, despesas e retenção</p>
        </div>
        <div className="flex gap-3">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-36"><Filter className="h-4 w-4 mr-2" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="month">Este mês</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="90d">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => { reset({ type: 'income' }); setModalOpen(true) }} className="gap-2">
            <Plus className="h-4 w-4" /> Lançamento
          </Button>
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="p-4"><div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center"><TrendingUp className="h-5 w-5 text-green-600" /></div>
          <div><p className="text-xs text-muted-foreground">Receita</p><p className="text-xl font-bold text-green-600">R$ {summary.income.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p></div>
        </div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center"><TrendingDown className="h-5 w-5 text-red-600" /></div>
          <div><p className="text-xs text-muted-foreground">Despesas</p><p className="text-xl font-bold text-red-600">R$ {summary.expense.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p></div>
        </div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3">
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', summary.balance >= 0 ? 'bg-blue-50' : 'bg-red-50')}>
            <DollarSign className={cn('h-5 w-5', summary.balance >= 0 ? 'text-blue-600' : 'text-red-600')} />
          </div>
          <div><p className="text-xs text-muted-foreground">Saldo</p><p className={cn('text-xl font-bold', summary.balance >= 0 ? 'text-blue-600' : 'text-red-600')}>R$ {summary.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p></div>
        </div></CardContent></Card>
      </div>

      {/* Card Receita Perdida */}
      {inactiveClients.length > 0 && (
        <Card className="border-orange-200 bg-orange-50/40">
          <CardContent className="p-5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-6 w-6 text-orange-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-orange-900">Receita em risco — clientes inativos</p>
                    <Badge variant="outline" className="text-orange-700 border-orange-300 bg-orange-100">{inactiveClients.length} clientes · {inactiveDays}+ dias</Badge>
                  </div>
                  <p className="text-sm text-orange-700">Potencial não realizado baseado no ticket médio de cada cliente</p>
                  <div className="flex gap-6 mt-2">
                    <div>
                      <p className="text-xs text-orange-600">Receita potencial perdida</p>
                      <p className="text-2xl font-bold text-orange-800">R$ {lostRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div>
                      <p className="text-xs text-orange-600">Ticket médio</p>
                      <p className="text-2xl font-bold text-orange-800">R$ {avgTicket.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div>
                      <p className="text-xs text-orange-600">Com telefone</p>
                      <p className="text-2xl font-bold text-orange-800">{inactiveClients.filter(c => c.phone).length}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <Button variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-100 gap-2" onClick={() => setInactiveModalOpen(true)}>
                  <UserX className="h-4 w-4" /> Ver clientes
                </Button>
                <Button className="bg-orange-500 hover:bg-orange-600 text-white gap-2" onClick={() => setInactiveModalOpen(true)}>
                  <Send className="h-4 w-4" /> Enviar mensagem em massa
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Gráfico */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Receita × Despesa (últimos 7 dias)</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${v}`} />
              <Tooltip formatter={(v: number) => `R$ ${v.toFixed(2)}`} />
              <Bar dataKey="receita" name="Receita" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="despesa" name="Despesa" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Transações */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Lançamentos</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-muted rounded-lg animate-pulse" />)}</div>
          ) : transactions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Nenhum lançamento no período</p>
          ) : (
            <div className="space-y-2">
              {transactions.map(t => (
                <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', t.type === 'income' ? 'bg-green-50' : 'bg-red-50')}>
                      {t.type === 'income' ? <TrendingUp className="h-4 w-4 text-green-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{t.description}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(t.created_at), 'dd/MM/yyyy')}{t.category && ` • ${t.category}`}{t.payment_method && ` • ${t.payment_method}`}</p>
                    </div>
                  </div>
                  <p className={cn('font-semibold', t.type === 'income' ? 'text-green-600' : 'text-red-600')}>{t.type === 'income' ? '+' : '-'} R$ {t.amount.toFixed(2)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal Lançamento */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo Lançamento</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Controller name="type" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="income">Receita</SelectItem><SelectItem value="expense">Despesa</SelectItem></SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1.5">
              <Label>Valor (R$) *</Label>
              <Input type="number" step="0.01" min="0.01" placeholder="0,00" {...register('amount')} />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Descrição *</Label>
              <Input placeholder="Ex: Lavagem completa - João..." {...register('description')} />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Controller name="category" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>{(transactionType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </div>
              <div className="space-y-1.5">
                <Label>Pagamento</Label>
                <Controller name="payment_method" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>{PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </div>
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setModalOpen(false)}>Cancelar</Button>
              <Button type="submit" className="flex-1" disabled={saving}>{saving ? 'Salvando...' : 'Registrar'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Clientes Inativos */}
      <Dialog open={inactiveModalOpen} onOpenChange={setInactiveModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserX className="h-5 w-5 text-orange-500" />
              Clientes inativos há {inactiveDays}+ dias
              <Badge className="bg-orange-100 text-orange-700 border-none">{inactiveClients.length}</Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <Label className="text-sm shrink-0">Inativo há mais de:</Label>
              <Select value={String(inactiveDays)} onValueChange={v => handleInactiveDaysChange(Number(v))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 dias</SelectItem>
                  <SelectItem value="45">45 dias</SelectItem>
                  <SelectItem value="60">60 dias</SelectItem>
                  <SelectItem value="90">90 dias</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 p-4 border rounded-lg">
              <Label className="text-sm font-semibold flex items-center gap-2">
                <Send className="h-4 w-4 text-green-600" /> Mensagem em massa via WhatsApp
              </Label>
              <p className="text-xs text-muted-foreground">Use {'{nome}'} e {'{empresa}'} como variáveis</p>
              <Textarea value={bulkMessage} onChange={e => setBulkMessage(e.target.value)} rows={4} />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{inactiveClients.filter(c => c.phone).length} de {inactiveClients.length} têm telefone</p>
                {bulkProgress.running ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                    Enviando {bulkProgress.sent}/{bulkProgress.total}...
                  </div>
                ) : (
                  <Button className="bg-green-600 hover:bg-green-700 gap-2" onClick={sendBulkMessage} disabled={sendingBulk}>
                    <Send className="h-4 w-4" /> Enviar para {inactiveClients.filter(c => c.phone).length} clientes
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {inactiveClients.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center text-xs font-bold text-orange-700">{c.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.phone ?? 'Sem telefone'} · {c.visits} visita{c.visits !== 1 ? 's' : ''}{c.last_visit && ` · última: ${format(new Date(c.last_visit), 'dd/MM/yy')}`}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs">{c.days_inactive}d sem visitar</Badge>
                    <p className="text-xs text-muted-foreground mt-1">ticket médio: R$ {c.avg_ticket.toFixed(0)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
