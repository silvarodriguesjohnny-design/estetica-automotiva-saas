import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { sendWhatsAppMessage, sanitizePhone } from '@/lib/evolution/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { Plus, Send, Calendar, Users, MessageSquare, ChevronRight, BarChart2, Clock, Filter, Star } from 'lucide-react'
import { z } from 'zod'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

interface Campaign {
  id: string
  name: string
  message: string
  status: string
  target: string
  segment_type: string
  segment_conditions: Record<string, unknown>
  template_id: string | null
  estimated_recipients: number
  scheduled_at: string | null
  sent_count: number
  created_at: string
}

interface Template { id: string; name: string; content: string; category: string }
interface Customer { id: string; name: string; phone: string | null }

const SEGMENT_TYPES = [
  { value: 'all_active', label: 'Todos os clientes ativos', icon: '👥' },
  { value: 'inactive_30d', label: 'Inativos há 30+ dias', icon: '⏰' },
  { value: 'inactive_45d', label: 'Inativos há 45+ dias', icon: '🟡' },
  { value: 'inactive_60d', label: 'Inativos há 60+ dias', icon: '🟠' },
  { value: 'inactive_90d', label: 'Inativos há 90+ dias', icon: '🔴' },
  { value: 'birthday', label: 'Aniversariantes do mês', icon: '🎂' },
  { value: 'high_ticket', label: 'Clientes alto valor', icon: '💎' },
  { value: 'new_clients', label: 'Clientes novos (30d)', icon: '🌟' },
]

const schema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres'),
  segment_type: z.string(),
  message: z.string().min(5, 'Mensagem muito curta'),
  template_id: z.string().optional(),
  send_when: z.enum(['now', 'scheduled']),
  scheduled_at: z.string().optional(),
  min_visits: z.coerce.number().min(0).optional(),
  min_ticket: z.coerce.number().min(0).optional(),
})
type FormData = z.infer<typeof schema>

