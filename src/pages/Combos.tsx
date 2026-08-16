import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import {
  Plus, Pencil, Trash2, Repeat, DollarSign, Clock, Search,
  Package, CheckCircle2, X, Tag, Layers, Link2, Copy, ExternalLink,
} from 'lucide-react'

/* ── Types ─────────────────────────────────────────────────────────── */

interface Plan {
  id: string
  name: string
  description: string | null
  price: number
  interval: string
  sessions: number | null
  services: string[] | null
  is_active: boolean
  created_at: string
}

interface Service {
  id: string
  name: string
  price: number
}

/* ── Constants ─────────────────────────────────────────────────────── */

const INTERVALS = [
  { value: 'single',    label: 'Pacote avulso', icon: '📦', desc: 'Sem recorrência' },
  { value: 'monthly',   label: 'Mensal',        icon: '📅', desc: 'Cobrado todo mês' },
  { value: 'quarterly', label: 'Trimestral',    icon: '🗓️', desc: 'A cada 3 meses' },
  { value: 'yearly',    label: 'Anual',         icon: '🎯', desc: 'Cobrado por ano' },
]

const INTERVAL_LABEL: Record<string, string> = {
  single: 'Avulso', monthly: 'Mensal', quarterly: 'Trimestral', yearly: 'Anual',
}

const INTERVAL_COLOR: Record<string, string> = {
  single: 'bg-gray-100 text-gray-600',
  monthly: 'bg-blue-100 text-blue-700',
  quarterly: 'bg-purple-100 text-purple-700',
  yearly: 'bg-amber-100 text-amber-700',
}

/* ── Modal ─────────────────────────────────────────────────────────── */

