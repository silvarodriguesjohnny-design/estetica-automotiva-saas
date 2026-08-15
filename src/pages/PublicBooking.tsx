import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import { Car, Clock, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import type { Service, Tenant } from '@/types'

export default function PublicBooking() {
  const { tenantId } = useParams()
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [plate, setPlate] = useState('')
  const [brand, setBrand] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')

  useEffect(() => {
    if (tenantId) fetchTenantData()
  }, [tenantId])

  const fetchTenantData = async () => {
    const [tRes, sRes] = await Promise.all([
      supabase.from('tenants').select('id, name, logo_url, cidade').eq('id', tenantId!).single(),
      supabase.from('services').select('*').eq('tenant_id', tenantId!).eq('is_active', true),
    ])
    setTenant(tRes.data as Tenant)
    setServices((sRes.data as Service[]) ?? [])
    setLoading(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !phone || !serviceId || !date || !time) {
      toast.error('Preencha todos os campos obrigatórios')
      return
    }
    setSaving(true)
    try {
      let customerId: string | null = null
      let vehicleId: string | null = null

      const { data: existingCustomer } = await supabase
        .from('customers').select('id').eq('phone', phone).eq('tenant_id', tenantId!).single()

      if (existingCustomer) {
        customerId = existingCustomer.id
      } else {
        const { data: newCustomer } = await supabase
          .from('customers').insert({ tenant_id: tenantId!, name, phone }).select().single()
        customerId = newCustomer?.id ?? null
      }

      if (customerId && (plate || brand)) {
        const { data: vehicle } = await supabase
          .from('vehicles').insert({ tenant_id: tenantId!, customer_id: customerId, brand: brand || 'Não informado', model: '', plate: plate || null })
          .select().single()
        vehicleId = vehicle?.id ?? null
      }

      if (customerId && vehicleId) {
        const startTime = `${date}T${time}:00`
        const selectedService = services.find(s => s.id === serviceId)
        await supabase.from('service_orders').insert({
          tenant_id: tenantId!, customer_id: customerId, vehicle_id: vehicleId,
          status: 'pending', start_time: startTime,
          total_amount: selectedService?.price ?? 0,
        })
        setSubmitted(true)
      }
    } catch (err: any) {
      toast.error('Erro ao realizar agendamento. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Car className="h-8 w-8 animate-pulse text-primary" /></div>
  if (!tenant) return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Estética não encontrada.</p></div>

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center">
              <Car className="h-6 w-6 text-primary-foreground" />
            </div>
          </div>
          <CardTitle>{tenant.name}</CardTitle>
          <p className="text-sm text-muted-foreground">Agendamento online</p>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="text-center space-y-4 py-6">
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
              <h3 className="font-bold text-lg">Agendamento realizado!</h3>
              <p className="text-muted-foreground text-sm">Entraremos em contato pelo WhatsApp para confirmar.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5"><Label>Seu nome *</Label><Input value={name} onChange={e => setName(e.target.value)} required /></div>
              <div className="space-y-1.5"><Label>WhatsApp *</Label><Input placeholder="(11) 99999-9999" value={phone} onChange={e => setPhone(e.target.value)} required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Marca do carro</Label><Input placeholder="Toyota..." value={brand} onChange={e => setBrand(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Placa</Label><Input placeholder="ABC-1234" value={plate} onChange={e => setPlate(e.target.value)} /></div>
              </div>
              <div className="space-y-1.5">
                <Label>Serviço *</Label>
                <Select value={serviceId} onValueChange={setServiceId}>
                  <SelectTrigger><SelectValue placeholder="Selecionar serviço" /></SelectTrigger>
                  <SelectContent>
                    {services.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} — R$ {s.price.toFixed(2)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Data *</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} required /></div>
                <div className="space-y-1.5"><Label>Horário *</Label><Input type="time" value={time} onChange={e => setTime(e.target.value)} required /></div>
              </div>
              <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Agendando...' : 'Confirmar Agendamento'}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
