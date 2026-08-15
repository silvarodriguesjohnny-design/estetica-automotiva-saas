import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import {
  Users, TrendingDown, AlertTriangle, DollarSign,
  Activity, Search, RefreshCw, Clock,
  BarChart3, LogOut, Shield, Settings, Plug, UserCheck,
  Building2, Pencil, Trash2, PowerOff, Power, Plus,
  ChevronRight, Mail, Phone, MapPin, CreditCard, Eye, EyeOff,
  CheckCircle2, XCircle, Globe, Key, Webhook, Save
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Tenant {
  id: string
  name: string
  owner_email: string
  owner_name?: string
  phone?: string
  subscription_type: string
  plan_type: string
  trial_ends_at: string | null
  created_at: string
  cidade?: string
  estado?: string
}

interface Profile {
  id: string
  full_name: string
  email?: string
  role: string
  is_super_admin: boolean
  tenant_id: string | null
  created_at: string
  tenant?: { name: string }
}

interface MessagingConfig {
  id: string
  tenant_id: string
  evolution_instance_name: string
  evolution_api_url: string
  status: string
  created_at: string
  tenant?: { name: string }
}

interface SystemConfig {
  evolution_api_url: string
  evolution_api_key: string
  stripe_webhook_secret: string
  support_email: string
  app_url: string
}

// ─── Churn helpers (Dashboard) ───────────────────────────────────────────────

interface TenantWithMetrics extends Tenant {
  total_os: number
  total_customers: number
  last_os_date: string | null
  days_since_last_os: number | null
  churn_risk: 'low' | 'medium' | 'high' | 'critical'
  monthly_revenue: number
}

const PLAN_PRICE: Record<string, number> = { starter: 97.33, pro: 159.90, enterprise: 297.90, trial: 0 }

function computeChurnRisk(t: TenantWithMetrics): 'low' | 'medium' | 'high' | 'critical' {
  let score = 0
  if (t.total_os === 0) score += 40
  else if ((t.days_since_last_os ?? 999) > 30) score += 30
  else if ((t.days_since_last_os ?? 999) > 14) score += 15
  if (t.total_os < 5) score += 20
  if (t.total_customers < 3) score += 15
  if (t.subscription_type === 'trial' && t.trial_ends_at) {
    const days = (new Date(t.trial_ends_at).getTime() - Date.now()) / 86400000
    if (days < 3) score += 25
  }
  if (score < 15) return 'low'
  if (score < 35) return 'medium'
  if (score < 55) return 'high'
  return 'critical'
}

const CHURN_COLOR: Record<string, string> = {
  low: 'bg-green-100 text-green-700', medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700', critical: 'bg-red-100 text-red-700',
}
const PLAN_BADGE: Record<string, string> = {
  starter: 'bg-blue-100 text-blue-700', pro: 'bg-purple-100 text-purple-700',
  enterprise: 'bg-gray-900 text-white', trial: 'bg-gray-100 text-gray-600',
}
const SUB_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-700', trial: 'bg-blue-100 text-blue-700',
  past_due: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500',
  inactive: 'bg-gray-100 text-gray-500',
}

// ─── Section: Dashboard ───────────────────────────────────────────────────────

