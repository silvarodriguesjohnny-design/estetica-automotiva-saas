import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/lib/supabase/client'
import { Plus, Search, User, Car, Phone, Mail, Calendar, UserX, Tag, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { format, subDays } from 'date-fns'
import { sendWhatsAppMessage, sanitizePhone } from '@/lib/evolution/client'
import type { Customer } from '@/types'
import { cn } from '@/lib/utils'

const customerSchema = z.object({
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  phone: z.string().optional(),
  cpf: z.string().optional(),
  birthday: z.string().optional(),
  notes: z.string().optional(),
  discount_percentage: z.coerce.number().min(0).max(100).optional(),
})
type CustomerForm = z.infer<typeof customerSchema>

type FilterType = 'all' | 'inactive_30d' | 'inactive_45d' | 'inactive_60d' | 'inactive_90d' | 'no_phone'

export default function Clientes() {
  const { tenant } = useAuth()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [saving, setSaving] = useState(false)
  const [vehicleCounts, setVehicleCounts] = useState<Record<string, number>>({})
  const [visitCounts, setVisitCounts] = useState<Record<string, number>>({})
  const [lastVisit, setLastVisit] = useState<Record<string, string>>({})
  // Mensagem individual rápida
  const [msgModalOpen, setMsgModalOpen] = useState(false)
  const [msgClient, setMsgClient] = useState<Customer | null>(null)
  const [quickMsg, setQuickMsg] = useState('')
  const [sendingMsg, setSendingMsg] = useState(false)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CustomerForm>({ resolver: zodResolver(customerSchema) })

  useEffect(() => { if (tenant) fetchCustomers() }, [tenant])

  const fetchCustomers = async () => {
    setLoading(true)
    const { data } = await supabase.from('customers').select('*').order('name')
    setCustomers((data as Customer[]) ?? [])

    const { data: vehicles } = await supabase.from('vehicles').select('customer_id')
    const vCount: Record<string, number> = {}
    vehicles?.forEach(v => { vCount[v.customer_id] = (vCount[v.customer_id] ?? 0) + 1 })
    setVehicleCounts(vCount)

    const { data: orders } = await supabase.from('service_orders').select('customer_id, completed_at, created_at').eq('status', 'completed')
    const oCount: Record<string, number> = {}
    const lv: Record<string, string> = {}
    orders?.forEach(o => {
      oCount[o.customer_id] = (oCount[o.customer_id] ?? 0) + 1
      const date = o.completed_at || o.created_at
      if (!lv[o.customer_id] || date > lv[o.customer_id]) lv[o.customer_id] = date
    })
    setVisitCounts(oCount)
    setLastVisit(lv)
    setLoading(false)
  }

  const getDaysInactive = (customerId: string): number | null => {
    const lv = lastVisit[customerId]
    if (!lv) return null
    return Math.floor((new Date().getTime() - new Date(lv).getTime()) / 86400000)
  }

  const isInactive = (customerId: string, days: number): boolean => {
    const d = getDaysInactive(customerId)
    return d !== null && d >= days
  }

  const filteredCustomers = customers.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search) || c.email?.toLowerCase().includes(search.toLowerCase())
    if (!matchSearch) return false
    if (filter === 'all') return true
    if (filter === 'no_phone') return !c.phone
    const days = Number(filter.replace('inactive_', '').replace('d', ''))
    return isInactive(c.id, days)
  })

  const filterCounts: Record<FilterType, number> = {
    all: customers.length,
    inactive_30d: customers.filter(c => isInactive(c.id, 30)).length,
    inactive_45d: customers.filter(c => isInactive(c.id, 45)).length,
    inactive_60d: customers.filter(c => isInactive(c.id, 60)).length,
    inactive_90d: customers.filter(c => isInactive(c.id, 90)).length,
    no_phone: customers.filter(c => !c.phone).length,
  }

  const openCreate = () => { setEditing(null); reset({}); setModalOpen(true) }
  const openEdit = (c: Customer) => {
    setEditing(c)
    reset({ name: c.name, email: c.email ?? '', phone: c.phone ?? '', cpf: c.cpf ?? '', birthday: c.birthday ?? '', notes: c.notes ?? '', discount_percentage: c.discount_percentage ?? 0 })
    setModalOpen(true)
  }

  const onSubmit = async (data: CustomerForm) => {
    setSaving(true)
    try {
      const payload = { tenant_id: tenant!.id, name: data.name, email: data.email || null, phone: data.phone || null, cpf: data.cpf || null, birthday: data.birthday || null, notes: data.notes || null, discount_percentage: data.discount_percentage ?? 0 }
      if (editing) {
        const { error } = await supabase.from('customers').update(payload).eq('id', editing.id)
        if (error) throw error; toast.success('Cliente atualizado!')
      } else {
        const { error } = await supabase.from('customers').insert(payload)
        if (error) throw error; toast.success('Cliente cadastrado!')
      }
      setModalOpen(false); fetchCustomers()
    } catch (err: any) { toast.error(err.message) } finally { setSaving(false) }
  }

  const openQuickMsg = (c: Customer) => {
    setMsgClient(c)
    setQuickMsg(`Olá ${c.name.split(' ')[0]}! 😊 `)
    setMsgModalOpen(true)
  }

  const sendQuickMsg = async () => {
    if (!msgClient?.phone || !quickMsg.trim()) return
    setSendingMsg(true)
    try {
      const { data: config } = await supabase.from('messaging_configs').select('*').single()
      if (!config?.instance_name) { toast.error('Configure o WhatsApp em Mensagens'); return }
      await sendWhatsAppMessage(config.instance_name, sanitizePhone(msgClient.phone), quickMsg)
      toast.success('Mensagem enviada! ✅')
      setMsgModalOpen(false)
    } catch (err: any) { toast.error(err.message) } finally { setSendingMsg(false) }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-sm text-muted-foreground">{customers.length} clientes cadastrados</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Novo Cliente</Button>
      </div>

      {/* Busca + Filtros */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome, telefone ou e-mail..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* Tags de filtro */}
        <div className="flex flex-wrap gap-2">
          {([
            { key: 'all', label: 'Todos', icon: null },
            { key: 'inactive_30d', label: 'Inativos 30d+', icon: <UserX className="h-3 w-3" /> },
            { key: 'inactive_45d', label: 'Inativos 45d+', icon: <UserX className="h-3 w-3" /> },
            { key: 'inactive_60d', label: 'Inativos 60d+', icon: <UserX className="h-3 w-3" /> },
            { key: 'inactive_90d', label: 'Inativos 90d+', icon: <UserX className="h-3 w-3" /> },
            { key: 'no_phone', label: 'Sem telefone', icon: null },
          ] as { key: FilterType; label: string; icon: React.ReactNode }[]).map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                filter === f.key
                  ? f.key.startsWith('inactive') ? 'bg-orange-500 text-white border-orange-500' : 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border text-muted-foreground hover:bg-muted'
              )}
            >
              {f.icon}{f.label}
              <span className={cn('ml-1 px-1.5 py-0.5 rounded-full text-[10px]',
                filter === f.key ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground'
              )}>{filterCounts[f.key]}</span>
            </button>
          ))}
        </div>

        {/* Aviso filtro inativo ativo */}
        {filter.startsWith('inactive') && (
          <div className="flex items-center justify-between p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-orange-700">
              <UserX className="h-4 w-4" />
              <strong>{filteredCustomers.length} clientes</strong> sem visitar há {filter.replace('inactive_', '').replace('d', '')} dias ou mais
            </div>
            <Button
              size="sm"
              className="bg-orange-500 hover:bg-orange-600 text-white gap-1"
              onClick={() => {
                // Navega para mensagens com filtro pré-selecionado
                window.location.hash = `/mensagens?target=${filter}`
                toast.info('Abra "Mensagens WhatsApp" para enviar em massa')
              }}
            >
              <Send className="h-3 w-3" /> Enviar mensagem em massa
            </Button>
          </div>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : filteredCustomers.length === 0 ? (
        <Card><CardContent className="py-16 text-center">
          <User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">{filter !== 'all' ? 'Nenhum cliente nesse filtro' : 'Nenhum cliente encontrado'}</p>
          {filter === 'all' && <Button className="mt-4" onClick={openCreate}>Cadastrar primeiro cliente</Button>}
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCustomers.map(c => {
            const daysInactive = getDaysInactive(c.id)
            const isInactiveFlag = daysInactive !== null && daysInactive >= 45
            return (
              <Card key={c.id} className={cn('cursor-pointer hover:shadow-md transition-all group', isInactiveFlag && 'border-orange-200')} onClick={() => openEdit(c)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white',
                        isInactiveFlag ? 'bg-orange-400' : 'bg-primary'
                      )}>
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{c.name}</p>
                        {c.discount_percentage ? <Badge variant="secondary" className="text-xs mt-0.5">{c.discount_percentage}% desc.</Badge> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {c.phone && (
                        <button
                          className="w-7 h-7 rounded-lg bg-green-100 hover:bg-green-200 flex items-center justify-center text-green-700"
                          onClick={e => { e.stopPropagation(); openQuickMsg(c) }}
                          title="Enviar WhatsApp"
                        >
                          <Send className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Tag de inativo */}
                  {daysInactive !== null && daysInactive >= 30 && (
                    <div className={cn('flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium mb-2 w-fit',
                      daysInactive >= 90 ? 'bg-red-100 text-red-700' :
                      daysInactive >= 60 ? 'bg-orange-100 text-orange-700' :
                      'bg-yellow-100 text-yellow-700'
                    )}>
                      <UserX className="h-3 w-3" />
                      Inativo há {daysInactive}d
                    </div>
                  )}

                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    {c.phone && <div className="flex items-center gap-2"><Phone className="h-3 w-3" />{c.phone}</div>}
                    {c.email && <div className="flex items-center gap-2"><Mail className="h-3 w-3" />{c.email}</div>}
                    {lastVisit[c.id] && (
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3 w-3" />
                        Última visita: {format(new Date(lastVisit[c.id]), 'dd/MM/yyyy')}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-4 mt-3 pt-3 border-t border-border">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Car className="h-3 w-3" />{vehicleCounts[c.id] ?? 0} veículo(s)
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {visitCounts[c.id] ?? 0} visita(s)
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal Cadastro/Edição */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Editar Cliente' : 'Novo Cliente'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome completo *</Label>
              <Input placeholder="João Silva" {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Telefone / WhatsApp</Label>
              <Input placeholder="(11) 99999-9999" {...register('phone')} />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail</Label>
              <Input type="email" placeholder="joao@email.com" {...register('email')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>CPF</Label>
                <Input placeholder="000.000.000-00" {...register('cpf')} />
              </div>
              <div className="space-y-1.5">
                <Label>Data de Nascimento</Label>
                <Input type="date" {...register('birthday')} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Desconto padrão (%)</Label>
              <Input type="number" min="0" max="100" step="0.5" {...register('discount_percentage')} />
            </div>
            <div className="space-y-1.5">
              <Label>Observações</Label>
              <Textarea placeholder="Observações sobre o cliente..." {...register('notes')} rows={2} />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setModalOpen(false)}>Cancelar</Button>
              <Button type="submit" className="flex-1" disabled={saving}>{saving ? 'Salvando...' : editing ? 'Atualizar' : 'Cadastrar'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Mensagem Rápida */}
      <Dialog open={msgModalOpen} onOpenChange={setMsgModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4 text-green-600" /> WhatsApp para {msgClient?.name?.split(' ')[0]}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{msgClient?.phone}</p>
            <Textarea value={quickMsg} onChange={e => setQuickMsg(e.target.value)} rows={4} placeholder="Digite a mensagem..." />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setMsgModalOpen(false)}>Cancelar</Button>
              <Button className="flex-1 bg-green-600 hover:bg-green-700 gap-2" onClick={sendQuickMsg} disabled={sendingMsg}>
                {sendingMsg ? 'Enviando...' : <><Send className="h-4 w-4" /> Enviar</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
