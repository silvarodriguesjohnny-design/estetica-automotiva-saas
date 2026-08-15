import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/lib/supabase/client'
import { MessageSquare, Send, Smartphone, CheckCircle, AlertCircle, RefreshCw, Clock, Users, UserX, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { sendWhatsAppMessage, sanitizePhone } from '@/lib/evolution/client'
import { subDays, format } from 'date-fns'
import type { Customer, MessagingConfig } from '@/types'

const sendSchema = z.object({
  message: z.string().min(1, 'Digite a mensagem'),
  target: z.enum(['individual', 'all_active', 'inactive_45d', 'inactive_30d', 'inactive_60d', 'inactive_90d']),
  customer_id: z.string().optional(),
  phone_manual: z.string().optional(),
  send_when: z.enum(['now', 'scheduled']),
  scheduled_at: z.string().optional(),
})
type SendForm = z.infer<typeof sendSchema>

interface InactiveSummary { count: number; withPhone: number }

export default function MensagensWhatsApp() {
  const { tenant } = useAuth()
  const [config, setConfig] = useState<MessagingConfig | null>(null)
  const [instanceStatus, setInstanceStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [instanceName, setInstanceName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [inactiveSummary, setInactiveSummary] = useState<Record<string, InactiveSummary>>({})
  const [sendProgress, setSendProgress] = useState({ sent: 0, total: 0, running: false })

  const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm<SendForm>({
    resolver: zodResolver(sendSchema),
    defaultValues: { target: 'individual', send_when: 'now' },
  })

  const target = watch('target')
  const sendWhen = watch('send_when')

  useEffect(() => { if (tenant) fetchData() }, [tenant])

  const fetchData = async () => {
    setLoading(true)
    const [cRes, mRes] = await Promise.all([
      supabase.from('customers').select('id, name, phone').order('name'),
      supabase.from('messaging_configs').select('*').single(),
    ])
    const allCustomers = (cRes.data as Customer[]) ?? []
    setCustomers(allCustomers)
    if (mRes.data) { setConfig(mRes.data as MessagingConfig); setInstanceName(mRes.data.instance_name ?? '') }

    // Calcular inativos por período
    await computeInactiveSummary(allCustomers)
    setLoading(false)
  }

  const computeInactiveSummary = async (allCustomers: Customer[]) => {
    const { data: orders } = await supabase.from('service_orders').select('customer_id, completed_at, created_at').eq('status', 'completed')
    const lastVisit: Record<string, string> = {}
    orders?.forEach(o => {
      const date = o.completed_at || o.created_at
      if (!lastVisit[o.customer_id] || date > lastVisit[o.customer_id]) lastVisit[o.customer_id] = date
    })

    const now = new Date()
    const result: Record<string, InactiveSummary> = {}
    for (const days of [30, 45, 60, 90]) {
      const key = `inactive_${days}d`
      const cutoff = subDays(now, days)
      const inactive = allCustomers.filter(c => {
        const lv = lastVisit[c.id]
        if (!lv) return false // nunca visitou (ignora)
        return new Date(lv) < cutoff
      })
      result[key] = { count: inactive.length, withPhone: inactive.filter(c => c.phone).length }
    }
    setInactiveSummary(result)
  }

  const saveConfig = async () => {
    setSavingConfig(true)
    try {
      const payload = { tenant_id: tenant!.id, channel: 'whatsapp', instance_name: instanceName, api_key: apiKey || config?.api_key, is_active: true }
      if (config?.id) await supabase.from('messaging_configs').update(payload).eq('id', config.id)
      else await supabase.from('messaging_configs').insert(payload)
      toast.success('Configuração salva!')
      fetchData()
    } catch (err: any) { toast.error(err.message) } finally { setSavingConfig(false) }
  }

  const checkStatus = async () => {
    if (!config?.instance_name) { toast.error('Configure a instância primeiro'); return }
    setInstanceStatus('unknown')
    try {
      const res = await fetch('/functions/v1/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` },
        body: JSON.stringify({ action: 'status', instance: config.instance_name }),
      })
      const d = await res.json()
      setInstanceStatus(d.connected ? 'connected' : 'disconnected')
    } catch { setInstanceStatus('disconnected') }
  }

  const getInactiveCustomers = async (days: number): Promise<Customer[]> => {
    const { data: orders } = await supabase.from('service_orders').select('customer_id, completed_at, created_at').eq('status', 'completed')
    const lastVisit: Record<string, string> = {}
    orders?.forEach(o => { const d = o.completed_at || o.created_at; if (!lastVisit[o.customer_id] || d > lastVisit[o.customer_id]) lastVisit[o.customer_id] = d })
    const cutoff = subDays(new Date(), days)
    return customers.filter(c => { const lv = lastVisit[c.id]; return lv && new Date(lv) < cutoff && c.phone })
  }

  const onSubmit = async (data: SendForm) => {
    if (!config?.instance_name) { toast.error('Configure o WhatsApp primeiro'); return }

    // Scheduled — salva no banco e retorna
    if (data.send_when === 'scheduled' && data.scheduled_at) {
      await supabase.from('campaigns').insert({
        tenant_id: tenant!.id,
        title: `Mensagem agendada para ${format(new Date(data.scheduled_at), 'dd/MM/yyyy HH:mm')}`,
        message_template: data.message,
        auto_trigger: false,
        is_active: false,
        start_date: data.scheduled_at,
      })
      toast.success(`Mensagem agendada para ${format(new Date(data.scheduled_at), 'dd/MM/yyyy HH:mm')}`)
      return
    }

    setSending(true)

    try {
      if (data.target === 'individual') {
        const phone = data.customer_id
          ? customers.find(c => c.id === data.customer_id)?.phone
          : data.phone_manual
        if (!phone) { toast.error('Informe um telefone ou selecione um cliente'); setSending(false); return }
        const name = customers.find(c => c.id === data.customer_id)?.name ?? 'Cliente'
        const msg = data.message.replace(/{nome}/g, name.split(' ')[0]).replace(/{empresa}/g, tenant?.name ?? '')
        await sendWhatsAppMessage(config.instance_name, sanitizePhone(phone), msg)
        toast.success('Mensagem enviada! ✅')
        return
      }

      // Envio em massa
      let targets: Customer[] = []
      if (data.target === 'all_active') targets = customers.filter(c => c.phone)
      else {
        const days = Number(data.target.replace('inactive_', '').replace('d', ''))
        targets = await getInactiveCustomers(days)
      }

      if (!targets.length) { toast.error('Nenhum cliente encontrado com telefone'); setSending(false); return }

      setSendProgress({ sent: 0, total: targets.length, running: true })
      let sent = 0
      for (const c of targets) {
        try {
          const msg = data.message.replace(/{nome}/g, c.name.split(' ')[0]).replace(/{empresa}/g, tenant?.name ?? '')
          await sendWhatsAppMessage(config.instance_name, sanitizePhone(c.phone!), msg)
          sent++
          setSendProgress(p => ({ ...p, sent }))
          await new Promise(r => setTimeout(r, 1500))
        } catch { /* ignora erros individuais */ }
      }
      setSendProgress(p => ({ ...p, running: false }))
      toast.success(`✅ ${sent}/${targets.length} mensagens enviadas!`)
    } catch (err: any) {
      toast.error(err.message || 'Erro ao enviar')
    } finally {
      setSending(false)
    }
  }

  const targetLabel: Record<string, string> = {
    individual: 'Cliente individual',
    all_active: `Todos os clientes (${customers.filter(c => c.phone).length} com telefone)`,
    inactive_30d: `Inativos 30+ dias (${inactiveSummary['inactive_30d']?.withPhone ?? 0} com telefone)`,
    inactive_45d: `Inativos 45+ dias (${inactiveSummary['inactive_45d']?.withPhone ?? 0} com telefone)`,
    inactive_60d: `Inativos 60+ dias (${inactiveSummary['inactive_60d']?.withPhone ?? 0} com telefone)`,
    inactive_90d: `Inativos 90+ dias (${inactiveSummary['inactive_90d']?.withPhone ?? 0} com telefone)`,
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Mensagens WhatsApp</h1>
        <p className="text-sm text-muted-foreground">Comunicação individual ou em massa com clientes</p>
      </div>

      {/* Config da instância */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Smartphone className="h-4 w-4" /> Configuração da instância
            {instanceStatus === 'connected' && <Badge className="bg-green-100 text-green-700 border-none gap-1"><CheckCircle className="h-3 w-3" /> Conectado</Badge>}
            {instanceStatus === 'disconnected' && <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> Desconectado</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome da instância</Label>
              <Input placeholder="minha-instancia" value={instanceName} onChange={e => setInstanceName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">API Key (deixe em branco para manter)</Label>
              <Input type="password" placeholder="••••••••" value={apiKey} onChange={e => setApiKey(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={saveConfig} disabled={savingConfig}>{savingConfig ? 'Salvando...' : 'Salvar'}</Button>
            <Button size="sm" variant="outline" onClick={checkStatus} className="gap-1"><RefreshCw className="h-3 w-3" /> Verificar status</Button>
          </div>
        </CardContent>
      </Card>

      {/* Resumo inativos */}
      {Object.keys(inactiveSummary).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[30, 45, 60, 90].map(days => {
            const s = inactiveSummary[`inactive_${days}d`]
            return (
              <Card key={days} className="cursor-pointer hover:border-orange-300 transition-colors" onClick={() => setValue('target', `inactive_${days}d` as any)}>
                <CardContent className="p-3 text-center">
                  <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                    <UserX className="h-4 w-4 text-orange-500" />
                  </div>
                  <p className="text-lg font-bold">{s?.count ?? 0}</p>
                  <p className="text-xs text-muted-foreground">{days}+ dias sem visitar</p>
                  <p className="text-xs text-orange-600 font-medium">{s?.withPhone ?? 0} com tel.</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Formulário de envio */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Enviar mensagem
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

            {/* Para quem */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Para quem enviar</Label>
              <Controller name="target" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <Users className="h-4 w-4 mr-2 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">👤 Cliente individual</SelectItem>
                    <Separator className="my-1" />
                    <SelectItem value="all_active">📢 Todos os clientes ({customers.filter(c => c.phone).length} com telefone)</SelectItem>
                    <Separator className="my-1" />
                    <SelectItem value="inactive_30d">⏰ Inativos 30+ dias ({inactiveSummary['inactive_30d']?.withPhone ?? 0} com tel.)</SelectItem>
                    <SelectItem value="inactive_45d">⏰ Inativos 45+ dias ({inactiveSummary['inactive_45d']?.withPhone ?? 0} com tel.)</SelectItem>
                    <SelectItem value="inactive_60d">⏰ Inativos 60+ dias ({inactiveSummary['inactive_60d']?.withPhone ?? 0} com tel.)</SelectItem>
                    <SelectItem value="inactive_90d">⏰ Inativos 90+ dias ({inactiveSummary['inactive_90d']?.withPhone ?? 0} com tel.)</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </div>

            {/* Seleção de cliente individual */}
            {target === 'individual' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Selecionar cliente</Label>
                  <Controller name="customer_id" control={control} render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue placeholder="Escolher..." /></SelectTrigger>
                      <SelectContent>
                        {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}{c.phone ? '' : ' (sem tel.)'}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Ou digitar telefone</Label>
                  <Input placeholder="(11) 99999-0000" {...register('phone_manual')} />
                </div>
              </div>
            )}

            {/* Aviso envio em massa */}
            {target !== 'individual' && (
              <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                <Users className="h-4 w-4 shrink-0" />
                Será enviado para <strong>{
                  target === 'all_active'
                    ? customers.filter(c => c.phone).length
                    : (inactiveSummary[target]?.withPhone ?? 0)
                } clientes</strong> com telefone cadastrado. Intervalo de 1,5s entre envios (anti-spam).
              </div>
            )}

            {/* Quando enviar */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quando enviar</Label>
              <Controller name="send_when" control={control} render={({ field }) => (
                <div className="flex gap-3">
                  <button type="button"
                    className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${field.value === 'now' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
                    onClick={() => field.onChange('now')}
                  >
                    <Send className="h-4 w-4" /> Agora
                  </button>
                  <button type="button"
                    className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${field.value === 'scheduled' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
                    onClick={() => field.onChange('scheduled')}
                  >
                    <Calendar className="h-4 w-4" /> Agendar
                  </button>
                </div>
              )} />
            </div>

            {/* Data/hora agendamento */}
            {sendWhen === 'scheduled' && (
              <div className="space-y-1.5">
                <Label className="text-xs">Data e hora de envio</Label>
                <Input type="datetime-local" {...register('scheduled_at')} min={new Date().toISOString().slice(0, 16)} />
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> A mensagem será salva como campanha agendada
                </p>
              </div>
            )}

            {/* Mensagem */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mensagem</Label>
              <Textarea
                rows={5}
                placeholder={'Olá {nome}! 😊 Sua mensagem aqui...\n\nUse {nome} e {empresa} como variáveis.'}
                {...register('message')}
              />
              {errors.message && <p className="text-xs text-destructive">{errors.message.message}</p>}
              <p className="text-xs text-muted-foreground">Variáveis disponíveis: {'{nome}'}, {'{empresa}'}</p>
            </div>

            {/* Progress bar envio */}
            {sendProgress.running && (
              <div className="space-y-1.5 p-3 bg-green-50 rounded-lg">
                <div className="flex justify-between text-sm font-medium text-green-700">
                  <span>Enviando mensagens...</span>
                  <span>{sendProgress.sent}/{sendProgress.total}</span>
                </div>
                <div className="w-full bg-green-200 rounded-full h-2">
                  <div className="bg-green-600 h-2 rounded-full transition-all" style={{ width: `${(sendProgress.sent / sendProgress.total) * 100}%` }} />
                </div>
              </div>
            )}

            <Button type="submit" className="w-full gap-2" disabled={sending || sendProgress.running}>
              {sending || sendProgress.running ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Enviando...</>
              ) : sendWhen === 'scheduled' ? (
                <><Calendar className="h-4 w-4" /> Agendar mensagem</>
              ) : (
                <><Send className="h-4 w-4" /> Enviar agora</>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