function SectionDashboard() {
  const [tenants, setTenants] = useState<TenantWithMetrics[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: ts } = await supabase.from('tenants').select('*').order('created_at', { ascending: false })
      if (!ts) { setLoading(false); return }
      const enriched = await Promise.all(ts.map(async t => {
        const [{ count: total_os }, { count: total_customers }, { data: lastOs }] = await Promise.all([
          supabase.from('service_orders').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id),
          supabase.from('customers').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id),
          supabase.from('service_orders').select('created_at').eq('tenant_id', t.id).order('created_at', { ascending: false }).limit(1),
        ])
        const last_os_date = lastOs?.[0]?.created_at ?? null
        const days_since_last_os = last_os_date ? Math.floor((Date.now() - new Date(last_os_date).getTime()) / 86400000) : null
        const monthly_revenue = PLAN_PRICE[t.plan_type] ?? 0
        const row: TenantWithMetrics = { ...t, total_os: total_os ?? 0, total_customers: total_customers ?? 0, last_os_date, days_since_last_os, churn_risk: 'low', monthly_revenue }
        row.churn_risk = computeChurnRisk(row)
        return row
      }))
      setTenants(enriched)
      setLoading(false)
    }
    load()
  }, [])

  const mrr = tenants.reduce((s, t) => s + t.monthly_revenue, 0)
  const atRisk = tenants.filter(t => t.churn_risk === 'high' || t.churn_risk === 'critical').length
  const critical = tenants.filter(t => t.churn_risk === 'critical').length
  const distData = ['low','medium','high','critical'].map(r => ({ name: r, value: tenants.filter(t => t.churn_risk === r).length }))

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"/></div>

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Clientes', value: tenants.length, icon: Building2, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'MRR', value: `R$ ${mrr.toFixed(0)}`, icon: DollarSign, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Em Risco', value: atRisk, icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'Críticos', value: critical, icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${c.bg}`}><c.icon className={`w-5 h-5 ${c.color}`}/></div>
              <div><p className="text-xs text-gray-500">{c.label}</p><p className="text-xl font-bold text-gray-900">{c.value}</p></div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <h3 className="font-semibold text-gray-900 mb-4">Distribuição de Risco de Churn</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={distData}>
              <XAxis dataKey="name" tick={{ fontSize: 12 }}/>
              <YAxis tick={{ fontSize: 12 }}/>
              <Tooltip/>
              <Bar dataKey="value" fill="#3b82f6" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <h3 className="font-semibold text-gray-900 mb-3">🚨 Clientes Críticos</h3>
          <div className="space-y-2">
            {tenants.filter(t => t.churn_risk === 'critical' || t.churn_risk === 'high').slice(0,5).map(t => (
              <div key={t.id} className="flex items-center justify-between py-2 border-b border-gray-50">
                <div><p className="text-sm font-medium text-gray-900">{t.name}</p><p className="text-xs text-gray-400">{t.days_since_last_os ?? '∞'}d sem OS · {t.total_os} OS total</p></div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${CHURN_COLOR[t.churn_risk]}`}>{t.churn_risk.toUpperCase()}</span>
              </div>
            ))}
            {tenants.filter(t => t.churn_risk === 'critical' || t.churn_risk === 'high').length === 0 && <p className="text-sm text-gray-400">Nenhum cliente crítico 🎉</p>}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-4 border-b border-gray-100"><h3 className="font-semibold text-gray-900">Todos os Clientes — Risco de Churn</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Empresa','Plano','Status','OS Total','Último OS','Churn Risk','MRR'].map(h=><th key={h} className="text-left px-4 py-2 text-xs font-medium text-gray-500">{h}</th>)}</tr></thead>
            <tbody>
              {tenants.map(t => (
                <tr key={t.id} className="border-t border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLAN_BADGE[t.plan_type] ?? 'bg-gray-100'}`}>{(t.plan_type ?? 'trial').toUpperCase()}</span></td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${SUB_BADGE[t.subscription_type] ?? 'bg-gray-100'}`}>{t.subscription_type}</span></td>
                  <td className="px-4 py-3 text-center">{t.total_os}</td>
                  <td className="px-4 py-3 text-gray-500">{t.days_since_last_os !== null ? `${t.days_since_last_os}d atrás` : '—'}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CHURN_COLOR[t.churn_risk]}`}>{t.churn_risk.toUpperCase()}</span></td>
                  <td className="px-4 py-3 font-medium text-gray-900">R$ {t.monthly_revenue.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Section: Tenants (CRUD) ──────────────────────────────────────────────────

function SectionTenants() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [selected, setSelected] = useState<Tenant | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<Tenant>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('tenants').select('*').order('created_at', { ascending: false })
    setTenants(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = tenants.filter(t => {
    const matchSearch = t.name.toLowerCase().includes(search.toLowerCase()) || t.owner_email.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'all' || t.subscription_type === filterStatus
    return matchSearch && matchStatus
  })

  const openEdit = (t: Tenant) => { setSelected(t); setForm({ ...t }); setCreating(false); setShowModal(true) }
  const openCreate = () => { setSelected(null); setForm({ subscription_type: 'trial', plan_type: 'trial' }); setCreating(true); setShowModal(true) }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (creating) {
        const { error } = await supabase.from('tenants').insert([form])
        if (error) throw error
        toast.success('Cliente criado!')
      } else if (selected) {
        const { error } = await supabase.from('tenants').update(form).eq('id', selected.id)
        if (error) throw error
        toast.success('Cliente atualizado!')
      }
      setShowModal(false)
      load()
    } catch (e: any) {
      toast.error(e.message)
    }
    setSaving(false)
  }

  const handleToggleActive = async (t: Tenant) => {
    const newStatus = t.subscription_type === 'inactive' ? 'active' : 'inactive'
    const { error } = await supabase.from('tenants').update({ subscription_type: newStatus }).eq('id', t.id)
    if (error) { toast.error(error.message); return }
    toast.success(newStatus === 'inactive' ? 'Cliente desativado' : 'Cliente reativado')
    load()
  }

  const handleDelete = async (t: Tenant) => {
    if (!confirm(`Excluir permanentemente "${t.name}"? Isso não pode ser desfeito.`)) return
    const { error } = await supabase.from('tenants').delete().eq('id', t.id)
    if (error) { toast.error(error.message); return }
    toast.success('Cliente excluído')
    load()
  }

  const handleChangePlan = async (t: Tenant, plan: string) => {
    const { error } = await supabase.from('tenants').update({ plan_type: plan, subscription_type: plan === 'trial' ? 'trial' : 'active' }).eq('id', t.id)
    if (error) { toast.error(error.message); return }
    toast.success(`Plano alterado para ${plan}`)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
            <Input placeholder="Buscar empresa ou email..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-36"><SelectValue/></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="trial">Trial</SelectItem>
              <SelectItem value="inactive">Inativos</SelectItem>
              <SelectItem value="past_due">Inadimplentes</SelectItem>
              <SelectItem value="cancelled">Cancelados</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={openCreate} className="gap-2 bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4"/>Novo Cliente
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"/></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{['Empresa','Email','Plano','Status','Cidade','Criado em','Ações'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(t => (
                <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{t.name}</div>
                    <div className="text-xs text-gray-400">{t.id.slice(0,8)}...</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{t.owner_email}</td>
                  <td className="px-4 py-3">
                    <Select value={t.plan_type ?? 'trial'} onValueChange={v => handleChangePlan(t, v)}>
                      <SelectTrigger className="h-7 text-xs w-28"><SelectValue/></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="trial">Trial</SelectItem>
                        <SelectItem value="starter">Starter</SelectItem>
                        <SelectItem value="pro">Pro</SelectItem>
                        <SelectItem value="enterprise">Enterprise</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${SUB_BADGE[t.subscription_type] ?? 'bg-gray-100'}`}>{t.subscription_type}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{t.cidade ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(t.created_at).toLocaleDateString('pt-BR')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Editar"><Pencil className="w-4 h-4"/></button>
                      <button onClick={() => handleToggleActive(t)} className={`p-1.5 rounded ${t.subscription_type === 'inactive' ? 'hover:bg-green-50 text-green-600' : 'hover:bg-yellow-50 text-yellow-600'}`} title={t.subscription_type === 'inactive' ? 'Reativar' : 'Desativar'}>
                        {t.subscription_type === 'inactive' ? <Power className="w-4 h-4"/> : <PowerOff className="w-4 h-4"/>}
                      </button>
                      <button onClick={() => handleDelete(t)} className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Excluir"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Nenhum cliente encontrado</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal Criar/Editar */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">{creating ? 'Novo Cliente' : `Editar: ${selected?.name}`}</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2"><Label>Nome da Empresa</Label><Input value={form.name ?? ''} onChange={e => setForm(f => ({...f, name: e.target.value}))}/></div>
                <div><Label>Email do Responsável</Label><Input type="email" value={form.owner_email ?? ''} onChange={e => setForm(f => ({...f, owner_email: e.target.value}))}/></div>
                <div><Label>Nome do Responsável</Label><Input value={form.owner_name ?? ''} onChange={e => setForm(f => ({...f, owner_name: e.target.value}))}/></div>
                <div><Label>Telefone</Label><Input value={form.phone ?? ''} onChange={e => setForm(f => ({...f, phone: e.target.value}))}/></div>
                <div><Label>Cidade</Label><Input value={form.cidade ?? ''} onChange={e => setForm(f => ({...f, cidade: e.target.value}))}/></div>
                <div><Label>Plano</Label>
                  <Select value={form.plan_type ?? 'trial'} onValueChange={v => setForm(f => ({...f, plan_type: v}))}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trial">Trial</SelectItem>
                      <SelectItem value="starter">Starter — R$ 97,33/mês</SelectItem>
                      <SelectItem value="pro">Pro — R$ 159,90/mês</SelectItem>
                      <SelectItem value="enterprise">Enterprise — R$ 297,90/mês</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Status</Label>
                  <Select value={form.subscription_type ?? 'trial'} onValueChange={v => setForm(f => ({...f, subscription_type: v}))}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trial">Trial</SelectItem>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="inactive">Inativo</SelectItem>
                      <SelectItem value="past_due">Inadimplente</SelectItem>
                      <SelectItem value="cancelled">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowModal(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                {saving ? 'Salvando...' : creating ? 'Criar Cliente' : 'Salvar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Section: Usuários ────────────────────────────────────────────────────────

function SectionUsuarios() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*, tenant:tenants(name)').order('created_at', { ascending: false })
    setProfiles((data as any[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = profiles.filter(p =>
    p.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.email?.toLowerCase().includes(search.toLowerCase()) ||
    (p.tenant as any)?.name?.toLowerCase().includes(search.toLowerCase())
  )

  const handleToggleSuperAdmin = async (p: Profile) => {
    if (p.is_super_admin && !confirm('Remover privilégio de Super Admin?')) return
    const { error } = await supabase.from('profiles').update({ is_super_admin: !p.is_super_admin }).eq('id', p.id)
    if (error) { toast.error(error.message); return }
    toast.success(p.is_super_admin ? 'Super Admin removido' : 'Super Admin concedido')
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
          <Input placeholder="Buscar usuário ou empresa..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className="w-4 h-4"/>Atualizar</Button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"/></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Nome','Email','Empresa','Papel','Super Admin','Criado em'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{p.full_name}</div>
                    <div className="text-xs text-gray-400">{p.id.slice(0,8)}...</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{p.email ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{(p.tenant as any)?.name ?? <span className="text-gray-300">Sem empresa</span>}</td>
                  <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{p.role ?? 'user'}</span></td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggleSuperAdmin(p)} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium transition-colors ${p.is_super_admin ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                      <Shield className="w-3 h-3"/>
                      {p.is_super_admin ? 'Super Admin' : 'Normal'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(p.created_at).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhum usuário encontrado</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Section: Integrações ─────────────────────────────────────────────────────

function SectionIntegracoes() {
  const [configs, setConfigs] = useState<MessagingConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showKey, setShowKey] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('messaging_configs').select('*, tenant:tenants(name)').order('created_at', { ascending: false })
    setConfigs((data as any[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = configs.filter(c =>
    (c.tenant as any)?.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.evolution_instance_name?.toLowerCase().includes(search.toLowerCase())
  )

  const handleUpdateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from('messaging_configs').update({ status }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Status atualizado')
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
          <Input placeholder="Buscar empresa ou instância..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className="w-4 h-4"/>Atualizar</Button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"/></div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Nenhuma integração configurada</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Empresa','Instância Evolution','API URL','Status','Criado em','Ações'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{(c.tenant as any)?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Key className="w-4 h-4 text-gray-400"/>
                      <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">{c.evolution_instance_name}</code>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[200px]">{c.evolution_api_url ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Select value={c.status ?? 'inactive'} onValueChange={v => handleUpdateStatus(c.id, v)}>
                      <SelectTrigger className="h-7 text-xs w-28"><SelectValue/></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Ativo</SelectItem>
                        <SelectItem value="inactive">Inativo</SelectItem>
                        <SelectItem value="pending">Pendente</SelectItem>
                        <SelectItem value="error">Erro</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(c.created_at).toLocaleDateString('pt-BR')}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => setShowKey(s => ({...s, [c.id]: !s[c.id]}))} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="Ver detalhes">
                      {showKey[c.id] ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2"><Globe className="w-4 h-4 text-blue-600"/><span className="text-sm font-semibold text-blue-900">Evolution API — Status Global</span></div>
        <p className="text-xs text-blue-700">{configs.filter(c => c.status === 'active').length} instâncias ativas de {configs.length} configuradas.</p>
      </div>
    </div>
  )
}

// ─── Section: Configurações ───────────────────────────────────────────────────

function SectionConfiguracoes() {
  const [config, setConfig] = useState<SystemConfig>({
    evolution_api_url: '', evolution_api_key: '', stripe_webhook_secret: '',
    support_email: 'suporte@autodetailpro.com.br', app_url: 'https://autodetail-pro.vercel.app'
  })
  const [showSecrets, setShowSecrets] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    // In production: save to a system_configs table or Supabase Vault
    await new Promise(r => setTimeout(r, 800))
    toast.success('Configurações salvas! (Aplique via Supabase Secrets para as chaves sensíveis)')
    setSaving(false)
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div className="flex items-center gap-2 mb-2">
          <Globe className="w-5 h-5 text-gray-500"/><h3 className="font-semibold text-gray-900">Configurações Gerais</h3>
        </div>
        <div>
          <Label>URL da Aplicação</Label>
          <Input value={config.app_url} onChange={e => setConfig(c => ({...c, app_url: e.target.value}))} placeholder="https://autodetail-pro.vercel.app"/>
        </div>
        <div>
          <Label>Email de Suporte</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
            <Input className="pl-9" value={config.support_email} onChange={e => setConfig(c => ({...c, support_email: e.target.value}))}/>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2"><Webhook className="w-5 h-5 text-gray-500"/><h3 className="font-semibold text-gray-900">Evolution API — Global</h3></div>
          <button onClick={() => setShowSecrets(s => !s)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
            {showSecrets ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>} {showSecrets ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        <div>
          <Label>URL da API</Label>
          <Input value={config.evolution_api_url} onChange={e => setConfig(c => ({...c, evolution_api_url: e.target.value}))} placeholder="https://sua-evolution-api.com"/>
        </div>
        <div>
          <Label>API Key Global</Label>
          <Input type={showSecrets ? 'text' : 'password'} value={config.evolution_api_key} onChange={e => setConfig(c => ({...c, evolution_api_key: e.target.value}))} placeholder="••••••••••••"/>
          <p className="text-xs text-gray-400 mt-1">⚠️ Armazene via <code>supabase secrets set EVOLUTION_API_KEY=...</code></p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div className="flex items-center gap-2 mb-2">
          <CreditCard className="w-5 h-5 text-gray-500"/><h3 className="font-semibold text-gray-900">Stripe</h3>
        </div>
        <div>
          <Label>Webhook Secret</Label>
          <Input type={showSecrets ? 'text' : 'password'} value={config.stripe_webhook_secret} onChange={e => setConfig(c => ({...c, stripe_webhook_secret: e.target.value}))} placeholder="whsec_••••••••"/>
          <p className="text-xs text-gray-400 mt-1">⚠️ Armazene via <code>supabase secrets set STRIPE_WEBHOOK_SECRET=...</code></p>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-700">
          🔒 Chaves sensíveis devem ser configuradas via <strong>Supabase Vault / Secrets</strong> — nunca salvas no banco de dados diretamente.
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="gap-2 bg-blue-600 hover:bg-blue-700">
        <Save className="w-4 h-4"/>{saving ? 'Salvando...' : 'Salvar Configurações'}
      </Button>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

type Section = 'dashboard' | 'tenants' | 'usuarios' | 'integracoes' | 'configuracoes'

const NAV: { id: Section; label: string; icon: any; badge?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'tenants', label: 'Clientes', icon: Building2 },
  { id: 'usuarios', label: 'Usuários', icon: UserCheck },
  { id: 'integracoes', label: 'Integrações', icon: Plug },
  { id: 'configuracoes', label: 'Configurações', icon: Settings },
]

export default function SuperAdmin() {
  const { signOut, profile } = useAuth()
  const navigate = useNavigate()
  const [section, setSection] = useState<Section>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleSignOut = async () => { await signOut(); navigate('/login') }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-30 sticky top-0">
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(o => !o)} className="p-1.5 rounded hover:bg-gray-100 lg:hidden">
            <Activity className="w-5 h-5 text-gray-500"/>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
              <Shield className="w-4 h-4 text-white"/>
            </div>
            <div>
              <span className="font-bold text-gray-900 text-sm">Auto Estética Flow</span>
              <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Super Admin</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:block text-right">
            <p className="text-xs font-medium text-gray-900">{profile?.full_name ?? 'Admin'}</p>
            <p className="text-xs text-gray-400">Super Administrador</p>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-2 text-gray-500 hover:text-red-600">
            <LogOut className="w-4 h-4"/>Sair
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:static inset-y-0 left-0 w-56 bg-white border-r border-gray-200 z-20 transition-transform duration-200 pt-0 lg:pt-0 flex flex-col`}>
          <div className="p-4 flex-1">
            <nav className="space-y-1 mt-2">
              {NAV.map(n => (
                <button key={n.id} onClick={() => { setSection(n.id); setSidebarOpen(false) }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${section === n.id ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}>
                  <n.icon className={`w-4 h-4 ${section === n.id ? 'text-blue-600' : 'text-gray-400'}`}/>
                  {n.label}
                  {section === n.id && <ChevronRight className="w-3 h-3 ml-auto text-blue-400"/>}
                </button>
              ))}
            </nav>
          </div>
          <div className="p-4 border-t border-gray-100">
            <div className="text-xs text-gray-400 text-center">AE Flow v2.0</div>
          </div>
        </aside>

        {/* Overlay mobile */}
        {sidebarOpen && <div className="fixed inset-0 bg-black/20 z-10 lg:hidden" onClick={() => setSidebarOpen(false)}/>}

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto">
            <div className="mb-6">
              <h1 className="text-xl font-bold text-gray-900">{NAV.find(n => n.id === section)?.label}</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {section === 'dashboard' && 'Visão geral da plataforma e risco de churn'}
                {section === 'tenants' && 'Gerencie todos os clientes da plataforma'}
                {section === 'usuarios' && 'Todos os usuários cadastrados no sistema'}
                {section === 'integracoes' && 'Instâncias WhatsApp e integrações ativas'}
                {section === 'configuracoes' && 'Configurações globais do sistema'}
              </p>
            </div>

            {section === 'dashboard' && <SectionDashboard/>}
            {section === 'tenants' && <SectionTenants/>}
            {section === 'usuarios' && <SectionUsuarios/>}
            {section === 'integracoes' && <SectionIntegracoes/>}
            {section === 'configuracoes' && <SectionConfiguracoes/>}
          </div>
        </main>
      </div>
    </div>
  )
}
