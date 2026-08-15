import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/lib/supabase/client'
import { Plus, Search, Wrench, Phone, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import type { Technician } from '@/types'
import { SERVICE_CATEGORIES } from '@/types'

const techSchema = z.object({
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
  phone: z.string().optional(),
  specialty: z.array(z.string()).default([]),
})

type TechForm = z.infer<typeof techSchema>

export default function Tecnicos() {
  const { tenant } = useAuth()
  const [technicians, setTechnicians] = useState<Technician[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Technician | null>(null)
  const [saving, setSaving] = useState(false)
  const [orderCounts, setOrderCounts] = useState<Record<string, number>>({})

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<TechForm>({
    resolver: zodResolver(techSchema),
    defaultValues: { specialty: [] },
  })

  const selectedSpecialties = watch('specialty') ?? []

  useEffect(() => {
    if (!tenant) return
    fetchData()
  }, [tenant])

  const fetchData = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('technicians')
      .select('*')
      .order('name')
    setTechnicians((data as Technician[]) ?? [])

    // OS por técnico (últimos 30 dias)
    const { data: orders } = await supabase
      .from('service_orders')
      .select('technician_id')
      .eq('status', 'completed')
      .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())

    const counts: Record<string, number> = {}
    orders?.forEach(o => {
      if (o.technician_id) counts[o.technician_id] = (counts[o.technician_id] ?? 0) + 1
    })
    setOrderCounts(counts)
    setLoading(false)
  }

  const openCreate = () => {
    setEditing(null)
    reset({ name: '', phone: '', specialty: [] })
    setModalOpen(true)
  }

  const openEdit = (t: Technician) => {
    setEditing(t)
    reset({ name: t.name, phone: t.phone ?? '', specialty: t.specialty ?? [] })
    setModalOpen(true)
  }

  const toggleSpecialty = (value: string) => {
    const current = selectedSpecialties
    setValue(
      'specialty',
      current.includes(value) ? current.filter(s => s !== value) : [...current, value]
    )
  }

  const onSubmit = async (data: TechForm) => {
    setSaving(true)
    try {
      const payload = {
        tenant_id: tenant!.id,
        name: data.name,
        phone: data.phone || null,
        specialty: data.specialty,
        is_active: true,
      }

      if (editing) {
        const { error } = await supabase.from('technicians').update(payload).eq('id', editing.id)
        if (error) throw error
        toast.success('Técnico atualizado!')
      } else {
        const { error } = await supabase.from('technicians').insert(payload)
        if (error) throw error
        toast.success('Técnico cadastrado!')
      }

      setModalOpen(false)
      fetchData()
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar técnico')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (t: Technician) => {
    await supabase.from('technicians').update({ is_active: !t.is_active }).eq('id', t.id)
    setTechnicians(prev => prev.map(tech => tech.id === t.id ? { ...tech, is_active: !t.is_active } : tech))
  }

  const filtered = technicians.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Técnicos</h1>
          <p className="text-sm text-muted-foreground">{technicians.filter(t => t.is_active).length} ativos</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Novo Técnico
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar técnico..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-36 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Wrench className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Nenhum técnico cadastrado</p>
            <Button className="mt-4" onClick={openCreate}>Cadastrar técnico</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(t => (
            <Card key={t.id} className={!t.is_active ? 'opacity-60' : ''}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                      <span className="font-bold text-primary text-sm">
                        {t.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p
                        className="font-semibold text-sm cursor-pointer hover:text-primary"
                        onClick={() => openEdit(t)}
                      >
                        {t.name}
                      </p>
                      {t.phone && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3" /> {t.phone}
                        </div>
                      )}
                    </div>
                  </div>
                  <Switch
                    checked={t.is_active}
                    onCheckedChange={() => toggleActive(t)}
                    aria-label="Ativo"
                  />
                </div>

                {t.specialty && t.specialty.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {t.specialty.map(s => (
                      <Badge key={s} variant="secondary" className="text-[10px]">
                        {SERVICE_CATEGORIES.find(c => c.value === s)?.label ?? s}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Star className="h-3 w-3" />
                  {orderCounts[t.id] ?? 0} OS concluídas (30 dias)
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Técnico' : 'Novo Técnico'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input placeholder="João da Silva" {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Telefone</Label>
              <Input placeholder="(11) 99999-9999" {...register('phone')} />
            </div>
            <div className="space-y-2">
              <Label>Especialidades</Label>
              <div className="grid grid-cols-2 gap-2">
                {SERVICE_CATEGORIES.map(({ value, label }) => (
                  <div key={value} className="flex items-center gap-2">
                    <Checkbox
                      id={value}
                      checked={selectedSpecialties.includes(value)}
                      onCheckedChange={() => toggleSpecialty(value)}
                    />
                    <label htmlFor={value} className="text-sm cursor-pointer">{label}</label>
                  </div>
                ))}
              </div>
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
