import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Plus, Pencil, Package, AlertTriangle, Search,
  ToggleLeft, ToggleRight, ShoppingCart, TrendingUp,
  DollarSign, XCircle, CheckCircle2, PlusCircle,
} from 'lucide-react'
import { z } from 'zod'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { cn } from '@/lib/utils'

/* ── Types ─────────────────────────────────────────────────────────── */

interface Product {
  id: string; name: string; category: string; description: string | null
  sku: string | null; unit: string; cost_price: number; sale_price: number
  stock_quantity: number; min_stock: number; active: boolean
}

type StockStatus = 'critical' | 'low' | 'ok'
type FilterStatus = 'all' | 'critical' | 'low' | 'ok'

/* ── Helpers ─────────────────────────────────────────────────────────── */

const CATEGORIES = [
  { value: 'limpeza', label: 'Limpeza' },
  { value: 'polimento', label: 'Polimento' },
  { value: 'ceramica', label: 'Cerâmica' },
  { value: 'peliculas', label: 'Películas' },
  { value: 'higienizacao', label: 'Higienização' },
  { value: 'acessorios', label: 'Acessórios' },
  { value: 'outros', label: 'Outros' },
]

const UNITS = ['un', 'ml', 'l', 'kg', 'g', 'cx', 'pc']

function getStatus(p: Product): StockStatus {
  if (p.stock_quantity === 0) return 'critical'
  if (p.min_stock > 0 && p.stock_quantity <= p.min_stock) return 'low'
  return 'ok'
}

const STATUS_CONFIG = {
  critical: {
    label: 'Crítico',
    badge: 'bg-red-100 text-red-700 border-red-200',
    row: 'bg-red-50/60 border-l-4 border-l-red-400',
    bar: 'bg-red-500',
    icon: XCircle,
    iconColor: 'text-red-500',
    barBg: 'bg-red-100',
  },
  low: {
    label: 'Baixo',
    badge: 'bg-orange-100 text-orange-700 border-orange-200',
    row: 'bg-orange-50/40 border-l-4 border-l-orange-400',
    bar: 'bg-orange-400',
    icon: AlertTriangle,
    iconColor: 'text-orange-500',
    barBg: 'bg-orange-100',
  },
  ok: {
    label: 'OK',
    badge: 'bg-green-100 text-green-700 border-green-200',
    row: '',
    bar: 'bg-green-500',
    icon: CheckCircle2,
    iconColor: 'text-green-500',
    barBg: 'bg-green-100',
  },
}

function StockBar({ product }: { product: Product }) {
  const status = getStatus(product)
  const cfg = STATUS_CONFIG[status]
  const max = Math.max(product.min_stock * 2, product.stock_quantity, 1)
  const pct = Math.min(100, (product.stock_quantity / max) * 100)

  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className={cn('flex-1 h-2 rounded-full overflow-hidden', cfg.barBg)}>
        <div className={cn('h-full rounded-full transition-all', cfg.bar)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('text-xs font-bold tabular-nums', status === 'critical' ? 'text-red-600' : status === 'low' ? 'text-orange-600' : 'text-gray-700')}>
        {product.stock_quantity}{product.unit}
      </span>
    </div>
  )
}

/* ── Schema ─────────────────────────────────────────────────────────── */

const schema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres'),
  category: z.string(),
  description: z.string().optional(),
  sku: z.string().optional(),
  unit: z.string(),
  cost_price: z.coerce.number().min(0),
  sale_price: z.coerce.number().min(0),
  stock_quantity: z.coerce.number().min(0),
  min_stock: z.coerce.number().min(0),
})
type FormData = z.infer<typeof schema>

/* ── Main Page ─────────────────────────────────────────────────────── */