function PlanModal({
  plan, services, tenantId, onClose, onSaved,
}: {
  plan: Plan | null; services: Service[]; tenantId: string;
  onClose: () => void; onSaved: () => void
}) {
  const isNew = !plan
  const [form, setForm] = useState({
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    price: plan?.price ?? 0,
    interval: plan?.interval ?? 'monthly',
    sessions: plan?.sessions ?? '',
    services: (plan?.services ?? []) as string[],
    is_active: plan?.is_active ?? true,
  })
  const [saving, setSaving] = useState(false)

  const toggleService = (id: string) =>
    setForm(f => ({
      ...f,
      services: f.services.includes(id) ? f.services.filter(s => s !== id) : [...f.services, id],
    }))

  const handleSave = async () => {
    if (!form.name || form.price <= 0) {
      toast.error('Nome e preço são obrigatórios')
      return
    }
    setSaving(true)
    const payload = {
      tenant_id: tenantId,
      name: form.name,
      description: form.description || null,
      price: Number(form.price),
      interval: form.interval,
      sessions: form.sessions ? Number(form.sessions) : null,
      services: form.services.length > 0 ? form.services : null,
      is_active: form.is_active,
    }
    const { error } = isNew
      ? await supabase.from('subscription_plans').insert([payload])
      : await supabase.from('subscription_plans').update(payload).eq('id', plan!.id)

    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success(isNew ? 'Combo criado!' : 'Combo atualizado!')
    onSaved()
    onClose()
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
              <Repeat className="w-4 h-4 text-purple-600"/>
            </div>
            <h2 className="font-bold text-gray-900">{isNew ? 'Novo Combo / Assinatura' : 'Editar Combo'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">

          {/* Nome */}
          <div>
            <Label className="text-sm font-semibold">Nome do combo *</Label>
            <Input className="mt-1.5" placeholder="Ex: Pacote Mensal, Combo Premium..." value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          {/* Descrição */}
          <div>
            <Label className="text-sm font-semibold">Descrição</Label>
            <textarea
              className="mt-1.5 w-full border border-input rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              rows={2} placeholder="Ex: 4 lavagens mensais + higienização interna"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>

          {/* Preço + Intervalo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-semibold">Preço (R$) *</Label>
              <div className="relative mt-1.5">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
                <Input type="number" className="pl-9" placeholder="0,00" min={0} step={0.01}
                  value={form.price} onChange={e => setForm(f => ({ ...f, price: Number(e.target.value) }))} />
              </div>
            </div>
            <div>
              <Label className="text-sm font-semibold">Recorrência</Label>
              <Select value={form.interval} onValueChange={v => setForm(f => ({ ...f, interval: v }))}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTERVALS.map(i => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.icon} {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Sessões */}
          <div>
            <Label className="text-sm font-semibold">Número de sessões incluídas (opcional)</Label>
            <div className="relative mt-1.5">
              <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
              <Input type="number" className="pl-9" placeholder="Ex: 4 lavagens por mês" min={1}
                value={form.sessions}
                onChange={e => setForm(f => ({ ...f, sessions: e.target.value }))} />
            </div>
          </div>

          {/* Serviços incluídos */}
          {services.length > 0 && (
            <div>
              <Label className="text-sm font-semibold mb-2 block">Serviços incluídos</Label>
              <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto pr-1">
                {services.map(s => (
                  <button key={s.id} onClick={() => toggleService(s.id)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg border-2 text-sm text-left transition-all ${form.services.includes(s.id) ? 'border-primary bg-blue-50' : 'border-gray-100 hover:border-gray-200'}`}>
                    <span className="flex items-center gap-2">
                      {form.services.includes(s.id)
                        ? <CheckCircle2 className="w-4 h-4 text-primary shrink-0"/>
                        : <div className="w-4 h-4 rounded-full border-2 border-gray-300 shrink-0"/>}
                      <span className={form.services.includes(s.id) ? 'font-medium text-gray-900' : 'text-gray-600'}>{s.name}</span>
                    </span>
                    <span className="text-gray-400 text-xs shrink-0">R$ {s.price?.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Ativo */}
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
            <div>
              <p className="text-sm font-semibold text-gray-900">Ativo na agenda pública</p>
              <p className="text-xs text-gray-400">Clientes podem selecionar este combo ao agendar</p>
            </div>
            <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 flex gap-3 justify-end">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}
            className="bg-purple-600 hover:bg-purple-700 text-white gap-2">
            {saving ? 'Salvando…' : isNew ? 'Criar Combo' : 'Salvar'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── Main Page ─────────────────────────────────────────────────────── */

export default function Combos() {
  const { tenant } = useAuth()
  const [plans, setPlans] = useState<Plan[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<'new' | Plan | null>(null)
  const [copied, setCopied] = useState(false)

  const bookingUrl = `${window.location.origin}/agendar/${tenant?.id}`

  const load = useCallback(async () => {
    if (!tenant) return
    setLoading(true)
    const [{ data: p }, { data: s }] = await Promise.all([
      supabase.from('subscription_plans').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }),
      supabase.from('services').select('id, name, price').eq('tenant_id', tenant.id).eq('is_active', true).order('name'),
    ])
    setPlans((p as Plan[]) ?? [])
    setServices((s as Service[]) ?? [])
    setLoading(false)
  }, [tenant])

  useEffect(() => { load() }, [load])

  const handleDelete = async (plan: Plan) => {
    if (!confirm(`Excluir "${plan.name}"?`)) return
    const { error } = await supabase.from('subscription_plans').delete().eq('id', plan.id)
    if (error) { toast.error(error.message); return }
    toast.success('Combo excluído')
    load()
  }

  const handleToggle = async (plan: Plan) => {
    await supabase.from('subscription_plans').update({ is_active: !plan.is_active }).eq('id', plan.id)
    toast.success(plan.is_active ? 'Combo desativado' : 'Combo ativado')
    load()
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(bookingUrl)
    setCopied(true)
    toast.success('Link copiado!')
    setTimeout(() => setCopied(false), 2000)
  }

  const filtered = plans.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.description ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const active = plans.filter(p => p.is_active).length
  const mrr = plans.filter(p => p.is_active && p.interval === 'monthly').reduce((s, p) => s + p.price, 0)

  return (
    <div className="min-h-screen bg-background">

      {/* ── Header ── */}
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Combos & Assinaturas</h1>
            <p className="page-subtitle">Crie pacotes e planos que aparecem na agenda pública para o cliente contratar</p>
          </div>
          <Button onClick={() => setModal('new')} className="gap-2 bg-purple-600 hover:bg-purple-700 text-white">
            <Plus className="w-4 h-4"/>Novo Combo
          </Button>
        </div>
      </div>

      <div className="page-section">

        {/* ── KPIs ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Combos cadastrados', value: plans.length, icon: Layers, color: 'text-purple-600', bg: 'bg-purple-50' },
            { label: 'Ativos', value: active, icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
            { label: 'MRR potencial', value: `R$ ${mrr.toFixed(0)}`, icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Serviços vinculáveis', value: services.length, icon: Package, color: 'text-orange-600', bg: 'bg-orange-50' },
          ].map(c => (
            <div key={c.label} className="stat-card flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${c.bg} shrink-0`}><c.icon className={`w-5 h-5 ${c.color}`}/></div>
              <div><p className="text-xs text-muted-foreground">{c.label}</p><p className="text-xl font-bold text-foreground">{c.value}</p></div>
            </div>
          ))}
        </div>

        {/* ── Link agenda ── */}
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <Link2 className="w-5 h-5 text-blue-600"/>
            <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">Sua agenda pública</span>
          </div>
          <div className="flex-1 bg-white dark:bg-blue-900/30 rounded-lg px-3 py-2 font-mono text-xs text-blue-700 dark:text-blue-300 truncate border border-blue-100 dark:border-blue-800 min-w-0">
            {bookingUrl}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={copyLink} className="gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-100">
              {copied ? <CheckCircle2 className="w-4 h-4"/> : <Copy className="w-4 h-4"/>}
              {copied ? 'Copiado!' : 'Copiar'}
            </Button>
            <a href={bookingUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" className="gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-100">
                <ExternalLink className="w-4 h-4"/>Abrir
              </Button>
            </a>
          </div>
        </div>

        {/* ── Busca ── */}
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
            <Input placeholder="Buscar combo..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
        </div>

        {/* ── Lista ── */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full"/>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Repeat className="w-8 h-8 text-purple-300"/>
            </div>
            <p className="font-semibold text-muted-foreground">Nenhum combo cadastrado</p>
            <p className="text-sm text-muted-foreground/60 mt-1 mb-5">Crie combos e planos de assinatura para oferecer na agenda pública</p>
            <Button onClick={() => setModal('new')} className="gap-2 bg-purple-600 hover:bg-purple-700 text-white">
              <Plus className="w-4 h-4"/>Criar primeiro combo
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(plan => {
              const planServices = services.filter(s => plan.services?.includes(s.id))
              const interval = INTERVALS.find(i => i.value === plan.interval)
              return (
                <div key={plan.id}
                  className={`bg-card rounded-2xl border-2 transition-all duration-200 overflow-hidden ${plan.is_active ? 'border-border hover:border-purple-300 hover:shadow-lg' : 'border-dashed border-border opacity-60'}`}>

                  {/* Card header */}
                  <div className="p-5 pb-3">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 ${plan.is_active ? 'bg-purple-100' : 'bg-gray-100'}`}>
                          {interval?.icon ?? '📦'}
                        </div>
                        <div>
                          <h3 className="font-bold text-foreground leading-tight">{plan.name}</h3>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${INTERVAL_COLOR[plan.interval]}`}>
                            {INTERVAL_LABEL[plan.interval]}
                          </span>
                        </div>
                      </div>
                      <Switch checked={plan.is_active} onCheckedChange={() => handleToggle(plan)} />
                    </div>

                    {plan.description && (
                      <p className="text-sm text-muted-foreground leading-relaxed mb-3">{plan.description}</p>
                    )}

                    {/* Preço */}
                    <div className="flex items-baseline gap-1 mb-3">
                      <span className="text-2xl font-black text-purple-600">R$ {plan.price.toFixed(2)}</span>
                      {plan.interval !== 'single' && (
                        <span className="text-xs text-muted-foreground">/{INTERVAL_LABEL[plan.interval].toLowerCase()}</span>
                      )}
                    </div>

                    {/* Sessões */}
                    {plan.sessions && (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-3">
                        <Clock className="w-3.5 h-3.5"/>
                        {plan.sessions} {plan.sessions === 1 ? 'sessão' : 'sessões'} incluídas
                      </div>
                    )}

                    {/* Serviços incluídos */}
                    {planServices.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {planServices.map(s => (
                          <span key={s.id} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                            <Tag className="w-2.5 h-2.5"/>{s.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Card footer */}
                  <div className="px-5 py-3 border-t border-border/60 flex items-center justify-between">
                    <span className={`text-xs font-medium px-2 py-1 rounded-lg ${plan.is_active ? 'text-green-700 bg-green-50' : 'text-gray-500 bg-gray-100'}`}>
                      {plan.is_active ? '✓ Ativo na agenda' : '● Inativo'}
                    </span>
                    <div className="flex gap-1">
                      <button onClick={() => setModal(plan)}
                        className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors" title="Editar">
                        <Pencil className="w-4 h-4"/>
                      </button>
                      <button onClick={() => handleDelete(plan)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors" title="Excluir">
                        <Trash2 className="w-4 h-4"/>
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Modal ── */}
      {modal && (
        <PlanModal
          plan={modal === 'new' ? null : modal}
          services={services}
          tenantId={tenant!.id}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}
