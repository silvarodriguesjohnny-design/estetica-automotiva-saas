import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/lib/supabase/client'
import { Plus, Search, Car } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import type { Vehicle, Customer } from '@/types'

const vehicleSchema = z.object({
  customer_id: z.string().min(1, 'Selecione um cliente'),
  brand: z.string().min(1, 'Informe a marca'),
  model: z.string().min(1, 'Informe o modelo'),
  year: z.coerce.number().optional(),
  color: z.string().optional(),
  plate: z.string().optional(),
  vin: z.string().optional(),
  fuel_type: z.string().optional(),
  notes: z.string().optional(),
})

type VehicleForm = z.infer<typeof vehicleSchema>

const FUEL_TYPES = [
  { value: 'gasolina', label: 'Gasolina' },
  { value: 'etanol', label: 'Etanol' },
  { value: 'flex', label: 'Flex' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'eletrico', label: 'Elétrico' },
  { value: 'hibrido', label: 'Híbrido' },
]

const CAR_BRANDS = [
  'Toyota', 'Honda', 'Volkswagen', 'Chevrolet', 'Ford', 'Fiat', 'Hyundai',
  'Nissan', 'Renault', 'Jeep', 'BMW', 'Mercedes-Benz', 'Audi', 'Volvo',
  'Peugeot', 'Citroën', 'Mitsubishi', 'Kia', 'Subaru', 'Porsche', 'Ferrari',
  'Lamborghini', 'Land Rover', 'Jaguar', 'Outro'
]

export default function Veiculos() {
  const { tenant } = useAuth()
  const [vehicles, setVehicles] = useState<(Vehicle & { customer?: Pick<Customer, 'id' | 'name'> })[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [saving, setSaving] = useState(false)

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<VehicleForm>({
    resolver: zodResolver(vehicleSchema),
  })

  useEffect(() => {
    if (!tenant) return
    fetchData()
  }, [tenant])

  const fetchData = async () => {
    setLoading(true)
    const [vRes, cRes] = await Promise.all([
      supabase.from('vehicles').select('*, customer:customers(id, name)').order('created_at', { ascending: false }),
      supabase.from('customers').select('*').order('name'),
    ])
    setVehicles((vRes.data as any[]) ?? [])
    setCustomers((cRes.data as Customer[]) ?? [])
    setLoading(false)
  }

  const openCreate = () => {
    setEditing(null)
    reset({})
    setModalOpen(true)
  }

  const openEdit = (v: Vehicle) => {
    setEditing(v)
    reset({
      customer_id: v.customer_id,
      brand: v.brand,
      model: v.model,
      year: v.year ?? undefined,
      color: v.color ?? '',
      plate: v.plate ?? '',
      vin: v.vin ?? '',
      fuel_type: v.fuel_type ?? '',
      notes: v.notes ?? '',
    })
    setModalOpen(true)
  }

  const onSubmit = async (data: VehicleForm) => {
    setSaving(true)
    try {
      const payload = {
        tenant_id: tenant!.id,
        customer_id: data.customer_id,
        brand: data.brand,
        model: data.model,
        year: data.year || null,
        color: data.color || null,
        plate: data.plate ? data.plate.toUpperCase() : null,
        vin: data.vin || null,
        fuel_type: data.fuel_type || null,
        notes: data.notes || null,
      }

      if (editing) {
        const { error } = await supabase.from('vehicles').update(payload).eq('id', editing.id)
        if (error) throw error
        toast.success('Veículo atualizado!')
      } else {
        const { error } = await supabase.from('vehicles').insert(payload)
        if (error) throw error
        toast.success('Veículo cadastrado!')
      }

      setModalOpen(false)
      fetchData()
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar veículo')
    } finally {
      setSaving(false)
    }
  }

  const filtered = vehicles.filter(v =>
    `${v.brand} ${v.model}`.toLowerCase().includes(search.toLowerCase()) ||
    v.plate?.toLowerCase().includes(search.toLowerCase()) ||
    (v as any).customer?.name.toLowerCase().includes(search.toLowerCase())
  )

  const brandColors: Record<string, string> = {
    Toyota: 'bg-red-100 text-red-700',
    Honda: 'bg-blue-100 text-blue-700',
    BMW: 'bg-sky-100 text-sky-700',
    Mercedes: 'bg-slate-100 text-slate-700',
    default: 'bg-primary/10 text-primary',
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Veículos</h1>
          <p className="text-sm text-muted-foreground">{vehicles.length} veículos cadastrados</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Novo Veículo
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por marca, modelo, placa ou cliente..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Car className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Nenhum veículo encontrado</p>
            <Button className="mt-4" onClick={openCreate}>Cadastrar primeiro veículo</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(v => (
            <Card
              key={v.id}
              className="hover:shadow-sm transition-shadow cursor-pointer"
              onClick={() => openEdit(v)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                    <Car className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-sm">{v.brand} {v.model}</p>
                      {v.plate && (
                        <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded border">
                          {v.plate}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(v as any).customer?.name}
                    </p>
                    <div className="flex gap-3 mt-2">
                      {v.year && <span className="text-xs text-muted-foreground">{v.year}</span>}
                      {v.color && <span className="text-xs text-muted-foreground">{v.color}</span>}
                      {v.fuel_type && (
                        <span className="text-xs text-muted-foreground capitalize">{v.fuel_type}</span>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Veículo' : 'Novo Veículo'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Proprietário *</Label>
              <Controller
                name="customer_id"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Marca *</Label>
                <Controller
                  name="brand"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Marca" />
                      </SelectTrigger>
                      <SelectContent>
                        {CAR_BRANDS.map(b => (
                          <SelectItem key={b} value={b}>{b}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.brand && <p className="text-xs text-destructive">{errors.brand.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Modelo *</Label>
                <Input placeholder="Corolla, Civic..." {...register('model')} />
                {errors.model && <p className="text-xs text-destructive">{errors.model.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Ano</Label>
                <Input type="number" placeholder="2023" min="1900" max="2026" {...register('year')} />
              </div>

              <div className="space-y-1.5">
                <Label>Cor</Label>
                <Input placeholder="Prata, Preto..." {...register('color')} />
              </div>

              <div className="space-y-1.5">
                <Label>Placa</Label>
                <Input placeholder="ABC-1234" {...register('plate')} />
              </div>

              <div className="space-y-1.5">
                <Label>Combustível</Label>
                <Controller
                  name="fuel_type"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecionar" />
                      </SelectTrigger>
                      <SelectContent>
                        {FUEL_TYPES.map(f => (
                          <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Chassi / VIN</Label>
              <Input placeholder="9BWZZZ377VT004251" {...register('vin')} />
            </div>

            <div className="space-y-1.5">
              <Label>Observações</Label>
              <Textarea placeholder="Arranhado na porta, película já instalada..." {...register('notes')} rows={2} />
            </div>

            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={saving}>
                {saving ? 'Salvando...' : editing ? 'Atualizar' : 'Cadastrar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
