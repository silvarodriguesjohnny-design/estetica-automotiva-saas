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
import { toast } from 'sonner'
import { Plus, Pencil, Package, AlertTriangle, Search, ToggleLeft, ToggleRight } from 'lucide-react'
import { z } from 'zod'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

interface Product {
  id: string
  name: string
  category: string
  description: string | null
  sku: string | null
  unit: string
  cost_price: number
  sale_price: number
  stock_quantity: number
  min_stock: number
  active: boolean
}

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

export default function Estoque() {
  const { tenant: company } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)

  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { unit: 'un', category: 'outros', cost_price: 0, sale_price: 0, stock_quantity: 0, min_stock: 0 }
  })

  useEffect(() => { if (company?.id) fetchProducts() }, [company?.id])

  async function fetchProducts() {
    setLoading(true)
    const { data } = await supabase.from('products').select('*').eq('tenant_id', company!.id).order('name')
    setProducts(data || [])
    setLoading(false)
  }

  function openNew() {
    setEditing(null)
    reset({ unit: 'un', category: 'outros', cost_price: 0, sale_price: 0, stock_quantity: 0, min_stock: 0 })
    setModalOpen(true)
  }

  function openEdit(p: Product) {
    setEditing(p)
    reset({ name: p.name, category: p.category, description: p.description || '', sku: p.sku || '',
      unit: p.unit, cost_price: p.cost_price, sale_price: p.sale_price,
      stock_quantity: p.stock_quantity, min_stock: p.min_stock })
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

  const filtered = products.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.sku || '').toLowerCase().includes(search.toLowerCase())
    const matchCat = categoryFilter === 'all' || p.category === categoryFilter
    return matchSearch && matchCat
  })

  const lowStock = products.filter(p => p.active && p.stock_quantity <= p.min_stock && p.min_stock > 0)
  const totalValue = products.filter(p => p.active).reduce((s, p) => s + p.stock_quantity * p.cost_price, 0)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Estoque</h1>
          <p className="text-gray-500 text-sm">Produtos de limpeza e estética automotiva</p>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="w-4 h-4"/>Novo Produto</Button>
      </div>

      {/* Cards resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-3">
            <Package className="w-8 h-8 text-blue-500"/>
            <div>
              <p className="text-sm text-gray-500">Total de itens</p>
              <p className="text-2xl font-bold">{products.filter(p=>p.active).length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-orange-500"/>
            <div>
              <p className="text-sm text-gray-500">Estoque baixo</p>
              <p className="text-2xl font-bold text-orange-600">{lowStock.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div>
            <p className="text-sm text-gray-500">Valor em estoque</p>
            <p className="text-2xl font-bold text-green-600">
              {totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>
          </div>
        </div>
      </div>

      {/* Alertas estoque baixo */}
      {lowStock.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0"/>
          <p className="text-sm text-orange-800">
            <strong>{lowStock.length} produto(s)</strong> com estoque abaixo do mínimo: {lowStock.map(p=>p.name).join(', ')}
          </p>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
          <Input className="pl-9" placeholder="Buscar produto ou SKU..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Categoria"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {CATEGORIES.map(c=><SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Qtd</TableHead>
              <TableHead>Custo</TableHead>
              <TableHead>Venda</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">Carregando...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">Nenhum produto encontrado</TableCell></TableRow>
            ) : filtered.map(p => (
              <TableRow key={p.id} className={!p.active ? 'opacity-50' : undefined}>
                <TableCell>
                  <div>
                    <p className="font-medium">{p.name}</p>
                    {p.description && <p className="text-xs text-gray-400">{p.description}</p>}
                    {p.stock_quantity <= p.min_stock && p.min_stock > 0 && p.active && (
                      <Badge variant="destructive" className="text-xs mt-1">Estoque baixo</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{CATEGORIES.find(c=>c.value===p.category)?.label || p.category}</Badge>
                </TableCell>
                <TableCell className="text-gray-500 text-sm">{p.sku || '-'}</TableCell>
                <TableCell>
                  <span className={p.stock_quantity <= p.min_stock && p.min_stock > 0 ? 'text-red-600 font-bold' : ''}>
                    {p.stock_quantity} {p.unit}
                  </span>
                </TableCell>
                <TableCell className="text-sm">{p.cost_price.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</TableCell>
                <TableCell className="font-medium text-green-700">{p.sale_price.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</TableCell>
                <TableCell>
                  <Badge variant={p.active ? 'default' : 'secondary'}>{p.active ? 'Ativo' : 'Inativo'}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="icon" variant="ghost" onClick={()=>openEdit(p)}><Pencil className="w-4 h-4"/></Button>
                    <Button size="icon" variant="ghost" onClick={()=>toggleActive(p)}>
                      {p.active ? <ToggleRight className="w-4 h-4 text-green-600"/> : <ToggleLeft className="w-4 h-4 text-gray-400"/>}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Modal cadastro/edição */}
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
                <Controller name="category" control={control} render={({field})=>(
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>{CATEGORIES.map(c=><SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                )}/>
              </div>
              <div>
                <Label>Unidade</Label>
                <Controller name="unit" control={control} render={({field})=>(
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>{UNITS.map(u=><SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
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
              </div>
              <div>
                <Label>Preço de custo (R$)</Label>
                <Input {...register('cost_price')} type="number" step="0.01"/>
              </div>
              <div>
                <Label>Preço de venda (R$)</Label>
                <Input {...register('sale_price')} type="number" step="0.01"/>
                {errors.sale_price && <p className="text-red-500 text-xs mt-1">{errors.sale_price.message}</p>}
              </div>
              <div className="col-span-2">
                <Label>Descrição</Label>
                <Input {...register('description')} placeholder="Opcional"/>
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
