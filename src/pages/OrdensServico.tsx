import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/lib/supabase/client'
import {
  Plus, Search, Filter, Car, Clock, CheckCircle, X, Eye, Edit2,
  MessageSquare, ChevronDown
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  ORDER_STATUS_LABELS, ORDER_STATUS_COLORS, PAYMENT_METHODS, PAYMENT_STATUS_LABELS,
  type ServiceOrderWithRelations, type ServiceOrderStatus, type Customer,
  type Vehicle, type Technician, type Service
} from '@/types'
import { cn } from '@/lib/utils'
import { sendWhatsAppMessage, MESSAGE_TEMPLATES } from '@/lib/evolution/client'

const osSchema = z.object({
  customer_id: z.string().min(1, 'Selecione um cliente'),
  vehicle_id: z.string().min(1, 'Selecione um veículo'),
  technician_id: z.string().optional(),
  start_time: z.string().min(1, 'Informe data e hora'),
  estimated_end_time: z.string().optional(),
  notes: z.string().optional(),
  internal_notes: z.string().optional(),
  payment_method: z.string().optional(),
  service_ids: z.array(z.string()).min(1, 'Selecione ao menos um serviço'),
})

type OSForm = z.infer<typeof osSchema>

export default function OrdensServico() {
  const { tenant } = useAuth()
  const [orders, setOrders] = useState<ServiceOrderWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<ServiceOrderWithRelations | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [technicians, setTechnicians] = useState<Technician[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [saving, setSaving] = useState(false)

  const {
    register, handleSubmit, control, watch, setValue, reset,
    formState: { errors }
  } = useForm<OSForm>({
    resolver: zodResolver(osSchema),
    defaultValues: { service_ids: [], start_time: format(new Date(), "yyyy-MM-dd'T'HH:mm") }
  })

  const selectedCustomerId = watch('customer_id')
  const selectedServiceIds = watch('service_ids') ?? []

  const filteredVehicles = vehicles.filter(v => v.customer_id === selectedCustomerId)

  useEffect(() => {
    if (!tenant) return
    fetchOrders()
    fetchFormData()
  }, [tenant])

  const fetchOrders = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('service_orders')
      .select(`
        *,
        customer:customers(id, name, phone),
        vehicle:vehicles(id, brand, model, plate, color),
        technician:technicians(id, name),
        items:service_order_items(*)
      `)
      .order('start_time', { ascending: false })
    setOrders((data as ServiceOrderWithRelations[]) ?? [])
    setLoading(false)
  }

  const fetchFormData = async () => {
    const [cRes, vRes, tRes, sRes] = await Promise.all([
      supabase.from('customers').select('*').order('name'),
      supabase.from('vehicles').select('*'),
      supabase.from('technicians').select('*').eq('is_active', true),
      supabase.from('services').select('*').eq('is_active', true).order('name'),
    ])
    setCustomers((cRes.data as Customer[]) ?? [])
    setVehicles((vRes.data as Vehicle[]) ?? [])
    setTechnicians((tRes.data as Technician[]) ?? [])
    setServices((sRes.data as Service[]) ?? [])
  }

  const onSubmit = async (data: OSForm) => {
    setSaving(true)
    try {
      const selectedServices = services.filter(s => data.service_ids.includes(s.id))
      const total = selectedServices.reduce((sum, s) => sum + s.price, 0)

      const { data: order, error } = await supabase
        .from('service_orders')
        .insert({
          tenant_id: tenant!.id,
          customer_id: data.customer_id,
          vehicle_id: data.vehicle_id,
          technician_id: data.technician_id || null,
          start_time: data.start_time,
          estimated_end_time: data.estimated_end_time || null,
          notes: data.notes || null,
          internal_notes: data.internal_notes || null,
          payment_method: data.payment_method || null,
          total_amount: total,
          status: 'pending',
          payment_status: 'pending',
        })
        .select()
        .single()

      if (error) throw error

      // Inserir itens
      if (selectedServices.length > 0) {
        await supabase.from('service_order_items').insert(
          selectedServices.map(s => ({
            tenant_id: tenant!.id,
            service_order_id: order.id,
            service_id: s.id,
            name: s.name,
            price: s.price,
            quantity: 1,
          }))
        )
      }

      // Transação financeira (OS confirmada = receita projetada)
      await supabase.from('transactions').insert({
        tenant_id: tenant!.id,
        type: 'income',
        amount: total,
        description: `OS #${order.order_number} - ${selectedServices.map(s => s.name).join(', ')}`,
        category: 'servico',
        service_order_id: order.id,
        customer_id: data.customer_id,
      })

      // WhatsApp: notificar cliente
      const customer = customers.find(c => c.id === data.customer_id)
      const vehicle = vehicles.find(v => v.id === data.vehicle_id)
      if (customer?.phone && tenant?.whatsapp_instance) {
        const msg = MESSAGE_TEMPLATES.os_confirmada({
          nome: customer.name,
          placa: vehicle?.plate ?? `${vehicle?.brand} ${vehicle?.model}`,
          data: format(new Date(data.start_time), 'dd/MM/yyyy'),
          hora: format(new Date(data.start_time), 'HH:mm'),
        })
        sendWhatsAppMessage(tenant.whatsapp_instance, customer.phone, msg)
          .catch(() => {}) // não bloqueia se WhatsApp falhar
      }

      toast.success('Ordem de serviço criada!')
      setModalOpen(false)
      reset()
      fetchOrders()
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar OS')
    } finally {
      setSaving(false)
    }
  }

  const updateStatus = async (orderId: string, status: ServiceOrderStatus) => {
    const { error } = await supabase
      .from('service_orders')
      .update({ status, end_time: status === 'completed' ? new Date().toISOString() : null })
      .eq('id', orderId)

    if (error) { toast.error('Erro ao atualizar status'); return }

    // Notificar cliente
    const order = orders.find(o => o.id === orderId)
    if (order?.customer?.phone && tenant?.whatsapp_instance) {
      let msg: string | null = null
      if (status === 'in_progress') {
        msg = MESSAGE_TEMPLATES.os_andamento({
          nome: order.customer.name,
          placa: order.vehicle?.plate ?? `${order.vehicle?.brand} ${order.vehicle?.model}` ?? '',
        })
      } else if (status === 'completed') {
        msg = MESSAGE_TEMPLATES.os_concluida({
          nome: order.customer.name,
          placa: order.vehicle?.plate ?? `${order.vehicle?.brand} ${order.vehicle?.model}` ?? '',
          valor: `R$ ${order.total_amount.toFixed(2)}`,
        })
      }
      if (msg) sendWhatsAppMessage(tenant.whatsapp_instance, order.customer.phone, msg).catch(() => {})
    }

    toast.success('Status atualizado!')
    setDetailOpen(false)
    fetchOrders()
  }

  const filtered = orders.filter(o => {
    const matchSearch =
      o.customer?.name.toLowerCase().includes(search.toLowerCase()) ||
      o.vehicle?.plate?.toLowerCase().includes(search.toLowerCase()) ||
      `${o.vehicle?.brand} ${o.vehicle?.model}`.toLowerCase().includes(search.toLowerCase()) ||
      `#${o.order_number}`.includes(search)
    const matchStatus = statusFilter === 'all' || o.status === statusFilter
    return matchSearch && matchStatus
  })

  const toggleService = (id: string) => {
    const current = selectedServiceIds
    setValue(
      'service_ids',
      current.includes(id) ? current.filter(s => s !== id) : [...current, id]
    )
  }

  const selectedTotal = services
    .filter(s => selectedServiceIds.includes(s.id))
    .reduce((sum, s) => sum + s.price, 0)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Ordens de Serviço</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} ordens encontradas</p>
        </div>
        <Button onClick={() => { reset(); setModalOpen(true) }} className="gap-2">
          <Plus className="h-4 w-4" /> Nova OS
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente, placa, modelo ou nº OS..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Lista de OS */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <ClipboardIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Nenhuma OS encontrada</p>
            <Button className="mt-4" onClick={() => setModalOpen(true)}>
              Criar primeira OS
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => (
            <Card key={order.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                      <Car className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">
                          {order.vehicle?.brand} {order.vehicle?.model}
                        </p>
                        {order.vehicle?.plate && (
                          <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                            {order.vehicle.plate}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {order.customer?.name} • OS #{order.order_number}
                        {order.technician && ` • ${order.technician.name}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(order.start_time), 'dd/MM/yyyy HH:mm')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="font-bold text-sm">R$ {order.total_amount.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">
                        {PAYMENT_STATUS_LABELS[order.payment_status]}
                      </p>
                    </div>
                    <Badge className={cn('text-xs', ORDER_STATUS_COLORS[order.status])}>
                      {ORDER_STATUS_LABELS[order.status]}
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => { setSelectedOrder(order); setDetailOpen(true) }}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* MODAL: Nova OS */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Ordem de Serviço</DialogTitle>
            <DialogDescription>Preencha os dados da OS</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Cliente *</Label>
                <Controller
                  name="customer_id"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={v => {
                      field.onChange(v)
                      setValue('vehicle_id', '')
                    }}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecionar cliente" />
                      </SelectTrigger>
                      <SelectContent>
                        {customers.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.customer_id && <p className="text-xs text-destructive">{errors.customer_id.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Veículo *</Label>
                <Controller
                  name="vehicle_id"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={!selectedCustomerId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecionar veículo" />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredVehicles.map(v => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.brand} {v.model} {v.plate && `(${v.plate})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.vehicle_id && <p className="text-xs text-destructive">{errors.vehicle_id.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Data e Hora *</Label>
                <Input type="datetime-local" {...register('start_time')} />
              </div>

              <div className="space-y-1.5">
                <Label>Previsão de Término</Label>
                <Input type="datetime-local" {...register('estimated_end_time')} />
              </div>

              <div className="space-y-1.5">
                <Label>Técnico</Label>
                <Controller
                  name="technician_id"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecionar técnico" />
                      </SelectTrigger>
                      <SelectContent>
                        {technicians.map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Forma de Pagamento</Label>
                <Controller
                  name="payment_method"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecionar" />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map(m => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            {/* Serviços */}
            <div className="space-y-2">
              <Label>Serviços * {errors.service_ids && <span className="text-destructive text-xs ml-1">{errors.service_ids.message}</span>}</Label>
              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                {services.map(s => {
                  const selected = selectedServiceIds.includes(s.id)
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleService(s.id)}
                      className={cn(
                        'text-left p-2.5 rounded-lg border text-xs transition-colors',
                        selected
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border hover:border-primary/50',
                      )}
                    >
                      <p className="font-medium">{s.name}</p>
                      <p className="text-muted-foreground">R$ {s.price.toFixed(2)} • {s.duration_minutes}min</p>
                    </button>
                  )
                })}
              </div>
              {selectedServiceIds.length > 0 && (
                <p className="text-sm font-semibold text-right">
                  Total: R$ {selectedTotal.toFixed(2)}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Observações para o cliente</Label>
              <Textarea placeholder="Observações visíveis para o cliente..." {...register('notes')} rows={2} />
            </div>

            <div className="space-y-1.5">
              <Label>Notas internas</Label>
              <Textarea placeholder="Notas internas (não visíveis ao cliente)..." {...register('internal_notes')} rows={2} />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={saving}>
                {saving ? 'Criando...' : 'Criar OS'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: Detalhe da OS */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {selectedOrder && (
            <>
              <DialogHeader>
                <DialogTitle>OS #{selectedOrder.order_number}</DialogTitle>
                <DialogDescription>
                  {selectedOrder.vehicle?.brand} {selectedOrder.vehicle?.model}
                  {selectedOrder.vehicle?.plate && ` • ${selectedOrder.vehicle.plate}`}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Cliente</p>
                    <p className="font-medium">{selectedOrder.customer?.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Técnico</p>
                    <p className="font-medium">{selectedOrder.technician?.name ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Data/Hora</p>
                    <p className="font-medium">
                      {format(new Date(selectedOrder.start_time), 'dd/MM/yyyy HH:mm')}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Total</p>
                    <p className="font-bold text-lg">R$ {selectedOrder.total_amount.toFixed(2)}</p>
                  </div>
                </div>

                {selectedOrder.items && selectedOrder.items.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Serviços</p>
                    <div className="space-y-1">
                      {selectedOrder.items.map(item => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <span>{item.name}</span>
                          <span className="font-medium">R$ {item.price.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedOrder.notes && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Observações</p>
                    <p className="text-sm">{selectedOrder.notes}</p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {selectedOrder.status === 'pending' && (
                    <Button size="sm" onClick={() => updateStatus(selectedOrder.id, 'confirmed')}>
                      Confirmar
                    </Button>
                  )}
                  {selectedOrder.status === 'confirmed' && (
                    <Button size="sm" onClick={() => updateStatus(selectedOrder.id, 'in_progress')}>
                      Iniciar Serviço
                    </Button>
                  )}
                  {selectedOrder.status === 'in_progress' && (
                    <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => updateStatus(selectedOrder.id, 'completed')}>
                      <CheckCircle className="h-4 w-4 mr-1" /> Concluir
                    </Button>
                  )}
                  {!['completed', 'cancelled'].includes(selectedOrder.status) && (
                    <Button size="sm" variant="destructive" onClick={() => updateStatus(selectedOrder.id, 'cancelled')}>
                      <X className="h-4 w-4 mr-1" /> Cancelar
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

const ClipboardIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
  </svg>
)