export default function Campanhas() {
  const { tenant: company } = useAuth()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [previewCustomers, setPreviewCustomers] = useState<Customer[]>([])
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendProgress, setSendProgress] = useState(0)
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null)

  const { register, handleSubmit, reset, control, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { segment_type: 'all_active', send_when: 'now', min_visits: 0, min_ticket: 0 }
  })

  const segmentType = watch('segment_type')
  const sendWhen = watch('send_when')
  const templateId = watch('template_id')
  const messageVal = watch('message')

  useEffect(() => { if (company?.id) { fetchCampaigns(); fetchTemplates() } }, [company?.id])

  useEffect(() => {
    if (templateId && templates.length > 0) {
      const tpl = templates.find(t => t.id === templateId)
      if (tpl) setValue('message', tpl.content)
    }
  }, [templateId, templates])

  useEffect(() => {
    if (company?.id && segmentType) previewAudience()
  }, [segmentType, company?.id])

  async function fetchCampaigns() {
    setLoading(true)
    const { data } = await supabase.from('campaigns').select('*').eq('tenant_id', company!.id).order('created_at', { ascending: false })
    setCampaigns(data || [])
    setLoading(false)
  }

  async function fetchTemplates() {
    const { data } = await supabase
      .from('message_templates')
      .select('id, name, content, category')
      .or(`company_id.eq.${company!.id},company_id.is.null`)
      .eq('active', true)
    setTemplates(data || [])
  }

  async function previewAudience() {
    if (!company?.id || !segmentType) return
    setLoadingPreview(true)
    try {
      const { data: customers } = await supabase.from('customers').select('id, name, phone').eq('tenant_id', company!.id)
      const { data: orders } = await supabase.from('service_orders').select('customer_id, created_at').eq('tenant_id', company!.id)

      const now = new Date()
      const lastOrderMap: Record<string, Date> = {}
      ;(orders || []).forEach(o => {
        const d = new Date(o.created_at)
        if (!lastOrderMap[o.customer_id] || d > lastOrderMap[o.customer_id]) lastOrderMap[o.customer_id] = d
      })

      let result: Customer[] = []
      switch (segmentType) {
        case 'all_active':
          result = (customers || []).filter(c => c.phone)
          break
        case 'inactive_30d':
        case 'inactive_45d':
        case 'inactive_60d':
        case 'inactive_90d': {
          const days = parseInt(segmentType.replace('inactive_','').replace('d',''))
          result = (customers || []).filter(c => {
            if (!c.phone) return false
            const last = lastOrderMap[c.id]
            if (!last) return true
            return (now.getTime() - last.getTime()) / 86400000 >= days
          })
          break
        }
        case 'new_clients': {
          const cutoff = new Date(now.getTime() - 30 * 86400000)
          const newCustomerIds = Object.entries(lastOrderMap)
            .filter(([, d]) => d >= cutoff)
            .map(([id]) => id)
          result = (customers || []).filter(c => c.phone && newCustomerIds.includes(c.id))
          break
        }
        case 'high_ticket': {
          const ticketMap: Record<string, number[]> = {}
          ;(orders || []).forEach(o => {
            if (!ticketMap[o.customer_id]) ticketMap[o.customer_id] = []
          })
          result = (customers || []).filter(c => c.phone && (ticketMap[c.id]?.length || 0) >= 3)
          break
        }
        default:
          result = (customers || []).filter(c => c.phone)
      }
      setPreviewCustomers(result)
    } finally {
      setLoadingPreview(false)
    }
  }

  function openNew() {
    reset({ segment_type: 'all_active', send_when: 'now', min_visits: 0, min_ticket: 0 })
    setPreviewCustomers([])
    setModalOpen(true)
  }

  async function onSubmit(data: FormData) {
    const estimated = previewCustomers.length
    const payload = {
      tenant_id: company!.id,
      name: data.name,
      message: data.message,
      target: data.segment_type,
      segment_type: data.segment_type,
      template_id: data.template_id || null,
      estimated_recipients: estimated,
      scheduled_at: data.send_when === 'scheduled' ? data.scheduled_at : null,
      status: data.send_when === 'scheduled' ? 'scheduled' : 'draft',
      sent_count: 0,
    }

    const { data: newCamp, error } = await supabase.from('campaigns').insert(payload).select().single()
    if (error) { toast.error('Erro ao criar campanha'); return }
    toast.success(`Campanha "${data.name}" criada! ${estimated} destinatários.`)
    setModalOpen(false)
    fetchCampaigns()

    // Se enviar agora, dispara imediatamente
    if (data.send_when === 'now') {
      await executeSend(newCamp, data.message, previewCustomers)
    }
  }

  async function executeSend(campaign: Campaign, message: string, customers: Customer[]) {
    setSending(true)
    setActiveCampaignId(campaign.id)
    setSendProgress(0)
    let sent = 0
    const withPhone = customers.filter(c => c.phone)

    for (let i = 0; i < withPhone.length; i++) {
      const c = withPhone[i]
      try {
        const phone = sanitizePhone(c.phone!)
        const msg = message.replace(/\{nome\}/g, c.name).replace(/\{empresa\}/g, company?.name || '')
        await sendWhatsAppMessage(company!.id, phone, msg)
        sent++
      } catch {}
      setSendProgress(Math.round(((i + 1) / withPhone.length) * 100))
      if (i < withPhone.length - 1) await new Promise(r => setTimeout(r, 1500))
    }

    await supabase.from('campaigns').update({ status: 'sent', sent_count: sent }).eq('id', campaign.id)
    toast.success(`Campanha enviada! ${sent}/${withPhone.length} mensagens entregues.`)
    setSending(false)
    setActiveCampaignId(null)
    fetchCampaigns()
  }

  const statusColor: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    scheduled: 'bg-blue-100 text-blue-700',
    sending: 'bg-yellow-100 text-yellow-700',
    sent: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
  }

  const statusLabel: Record<string, string> = {
    draft: 'Rascunho', scheduled: 'Agendada', sending: 'Enviando', sent: 'Enviada', error: 'Erro'
  }

  const totalSent = campaigns.filter(c => c.status === 'sent').reduce((s, c) => s + (c.sent_count || 0), 0)
  const scheduled = campaigns.filter(c => c.status === 'scheduled').length

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Campanhas</h1>
          <p className="text-gray-500 text-sm">Envios em massa segmentados por WhatsApp</p>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="w-4 h-4"/>Nova Campanha</Button>
      </div>

      {/* Cards resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <MessageSquare className="w-8 h-8 text-blue-500"/>
          <div><p className="text-xs text-gray-500">Total campanhas</p><p className="text-2xl font-bold">{campaigns.length}</p></div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <Send className="w-8 h-8 text-green-500"/>
          <div><p className="text-xs text-gray-500">Mensagens enviadas</p><p className="text-2xl font-bold text-green-700">{totalSent}</p></div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <Clock className="w-8 h-8 text-purple-500"/>
          <div><p className="text-xs text-gray-500">Agendadas</p><p className="text-2xl font-bold text-purple-700">{scheduled}</p></div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <BarChart2 className="w-8 h-8 text-orange-500"/>
          <div><p className="text-xs text-gray-500">Campanhas enviadas</p><p className="text-2xl font-bold">{campaigns.filter(c=>c.status==='sent').length}</p></div>
        </div>
      </div>

      {/* Lista de campanhas */}
      <div className="space-y-3">
        {loading ? (
          <p className="text-center py-8 text-gray-400">Carregando...</p>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border">
            <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3"/>
            <p className="text-gray-500">Nenhuma campanha ainda.</p>
            <Button className="mt-4 gap-2" onClick={openNew}><Plus className="w-4 h-4"/>Criar primeira campanha</Button>
          </div>
        ) : campaigns.map(c => (
          <div key={c.id} className="bg-white rounded-xl border p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-gray-900">{c.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[c.status] || 'bg-gray-100 text-gray-700'}`}>
                    {statusLabel[c.status] || c.status}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-1 truncate">{c.message}</p>
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Filter className="w-3 h-3"/>
                    {SEGMENT_TYPES.find(s=>s.value===c.segment_type)?.label || c.segment_type || c.target}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3"/>
                    {c.status === 'sent' ? `${c.sent_count} enviadas` : `~${c.estimated_recipients} destinatários`}
                  </span>
                  {c.scheduled_at && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3"/>
                      {new Date(c.scheduled_at).toLocaleString('pt-BR')}
                    </span>
                  )}
                  <span>{new Date(c.created_at).toLocaleDateString('pt-BR')}</span>
                </div>
                {activeCampaignId === c.id && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Enviando mensagens...</span><span>{sendProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${sendProgress}%` }}/>
                    </div>
                  </div>
                )}
              </div>
              {c.status === 'draft' && (
                <Button size="sm" className="gap-1.5 shrink-0" onClick={async()=>{
                  const { data: custs } = await supabase.from('customers').select('id, name, phone').eq('tenant_id', company!.id).not('phone', 'is', null)
                  await executeSend(c, c.message, custs || [])
                }} disabled={sending}>
                  <Send className="w-3.5 h-3.5"/>Enviar agora
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modal nova campanha */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Campanha</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Nome */}
            <div>
              <Label>Nome da campanha *</Label>
              <Input {...register('name')} placeholder="Ex: Reativação agosto 2026"/>
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
            </div>

            {/* Segmento */}
            <div>
              <Label className="flex items-center gap-1"><Filter className="w-4 h-4"/>Segmento de destinatários *</Label>
              <Controller name="segment_type" control={control} render={({field})=>(
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {SEGMENT_TYPES.map(s=>(
                    <button key={s.value} type="button"
                      onClick={()=>field.onChange(s.value)}
                      className={`text-left p-3 rounded-lg border text-sm transition-all ${field.value===s.value ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200 hover:border-gray-300'}`}>
                      <span className="mr-1.5">{s.icon}</span>{s.label}
                    </button>
                  ))}
                </div>
              )}/>
            </div>

            {/* Preview de destinatários */}
            <div className="bg-gray-50 rounded-xl p-4 border">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4"/>Pré-visualização do público
                </h4>
                <Badge variant="outline">{loadingPreview ? '...' : `${previewCustomers.length} contatos`}</Badge>
              </div>
              {previewCustomers.length === 0 ? (
                <p className="text-xs text-gray-500">Nenhum cliente corresponde a este segmento.</p>
              ) : (
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {previewCustomers.slice(0,8).map(c=>(
                    <div key={c.id} className="flex items-center gap-2 text-xs text-gray-700">
                      <ChevronRight className="w-3 h-3 text-gray-400"/>{c.name}
                      <span className="text-gray-400">{c.phone}</span>
                    </div>
                  ))}
                  {previewCustomers.length > 8 && (
                    <p className="text-xs text-gray-400 pl-5">+ {previewCustomers.length - 8} mais...</p>
                  )}
                </div>
              )}
            </div>

            {/* Template */}
            <div>
              <Label className="flex items-center gap-1"><Star className="w-4 h-4"/>Usar template pronto (opcional)</Label>
              <Controller name="template_id" control={control} render={({field})=>(
                <Select value={field.value || ''} onValueChange={v=>field.onChange(v||undefined)}>
                  <SelectTrigger><SelectValue placeholder="Escolher template..."/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Escrever mensagem manual</SelectItem>
                    {templates.map(t=><SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}/>
            </div>

            {/* Mensagem */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Mensagem *</Label>
                <span className="text-xs text-gray-400">{messageVal?.length || 0} chars</span>
              </div>
              <Textarea {...register('message')} rows={4} placeholder="Olá {nome}! Temos uma novidade especial para você..." className="resize-none"/>
              {errors.message && <p className="text-red-500 text-xs mt-1">{errors.message.message}</p>}
              <p className="text-xs text-gray-400 mt-1">Variáveis: {'{nome}'}, {'{empresa}'}</p>
            </div>

            {/* Quando enviar */}
            <div>
              <Label>Quando enviar?</Label>
              <Controller name="send_when" control={control} render={({field})=>(
                <div className="flex gap-3 mt-2">
                  <button type="button" onClick={()=>field.onChange('now')}
                    className={`flex-1 p-3 rounded-lg border text-sm ${field.value==='now' ? 'border-green-500 bg-green-50 text-green-800' : 'border-gray-200'}`}>
                    <Send className="w-4 h-4 mx-auto mb-1"/>Enviar agora
                  </button>
                  <button type="button" onClick={()=>field.onChange('scheduled')}
                    className={`flex-1 p-3 rounded-lg border text-sm ${field.value==='scheduled' ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200'}`}>
                    <Calendar className="w-4 h-4 mx-auto mb-1"/>Agendar
                  </button>
                </div>
              )}/>
              {sendWhen === 'scheduled' && (
                <div className="mt-2">
                  <Label>Data e hora</Label>
                  <Input {...register('scheduled_at')} type="datetime-local" className="mt-1"/>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2 border-t">
              <Button type="button" variant="outline" className="flex-1" onClick={()=>setModalOpen(false)}>Cancelar</Button>
              <Button type="submit" className="flex-1 gap-2" disabled={isSubmitting || previewCustomers.length === 0}>
                {sendWhen === 'now' ? <><Send className="w-4 h-4"/>Criar e Enviar</> : <><Calendar className="w-4 h-4"/>Agendar Campanha</>}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
