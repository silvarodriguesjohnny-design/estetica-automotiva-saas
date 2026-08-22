import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { Plus, Pencil, Wrench, Clock, DollarSign, Search } from 'lucide-react'
import { z } from 'zod'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

interface Service {
  id: string
  name: string
  type: string
  description: string | null
  duration_minutes: number
  price: number
  is_active: boolean
}

const SERVICE_TYPES = [
  { value: 'lavagem', label: '🚿 Lavagem' },
  { value: 'polimento', label: '✨ Polimento' },
  { value: 'ceramica', label: '🛡️ Cerâmica' },
  { value: 'peliculas', label: '🎞️ Películas' },
  { value: 'higienizacao', label: '🧹 Higienização' },
  { value: 'estetica', label: '🚗 Estética Completa' },
  { value: 'funilaria', label: '🔨 Funilaria Leve' },
  { value: 'outros', label: '📦 Outros' },
]

const schema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres'),
  type: z.string(),
  description: z.string().optional(),
  duration_minutes: z.coerce.number().min(5, 'Mínimo 5 minutos'),
  price: z.coerce.number().min(0),
})
type FormData = z.infer<typeof schema>

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes}min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

export default function Servicos() {
  const { tenant: company } = useAuth()
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Service | null>(null)

  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'lavagem', duration_minutes: 60, price: 0 }
  })

  useEffect(() => { if (company?.id) fetchServices() }, [company?.id])

  async function fetchServices() {
    setLoading(true)
    const { data } = await supabase.from('services').select('*').eq('tenant_id', company!.id).order('name')
    setServices(data || [])
    setLoading(false)
  }

  function openNew() {
    setEditing(null)
    reset({ type: 'lavagem', duration_minutes: 60, price: 0 })
    setModalOpen(true)
  }

  function openEdit(s: Service) {
    setEditing(s)
    reset({ name: s.name, type: s.type, description: s.description || '', duration_minutes: s.duration_minutes, price: s.price })
    setModalOpen(true)
  }

  async function onSubmit(data: FormData) {
    const payload = { ...data, tenant_id: company!.id }
    if (editing) {
      const { error } = await supabase.from('services').update(payload).eq('id', editing.id)
      if (error) { toast.error('Erro ao salvar'); return }
      toast.success('Serviço atualizado!')
    } else {
      const { error } = await supabase.from('services').insert(payload)
      if (error) { toast.error('Erro ao criar'); return }
      toast.success('Serviço cadastrado!')
    }
    setModalOpen(false)
    fetchServices()
  }

  async function toggleActive(s: Service) {
    await supabase.from('services').update({ is_active: !s.is_active }).eq('id', s.id)
    toast.success(s.is_active ? 'Serviço desativado' : 'Serviço ativado')
    fetchServices()
  }

  const filtered = services.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase())
    const matchType = typeFilter === 'all' || s.type === typeFilter
    return matchSearch && matchType
  })

  const activeCount = services.filter(s => s.is_active).length
  const avgPrice = services.filter(s => s.is_active).length > 0
    ? services.filter(s => s.is_active).reduce((sum, s) => sum + s.price, 0) / services.filter(s => s.is_active).length
    : 0
  const avgDuration = services.filter(s => s.is_active).length > 0
    ? services.filter(s => s.is_active).reduce((sum, s) => sum + s.duration_minutes, 0) / services.filter(s => s.is_active).length
    : 0

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Serviços</h1>
          <p className="text-gray-500 text-sm">Catálogo de serviços da estética</p>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="w-4 h-4"/>Novo Serviço</Button>
      </div>

      {/* Cards resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <Wrench className="w-8 h-8 text-blue-500"/>
          <div>
            <p className="text-sm text-gray-500">Serviços ativos</p>
            <p className="text-2xl font-bold">{activeCount}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <DollarSign className="w-8 h-8 text-green-500"/>
          <div>
            <p className="text-sm text-gray-500">Ticket médio</p>
            <p className="text-2xl font-bold text-green-700">
              {avgPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <Clock className="w-8 h-8 text-purple-500"/>
          <div>
            <p className="text-sm text-gray-500">Duração média</p>
            <p className="text-2xl font-bold">{formatDuration(Math.round(avgDuration))}</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
          <Input className="pl-9" placeholder="Buscar serviço..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-52"><SelectValue placeholder="Tipo"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {SERVICE_TYPES.map(t=><SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Cards de serviço */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <p className="col-span-3 text-center py-8 text-gray-400">Carregando...</p>
        ) : filtered.length === 0 ? (
          <p className="col-span-3 text-center py-8 text-gray-400">Nenhum serviço encontrado</p>
        ) : filtered.map(s => (
          <div key={s.id} className={`bg-white rounded-xl border p-5 space-y-3 transition-opacity ${!s.is_active ? 'opacity-50' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-gray-900">{s.name}</h3>
                <Badge variant="outline" className="text-xs mt-1">
                  {SERVICE_TYPES.find(t=>t.value===s.type)?.label || s.type}
                </Badge>
              </div>
              <Switch checked={s.is_active} onCheckedChange={()=>toggleActive(s)}/>
            </div>
            {s.description && <p className="text-sm text-gray-500">{s.description}</p>}
            <div className="flex items-center justify-between pt-1 border-t">
              <div className="flex items-center gap-1 text-gray-500 text-sm">
                <Clock className="w-3.5 h-3.5"/>
                {formatDuration(s.duration_minutes)}
              </div>
              <p className="text-lg font-bold text-green-700">
                {s.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </p>
            </div>
            <Button size="sm" variant="outline" className="w-full gap-2" onClick={()=>openEdit(s)}>
              <Pencil className="w-3.5 h-3.5"/>Editar
            </Button>
          </div>
        ))}
      </div>

      {/* Tabela alternativa para visão rápida */}
      {filtered.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700">Tabela de preços</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Serviço</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(s=>(
                <TableRow key={`tbl-${s.id}`} className={!s.is_active ? 'opacity-50' : undefined}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{SERVICE_TYPES.find(t=>t.value===s.type)?.label || s.type}</Badge></TableCell>
                  <TableCell className="text-gray-600">{formatDuration(s.duration_minutes)}</TableCell>
                  <TableCell className="font-semibold text-green-700">{s.price.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</TableCell>
                  <TableCell>
                    <Switch checked={s.is_active} onCheckedChange={()=>toggleActive(s)}/>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={()=>openEdit(s)}><Pencil className="w-4 h-4"/></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Serviço' : 'Novo Serviço'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label>Nome do serviço *</Label>
              <Input {...register('name')} placeholder="Ex: Lavagem Completa"/>
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <Label>Tipo</Label>
              <Controller name="type" control={control} render={({field})=>(
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{SERVICE_TYPES.map(t=><SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              )}/>
            </div>
            <div>
              <Label>Descrição (opcional)</Label>
              <Input {...register('description')} placeholder="Detalhes do serviço..."/>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Duração (minutos)</Label>
                <Input {...register('duration_minutes')} type="number" min="5"/>
                {errors.duration_minutes && <p className="text-red-500 text-xs mt-1">{errors.duration_minutes.message}</p>}
              </div>
              <div>
                <Label>Valor (R$)</Label>
                <Input {...register('price')} type="number" step="0.01" min="0"/>
                {errors.price && <p className="text-red-500 text-xs mt-1">{errors.price.message}</p>}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={()=>setModalOpen(false)}>Cancelar</Button>
              <Button type="submit" className="flex-1" disabled={isSubmitting}>
                {isSubmitting ? 'Salvando...' : editing ? 'Salvar' : 'Cadastrar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