export default function Estoque() {
  const { tenant: company } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [restockProduct, setRestockProduct] = useState<Product | null>(null)
  const [restockQty, setRestockQty] = useState('')
  const [restocking, setRestocking] = useState(false)

  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { unit: 'un', category: 'outros', cost_price: 0, sale_price: 0, stock_quantity: 0, min_stock: 0 },
  })

  const fetchProducts = useCallback(async () => {
    if (!company?.id) return
    setLoading(true)
    const { data } = await supabase.from('products').select('*').eq('tenant_id', company.id).order('name')
    setProducts((data as Product[]) || [])
    setLoading(false)
  }, [company?.id])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  function openNew() {
    setEditing(null)
    reset({ unit: 'un', category: 'outros', cost_price: 0, sale_price: 0, stock_quantity: 0, min_stock: 0 })
    setModalOpen(true)
  }

  function openEdit(p: Product) {
    setEditing(p)
    reset({
      name: p.name, category: p.category, description: p.description || '',
      sku: p.sku || '', unit: p.unit, cost_price: p.cost_price,
      sale_price: p.sale_price, stock_quantity: p.stock_quantity, min_stock: p.min_stock,
    })
    setModalOpen(true)
  }

  async function onSubmit(data: FormData) {
    const payload = { ...data, tenant_id: company!.id }
    if (editing) {
      const { error } = await supabase.from('products').update(payload).eq('id', editing.id)
      if (error) { toast.error('Erro ao salvar'); return }
      toast.success('Produto atualizado!')
    } else {
      const { error } = await supabase.from('products').insert(payload)
      if (error) { toast.error('Erro ao criar'); return }
      toast.success('Produto cadastrado!')
    }
    setModalOpen(false)
    fetchProducts()
  }

  async function toggleActive(p: Product) {
    await supabase.from('products').update({ active: !p.active }).eq('id', p.id)
    toast.success(p.active ? 'Produto desativado' : 'Produto ativado')
    fetchProducts()
  }

  async function handleRestock() {
    if (!restockProduct || !restockQty || Number(restockQty) <= 0) return
    setRestocking(true)
    const newQty = restockProduct.stock_quantity + Number(restockQty)
    const { error } = await supabase.from('products').update({ stock_quantity: newQty }).eq('id', restockProduct.id)
    if (error) { toast.error('Erro ao repor'); setRestocking(false); return }
    toast.success(`+${restockQty} ${restockProduct.unit} adicionados a ${restockProduct.name}`)
    setRestockProduct(null)
    setRestockQty('')
    setRestocking(false)
    fetchProducts()
  }

  // Computed
  const active = products.filter(p => p.active)
  const critical = active.filter(p => getStatus(p) === 'critical')
  const low = active.filter(p => getStatus(p) === 'low')
  const totalValue = active.reduce((s, p) => s + p.stock_quantity * p.cost_price, 0)
  const margin = active.reduce((s, p) => s + p.stock_quantity * (p.sale_price - p.cost_price), 0)

  const filtered = products.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku || '').toLowerCase().includes(search.toLowerCase())
    const matchCat = categoryFilter === 'all' || p.category === categoryFilter
    const matchStatus = statusFilter === 'all' || getStatus(p) === statusFilter
    return matchSearch && matchCat && matchStatus
  })

  const alerts = [...critical, ...low]

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Estoque</h1>
          <p className="text-muted-foreground text-sm">Produtos de limpeza e estética automotiva</p>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="w-4 h-4"/>Novo Produto</Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
            <Package className="w-5 h-5 text-blue-600"/>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Itens ativos</p>
            <p className="text-2xl font-bold">{active.length}</p>
          </div>
        </div>

        <button
          onClick={() => setStatusFilter(statusFilter === 'critical' ? 'all' : 'critical')}
          className={cn('rounded-xl border p-4 flex items-center gap-3 text-left transition-all', critical.length > 0 ? 'bg-red-50 border-red-200 hover:border-red-400' : 'bg-card hover:border-gray-300', statusFilter === 'critical' && 'ring-2 ring-red-400')}>
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
            <XCircle className="w-5 h-5 text-red-600"/>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Crítico (zerado)</p>
            <p className={cn('text-2xl font-bold', critical.length > 0 ? 'text-red-600' : 'text-foreground')}>{critical.length}</p>
          </div>
        </button>

        <button
          onClick={() => setStatusFilter(statusFilter === 'low' ? 'all' : 'low')}
          className={cn('rounded-xl border p-4 flex items-center gap-3 text-left transition-all', low.length > 0 ? 'bg-orange-50 border-orange-200 hover:border-orange-400' : 'bg-card hover:border-gray-300', statusFilter === 'low' && 'ring-2 ring-orange-400')}>
          <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-orange-500"/>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Estoque baixo</p>
            <p className={cn('text-2xl font-bold', low.length > 0 ? 'text-orange-600' : 'text-foreground')}>{low.length}</p>
          </div>
        </button>

        <div className="bg-card rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">Valor em estoque</p>
          <p className="text-xl font-bold text-green-600">
            {totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            margem: {margin.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </p>
        </div>
      </div>

      {/* Painel de alertas */}
      {alerts.length > 0 && (
        <div className="rounded-2xl border-2 border-red-200 bg-gradient-to-br from-red-50 to-orange-50 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-red-100">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0"/>
            <p className="font-bold text-red-900">
              {alerts.length} produto{alerts.length > 1 ? 's' : ''} precisam de reposição
            </p>
            <span className="ml-auto text-xs text-red-600 font-medium">
              {critical.length} crítico{critical.length !== 1 ? 's' : ''} · {low.length} abaixo do mínimo
            </span>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {alerts.map(p => {
              const status = getStatus(p)
              const cfg = STATUS_CONFIG[status]
              const Icon = cfg.icon
              const max = Math.max(p.min_stock * 2, p.stock_quantity, 1)
              const pct = Math.min(100, (p.stock_quantity / max) * 100)
              return (
                <div key={p.id} className={cn('bg-white rounded-xl p-3 border flex flex-col gap-2', status === 'critical' ? 'border-red-200' : 'border-orange-200')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className={cn('w-4 h-4 shrink-0', cfg.iconColor)}/>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{CATEGORIES.find(c => c.value === p.category)?.label}</p>
                      </div>
                    </div>
                    <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-bold border shrink-0', cfg.badge)}>
                      {cfg.label}
                    </span>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Atual: <strong>{p.stock_quantity}{p.unit}</strong></span>
                      <span>Mínimo: <strong>{p.min_stock}{p.unit}</strong></span>
                    </div>
                    <div className={cn('h-2 rounded-full overflow-hidden', cfg.barBg)}>
                      <div className={cn('h-full rounded-full transition-all', cfg.bar)} style={{ width: `${pct}%` }}/>
                    </div>
                  </div>
                  <Button size="sm" variant="outline"
                    className={cn('w-full gap-1.5 text-xs h-7', status === 'critical' ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-orange-200 text-orange-700 hover:bg-orange-50')}
                    onClick={() => { setRestockProduct(p); setRestockQty('') }}>
                    <ShoppingCart className="w-3 h-3"/>Repor estoque
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
          <Input className="pl-9" placeholder="Buscar produto ou SKU..." value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Categoria"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as FilterStatus)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="critical">🔴 Crítico</SelectItem>
            <SelectItem value="low">🟠 Baixo</SelectItem>
            <SelectItem value="ok">🟢 OK</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid de produtos */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-36 bg-muted rounded-xl animate-pulse"/>)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-card rounded-xl border">
          <Package className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3"/>
          <p className="text-muted-foreground">Nenhum produto encontrado</p>
          <Button className="mt-4 gap-2" onClick={openNew}><Plus className="w-4 h-4"/>Cadastrar primeiro produto</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(p => {
            const status = getStatus(p)
            const cfg = STATUS_CONFIG[status]
            const Icon = cfg.icon
            const max = Math.max(p.min_stock * 2, p.stock_quantity, 1)
            const pct = Math.min(100, (p.stock_quantity / max) * 100)
            return (
              <div key={p.id} className={cn(
                'bg-card rounded-2xl border overflow-hidden flex flex-col transition-all hover:shadow-md',
                !p.active && 'opacity-50',
                status === 'critical' && p.active && 'border-red-300',
                status === 'low' && p.active && 'border-orange-300',
              )}>
                {/* Top bar */}
                <div className={cn('h-1', status === 'critical' ? 'bg-red-400' : status === 'low' ? 'bg-orange-400' : 'bg-green-400')}/>

                <div className="p-4 flex-1 space-y-3">
                  {/* Nome + categoria */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm leading-tight truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{CATEGORIES.find(c => c.value === p.category)?.label}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Icon className={cn('w-4 h-4', cfg.iconColor)}/>
                    </div>
                  </div>

                  {/* Barra de estoque */}
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span className={cn('font-bold', status === 'critical' ? 'text-red-600' : status === 'low' ? 'text-orange-600' : 'text-foreground')}>
                        {p.stock_quantity} {p.unit}
                      </span>
                      {p.min_stock > 0 && <span>mín: {p.min_stock}{p.unit}</span>}
                    </div>
                    <div className={cn('h-2 rounded-full overflow-hidden', cfg.barBg)}>
                      <div className={cn('h-full rounded-full transition-all', cfg.bar)} style={{ width: `${pct}%` }}/>
                    </div>
                  </div>

                  {/* Preços */}
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Custo: {p.cost_price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                    <span className="font-semibold text-green-700">{p.sale_price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                  </div>
                </div>

                {/* Ações */}
                <div className="px-4 pb-3 flex items-center gap-2">
                  {p.active && (status === 'critical' || status === 'low') && (
                    <Button size="sm" variant="outline"
                      className={cn('flex-1 gap-1 text-xs h-7', status === 'critical' ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-orange-200 text-orange-700 hover:bg-orange-50')}
                      onClick={() => { setRestockProduct(p); setRestockQty('') }}>
                      <PlusCircle className="w-3 h-3"/>Repor
                    </Button>
                  )}
                  <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" title="Editar">
                    <Pencil className="w-3.5 h-3.5"/>
                  </button>
                  <button onClick={() => toggleActive(p)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" title={p.active ? 'Desativar' : 'Ativar'}>
                    {p.active ? <ToggleRight className="w-4 h-4 text-green-600"/> : <ToggleLeft className="w-4 h-4 text-gray-400"/>}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal Repor Estoque */}
      <Dialog open={!!restockProduct} onOpenChange={() => setRestockProduct(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-blue-600"/>Repor Estoque
            </DialogTitle>
          </DialogHeader>
          {restockProduct && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-xl">
                <p className="font-semibold">{restockProduct.name}</p>
                <p className="text-sm text-muted-foreground">
                  Atual: <strong>{restockProduct.stock_quantity} {restockProduct.unit}</strong>
                  {restockProduct.min_stock > 0 && <> · Mínimo: <strong>{restockProduct.min_stock} {restockProduct.unit}</strong></>}
                </p>
              </div>
              <div>
                <Label>Quantidade a adicionar ({restockProduct.unit})</Label>
                <Input type="number" min={1} step={0.01} className="mt-1.5"
                  placeholder={`Ex: ${restockProduct.min_stock > 0 ? restockProduct.min_stock * 2 : 10}`}
                  value={restockQty} onChange={e => setRestockQty(e.target.value)} autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleRestock()} />
                {restockQty && Number(restockQty) > 0 && (
                  <p className="text-xs text-green-700 mt-1.5">
                    Novo total: <strong>{restockProduct.stock_quantity + Number(restockQty)} {restockProduct.unit}</strong>
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setRestockProduct(null)}>Cancelar</Button>
                <Button className="flex-1 gap-2" onClick={handleRestock} disabled={restocking || !restockQty || Number(restockQty) <= 0}>
                  <PlusCircle className="w-4 h-4"/>
                  {restocking ? 'Salvando…' : 'Confirmar'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Cadastro / Edição */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Produto' : 'Novo Produto'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Nome *</Label>
                <Input {...register('name')} placeholder="Ex: Shampoo Automotivo 1L"/>
                {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <Label>Categoria</Label>
                <Controller name="category" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                )}/>
              </div>
              <div>
                <Label>Unidade</Label>
                <Controller name="unit" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                  </Select>
                )}/>
              </div>
              <div>
                <Label>SKU / Código</Label>
                <Input {...register('sku')} placeholder="Opcional"/>
              </div>
              <div>
                <Label>Qtd em estoque</Label>
                <Input {...register('stock_quantity')} type="number" step="0.01"/>
              </div>
              <div>
                <Label>Estoque mínimo</Label>
                <Input {...register('min_stock')} type="number" step="0.01"/>
                <p className="text-xs text-muted-foreground mt-1">Alerta quando atingir este valor</p>
              </div>
              <div>
                <Label>Preço de custo (R$)</Label>
                <Input {...register('cost_price')} type="number" step="0.01"/>
              </div>
              <div>
                <Label>Preço de venda (R$)</Label>
                <Input {...register('sale_price')} type="number" step="0.01"/>
              </div>
              <div className="col-span-2">
                <Label>Descrição</Label>
                <Input {...register('description')} placeholder="Opcional"/>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setModalOpen(false)}>Cancelar</Button>
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
