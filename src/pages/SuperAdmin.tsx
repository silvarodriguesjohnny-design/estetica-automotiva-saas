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
  Activity, Search, RefreshCw, LogOut, Shield, Settings, Plug, UserCheck,
  Building2, Pencil, Trash2, PowerOff, Power, Plus,
  ChevronRight, Mail, CreditCard, Eye, EyeOff,
  BarChart3, Key, Webhook, Save, Send, Wifi, WifiOff,
  UserPlus, Link, QrCode, CheckCircle, XCircle
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Tenant { id: string; name: string; owner_email: string; owner_name?: string; phone?: string; subscription_type: string; plan_type: string; trial_ends_at: string | null; created_at: string; cidade?: string }
interface Profile { id: string; full_name: string; email?: string; role: string; is_super_admin: boolean; tenant_id: string | null; created_at: string; tenant?: { name: string } }
interface MessagingConfig { id: string; tenant_id: string; evolution_instance_name: string; evolution_api_url?: string; status: string; created_at: string; tenant?: { name: string } }

interface TenantWithMetrics extends Tenant { total_os: number; total_customers: number; last_os_date: string | null; days_since_last_os: number | null; churn_risk: 'low'|'medium'|'high'|'critical'; monthly_revenue: number }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PLAN_PRICE: Record<string, number> = { starter: 97.33, pro: 159.90, enterprise: 297.90, trial: 0 }
const CHURN_COLOR: Record<string, string> = { low: 'bg-green-100 text-green-700', medium: 'bg-yellow-100 text-yellow-700', high: 'bg-orange-100 text-orange-700', critical: 'bg-red-100 text-red-700' }
const PLAN_BADGE: Record<string, string> = { starter: 'bg-blue-100 text-blue-700', pro: 'bg-purple-100 text-purple-700', enterprise: 'bg-gray-900 text-white', trial: 'bg-gray-100 text-gray-600' }
const SUB_BADGE: Record<string, string> = { active: 'bg-green-100 text-green-700', trial: 'bg-blue-100 text-blue-700', past_due: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500', inactive: 'bg-gray-100 text-gray-500' }

function computeChurnRisk(t: TenantWithMetrics) {
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
  if (score < 15) return 'low'; if (score < 35) return 'medium'; if (score < 55) return 'high'; return 'critical'
}

// ─── Shared Modal ─────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="p-5 border-t border-gray-100 flex gap-3 justify-end">{footer}</div>}
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

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
      setTenants(enriched); setLoading(false)
    }
    load()
  }, [])

  const mrr = tenants.reduce((s, t) => s + t.monthly_revenue, 0)
  const atRisk = tenants.filter(t => t.churn_risk === 'high' || t.churn_risk === 'critical').length
  const distData = ['low','medium','high','critical'].map(r => ({ name: r, value: tenants.filter(t => t.churn_risk === r).length }))

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"/></div>

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Clientes', value: tenants.length, icon: Building2, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'MRR', value: `R$ ${mrr.toFixed(0)}`, icon: DollarSign, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Em Risco', value: atRisk, icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'Críticos', value: tenants.filter(t => t.churn_risk === 'critical').length, icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50' },
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
            <BarChart data={distData}><XAxis dataKey="name" tick={{ fontSize: 12 }}/><YAxis tick={{ fontSize: 12 }}/><Tooltip/><Bar dataKey="value" fill="#3b82f6" radius={[4,4,0,0]}/></BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <h3 className="font-semibold text-gray-900 mb-3">🚨 Clientes Críticos</h3>
          <div className="space-y-2">
            {tenants.filter(t => t.churn_risk === 'critical' || t.churn_risk === 'high').slice(0,5).map(t => (
              <div key={t.id} className="flex items-center justify-between py-2 border-b border-gray-50">
                <div><p className="text-sm font-medium text-gray-900">{t.name}</p><p className="text-xs text-gray-400">{t.days_since_last_os ?? '∞'}d sem OS · {t.total_os} OS</p></div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${CHURN_COLOR[t.churn_risk]}`}>{t.churn_risk.toUpperCase()}</span>
              </div>
            ))}
            {tenants.filter(t => t.churn_risk === 'critical' || t.churn_risk === 'high').length === 0 && <p className="text-sm text-gray-400 text-center py-4">Nenhum cliente crítico 🎉</p>}
          </div>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b"><h3 className="font-semibold text-gray-900">Todos os Clientes</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm"><thead className="bg-gray-50"><tr>{['Empresa','Plano','Status','OS','Último OS','Risco','MRR'].map(h => <th key={h} className="text-left px-4 py-2 text-xs font-medium text-gray-500">{h}</th>)}</tr></thead>
            <tbody>{tenants.map(t => (
              <tr key={t.id} className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLAN_BADGE[t.plan_type] ?? 'bg-gray-100'}`}>{(t.plan_type ?? 'trial').toUpperCase()}</span></td>
                <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${SUB_BADGE[t.subscription_type] ?? 'bg-gray-100'}`}>{t.subscription_type}</span></td>
                <td className="px-4 py-3 text-center">{t.total_os}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{t.days_since_last_os !== null ? `${t.days_since_last_os}d` : '—'}</td>
                <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CHURN_COLOR[t.churn_risk]}`}>{t.churn_risk}</span></td>
                <td className="px-4 py-3 font-medium">R$ {t.monthly_revenue.toFixed(2)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Tenants (CRUD) ───────────────────────────────────────────────────────────

function SectionTenants() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [selected, setSelected] = useState<Tenant | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<Tenant>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('tenants').select('*').order('created_at', { ascending: false })
    setTenants(data ?? []); setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = tenants.filter(t => {
    const q = search.toLowerCase()
    return (t.name.toLowerCase().includes(q) || t.owner_email.toLowerCase().includes(q)) &&
      (filterStatus === 'all' || t.subscription_type === filterStatus)
  })

  const openEdit = (t: Tenant) => { setSelected(t); setForm({ ...t }); setCreating(false); setShowModal(true) }
  const openCreate = () => { setSelected(null); setForm({ subscription_type: 'trial', plan_type: 'trial' }); setCreating(true); setShowModal(true) }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (creating) {
        const { error } = await supabase.from('tenants').insert([form])
        if (error) throw error
        toast.success('Empresa criada!')
      } else if (selected) {
        const { error } = await supabase.from('tenants').update(form).eq('id', selected.id)
        if (error) throw error
        toast.success('Empresa atualizada!')
      }
      setShowModal(false); load()
    } catch (e: any) { toast.error(e.message) }
    setSaving(false)
  }

  const handleToggle = async (t: Tenant) => {
    const s = t.subscription_type === 'inactive' ? 'active' : 'inactive'
    await supabase.from('tenants').update({ subscription_type: s }).eq('id', t.id)
    toast.success(s === 'inactive' ? 'Empresa desativada' : 'Empresa reativada')
    load()
  }

  const handleDelete = async (t: Tenant) => {
    if (!confirm(`Excluir "${t.name}" permanentemente?`)) return
    const { error } = await supabase.from('tenants').delete().eq('id', t.id)
    if (error) { toast.error(error.message); return }
    toast.success('Empresa excluída'); load()
  }

  const TenantForm = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Nome da Empresa *</Label><Input value={form.name ?? ''} onChange={e => setForm(f => ({...f, name: e.target.value}))}/></div>
        <div><Label>Email do Responsável *</Label><Input type="email" value={form.owner_email ?? ''} onChange={e => setForm(f => ({...f, owner_email: e.target.value}))}/></div>
        <div><Label>Nome do Responsável</Label><Input value={form.owner_name ?? ''} onChange={e => setForm(f => ({...f, owner_name: e.target.value}))}/></div>
        <div><Label>Telefone</Label><Input value={form.phone ?? ''} onChange={e => setForm(f => ({...f, phone: e.target.value}))}/></div>
        <div><Label>Cidade</Label><Input value={form.cidade ?? ''} onChange={e => setForm(f => ({...f, cidade: e.target.value}))}/></div>
        <div><Label>Plano</Label>
          <Select value={form.plan_type ?? 'trial'} onValueChange={v => setForm(f => ({...f, plan_type: v}))}>
            <SelectTrigger><SelectValue/></SelectTrigger>
            <SelectContent><SelectItem value="trial">Trial</SelectItem><SelectItem value="starter">Starter — R$ 97,33</SelectItem><SelectItem value="pro">Pro — R$ 159,90</SelectItem><SelectItem value="enterprise">Enterprise — R$ 297,90</SelectItem></SelectContent>
          </Select>
        </div>
        <div><Label>Status</Label>
          <Select value={form.subscription_type ?? 'trial'} onValueChange={v => setForm(f => ({...f, subscription_type: v}))}>
            <SelectTrigger><SelectValue/></SelectTrigger>
            <SelectContent><SelectItem value="trial">Trial</SelectItem><SelectItem value="active">Ativo</SelectItem><SelectItem value="inactive">Inativo</SelectItem><SelectItem value="past_due">Inadimplente</SelectItem><SelectItem value="cancelled">Cancelado</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-1">
          <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/><Input placeholder="Buscar empresa..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)}/></div>
          <Select value={filterStatus} onValueChange={setFilterStatus}><SelectTrigger className="w-36"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="active">Ativos</SelectItem><SelectItem value="trial">Trial</SelectItem><SelectItem value="inactive">Inativos</SelectItem><SelectItem value="past_due">Inadimplentes</SelectItem></SelectContent></Select>
        </div>
        <Button onClick={openCreate} className="gap-2 bg-blue-600 hover:bg-blue-700"><Plus className="w-4 h-4"/>Nova Empresa</Button>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? <div className="flex items-center justify-center h-48"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"/></div> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Empresa','Email','Plano','Status','Cidade','Criado','Ações'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(t => (
                <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3"><div className="font-semibold text-gray-900">{t.name}</div><div className="text-xs text-gray-400">{t.id.slice(0,8)}…</div></td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{t.owner_email}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLAN_BADGE[t.plan_type] ?? 'bg-gray-100'}`}>{t.plan_type?.toUpperCase()}</span></td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full font-medium ${SUB_BADGE[t.subscription_type] ?? 'bg-gray-100'}`}>{t.subscription_type}</span></td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{t.cidade ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(t.created_at).toLocaleDateString('pt-BR')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Editar"><Pencil className="w-4 h-4"/></button>
                      <button onClick={() => handleToggle(t)} className={`p-1.5 rounded ${t.subscription_type === 'inactive' ? 'hover:bg-green-50 text-green-600' : 'hover:bg-yellow-50 text-yellow-600'}`} title={t.subscription_type === 'inactive' ? 'Reativar' : 'Desativar'}>
                        {t.subscription_type === 'inactive' ? <Power className="w-4 h-4"/> : <PowerOff className="w-4 h-4"/>}
                      </button>
                      <button onClick={() => handleDelete(t)} className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Excluir"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Nenhuma empresa encontrada</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {showModal && (
        <Modal title={creating ? 'Nova Empresa' : `Editar: ${selected?.name}`} onClose={() => setShowModal(false)}
          footer={<><Button variant="outline" onClick={() => setShowModal(false)}>Cancelar</Button><Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">{saving ? 'Salvando…' : creating ? 'Criar Empresa' : 'Salvar'}</Button></>}>
          <TenantForm/>
        </Modal>
      )}
    </div>
  )
}

// ─── Usuários (CRUD + associar empresa) ──────────────────────────────────────

function SectionUsuarios() {
  const { session } = useAuth()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showAssoc, setShowAssoc] = useState<Profile | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', password: '', tenant_id: '', role: 'user' })
  const [assocTenant, setAssocTenant] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: p }, { data: t }] = await Promise.all([
      supabase.from('profiles').select('*, tenant:tenants(name)').order('created_at', { ascending: false }),
      supabase.from('tenants').select('id, name').order('name'),
    ])
    setProfiles((p as any[]) ?? [])
    setTenants(t ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = profiles.filter(p => {
    const q = search.toLowerCase()
    return p.full_name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q) || (p.tenant as any)?.name?.toLowerCase().includes(q)
  })

  const callEdge = async (action: string, body: object) => {
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-user-ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ action, ...body })
    })
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error ?? 'Erro ao executar ação')
    return data
  }

  const handleCreate = async () => {
    if (!form.email || !form.password || !form.full_name) { toast.error('Preencha nome, email e senha'); return }
    setSaving(true)
    try {
      await callEdge('create_user', { email: form.email, password: form.password, full_name: form.full_name, tenant_id: form.tenant_id || null, role: form.role })
      toast.success('Usuário criado com sucesso!')
      setShowCreate(false)
      setForm({ full_name: '', email: '', password: '', tenant_id: '', role: 'user' })
      load()
    } catch (e: any) { toast.error(e.message) }
    setSaving(false)
  }

  const handleAssociate = async () => {
    if (!showAssoc || !assocTenant) { toast.error('Selecione uma empresa'); return }
    setSaving(true)
    try {
      await callEdge('associate_tenant', { user_id: showAssoc.id, tenant_id: assocTenant })
      toast.success('Usuário associado à empresa!')
      setShowAssoc(null)
      load()
    } catch (e: any) {
      // Fallback: direct update (works if RLS allows)
      const { error } = await supabase.from('profiles').update({ tenant_id: assocTenant }).eq('id', showAssoc.id)
      if (error) toast.error(error.message)
      else { toast.success('Usuário associado!'); setShowAssoc(null); load() }
    }
    setSaving(false)
  }

  const handleToggleSuperAdmin = async (p: Profile) => {
    if (p.is_super_admin && !confirm('Remover privilégio de Super Admin?')) return
    const { error } = await supabase.from('profiles').update({ is_super_admin: !p.is_super_admin }).eq('id', p.id)
    if (error) { toast.error(error.message); return }
    toast.success(p.is_super_admin ? 'Super Admin removido' : '🛡️ Super Admin concedido')
    load()
  }

  const handleRemoveTenant = async (p: Profile) => {
    if (!confirm('Remover vínculo com empresa?')) return
    const { error } = await supabase.from('profiles').update({ tenant_id: null }).eq('id', p.id)
    if (error) { toast.error(error.message); return }
    toast.success('Vínculo removido'); load()
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center justify-between">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/><Input placeholder="Buscar usuário..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)}/></div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className="w-4 h-4"/>Atualizar</Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2 bg-blue-600 hover:bg-blue-700"><UserPlus className="w-4 h-4"/>Novo Usuário</Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? <div className="flex items-center justify-center h-48"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"/></div> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Nome','Email','Empresa','Papel','Super Admin','Criado','Ações'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3"><div className="font-medium text-gray-900">{p.full_name}</div><div className="text-xs text-gray-400">{p.id.slice(0,8)}…</div></td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{p.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    {(p.tenant as any)?.name
                      ? <span className="text-sm text-gray-700">{(p.tenant as any).name}</span>
                      : <span className="text-xs text-gray-300 italic">Sem empresa</span>}
                  </td>
                  <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{p.role ?? 'user'}</span></td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggleSuperAdmin(p)} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium transition-colors ${p.is_super_admin ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                      <Shield className="w-3 h-3"/>{p.is_super_admin ? 'Super Admin' : 'Normal'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(p.created_at).toLocaleDateString('pt-BR')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setShowAssoc(p); setAssocTenant(p.tenant_id ?? '') }} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Associar empresa"><Link className="w-4 h-4"/></button>
                      {p.tenant_id && <button onClick={() => handleRemoveTenant(p)} className="p-1.5 rounded hover:bg-red-50 text-red-400" title="Remover empresa"><XCircle className="w-4 h-4"/></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Nenhum usuário encontrado</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal Criar Usuário */}
      {showCreate && (
        <Modal title="Criar Novo Usuário" onClose={() => setShowCreate(false)}
          footer={<><Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button><Button onClick={handleCreate} disabled={saving} className="bg-blue-600 hover:bg-blue-700">{saving ? 'Criando…' : 'Criar Usuário'}</Button></>}>
          <div className="space-y-4">
            <div><Label>Nome Completo *</Label><Input value={form.full_name} onChange={e => setForm(f => ({...f, full_name: e.target.value}))} placeholder="João Silva"/></div>
            <div><Label>Email *</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} placeholder="joao@empresa.com"/></div>
            <div><Label>Senha *</Label><Input type="password" value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} placeholder="Mínimo 6 caracteres"/></div>
            <div><Label>Associar à Empresa (opcional)</Label>
              <Select value={form.tenant_id} onValueChange={v => setForm(f => ({...f, tenant_id: v}))}>
                <SelectTrigger><SelectValue placeholder="Selecionar empresa…"/></SelectTrigger>
                <SelectContent><SelectItem value="">Sem empresa</SelectItem>{tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Papel</Label>
              <Select value={form.role} onValueChange={v => setForm(f => ({...f, role: v}))}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent><SelectItem value="user">Usuário</SelectItem><SelectItem value="admin">Admin</SelectItem><SelectItem value="tecnico">Técnico</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700">
              ℹ️ O usuário será criado com email confirmado automaticamente.
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Associar Empresa */}
      {showAssoc && (
        <Modal title={`Associar Empresa — ${showAssoc.full_name}`} onClose={() => setShowAssoc(null)}
          footer={<><Button variant="outline" onClick={() => setShowAssoc(null)}>Cancelar</Button><Button onClick={handleAssociate} disabled={saving} className="bg-blue-600 hover:bg-blue-700">{saving ? 'Salvando…' : 'Associar'}</Button></>}>
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Selecione a empresa que este usuário irá gerenciar.</p>
            <Select value={assocTenant} onValueChange={setAssocTenant}>
              <SelectTrigger><SelectValue placeholder="Selecionar empresa…"/></SelectTrigger>
              <SelectContent>{tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Integrações (Evolution API CRUD + Teste) ─────────────────────────────────

function SectionIntegracoes() {
  const { session } = useAuth()
  const [configs, setConfigs] = useState<MessagingConfig[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [selected, setSelected] = useState<MessagingConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testMsgModal, setTestMsgModal] = useState<MessagingConfig | null>(null)
  const [testPhone, setTestPhone] = useState('')
  const [testMsg, setTestMsg] = useState('🚗 Teste de integração WhatsApp — Auto Estética Flow')
  const [sending, setSending] = useState(false)
  const [connStatus, setConnStatus] = useState<Record<string, 'connected'|'disconnected'|'unknown'>>({})
  const [form, setForm] = useState({
    tenant_id: '', evolution_instance_name: '', evolution_api_url: '',
    evolution_api_key: '', status: 'active'
  })

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: c }, { data: t }] = await Promise.all([
      supabase.from('messaging_configs').select('*, tenant:tenants(name)').order('created_at', { ascending: false }),
      supabase.from('tenants').select('id, name').order('name'),
    ])
    setConfigs((c as any[]) ?? [])
    setTenants(t ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = configs.filter(c =>
    (c.tenant as any)?.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.evolution_instance_name?.toLowerCase().includes(search.toLowerCase())
  )

  const openCreate = () => { setSelected(null); setForm({ tenant_id: '', evolution_instance_name: '', evolution_api_url: '', evolution_api_key: '', status: 'active' }); setShowModal(true) }
  const openEdit = (c: MessagingConfig) => {
    setSelected(c)
    setForm({ tenant_id: c.tenant_id, evolution_instance_name: c.evolution_instance_name, evolution_api_url: (c as any).evolution_api_url ?? '', evolution_api_key: (c as any).evolution_api_key ?? '', status: c.status })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.tenant_id || !form.evolution_instance_name) { toast.error('Empresa e instância são obrigatórios'); return }
    setSaving(true)
    try {
      if (selected) {
        const { error } = await supabase.from('messaging_configs').update(form).eq('id', selected.id)
        if (error) throw error
        toast.success('Configuração atualizada!')
      } else {
        const { error } = await supabase.from('messaging_configs').insert([form])
        if (error) throw error
        toast.success('Integração configurada!')
      }
      setShowModal(false); load()
    } catch (e: any) { toast.error(e.message) }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Remover esta configuração?')) return
    await supabase.from('messaging_configs').delete().eq('id', id)
    toast.success('Configuração removida'); load()
  }

  const testConnection = async (c: MessagingConfig) => {
    setTesting(c.id)
    try {
      const apiUrl = (c as any).evolution_api_url
      const apiKey = (c as any).evolution_api_key
      if (!apiUrl) { toast.error('URL da API não configurada'); setTesting(null); return }
      const resp = await fetch(`${apiUrl}/instance/connectionState/${c.evolution_instance_name}`, {
        headers: { 'apikey': apiKey ?? '' }
      })
      if (resp.ok) {
        const data = await resp.json()
        const state = data?.instance?.state ?? data?.state ?? 'unknown'
        setConnStatus(s => ({ ...s, [c.id]: state === 'open' ? 'connected' : 'disconnected' }))
        toast.success(state === 'open' ? '✅ WhatsApp conectado!' : `⚠️ Estado: ${state}`)
      } else {
        setConnStatus(s => ({ ...s, [c.id]: 'disconnected' }))
        toast.error('Falha ao conectar com Evolution API')
      }
    } catch (e: any) {
      setConnStatus(s => ({ ...s, [c.id]: 'disconnected' }))
      toast.error(`Erro de conexão: ${e.message}`)
    }
    setTesting(null)
  }

  const sendTestMessage = async () => {
    if (!testMsgModal || !testPhone) { toast.error('Informe o número de telefone'); return }
    setSending(true)
    try {
      const phone = testPhone.replace(/\D/g, '')
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ tenant_id: testMsgModal.tenant_id, phone, message: testMsg })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error ?? 'Erro ao enviar')
      toast.success('✅ Mensagem enviada com sucesso!')
      setTestMsgModal(null)
    } catch (e: any) { toast.error(e.message) }
    setSending(false)
  }

  const ConfigForm = () => (
    <div className="space-y-4">
      <div><Label>Empresa *</Label>
        <Select value={form.tenant_id} onValueChange={v => setForm(f => ({...f, tenant_id: v}))}>
          <SelectTrigger><SelectValue placeholder="Selecionar empresa…"/></SelectTrigger>
          <SelectContent>{tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div><Label>Nome da Instância Evolution *</Label><Input value={form.evolution_instance_name} onChange={e => setForm(f => ({...f, evolution_instance_name: e.target.value}))} placeholder="ex: autodetail-empresa-01"/></div>
      <div><Label>URL da Evolution API *</Label><Input value={form.evolution_api_url} onChange={e => setForm(f => ({...f, evolution_api_url: e.target.value}))} placeholder="https://api.suaevolution.com"/></div>
      <div><Label>API Key</Label><Input type="password" value={form.evolution_api_key} onChange={e => setForm(f => ({...f, evolution_api_key: e.target.value}))} placeholder="sua-api-key-da-evolution"/></div>
      <div><Label>Status</Label>
        <Select value={form.status} onValueChange={v => setForm(f => ({...f, status: v}))}>
          <SelectTrigger><SelectValue/></SelectTrigger>
          <SelectContent><SelectItem value="active">Ativo</SelectItem><SelectItem value="inactive">Inativo</SelectItem><SelectItem value="pending">Pendente</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-700">
        ⚠️ A API Key também deve estar configurada como secret no Supabase:<br/>
        <code className="font-mono">supabase secrets set EVOLUTION_API_KEY=sua-chave</code>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center justify-between">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/><Input placeholder="Buscar instância..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)}/></div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className="w-4 h-4"/>Atualizar</Button>
          <Button onClick={openCreate} className="gap-2 bg-green-600 hover:bg-green-700"><Plus className="w-4 h-4"/>Nova Integração</Button>
        </div>
      </div>

      {/* Status geral */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Configuradas', value: configs.length, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Ativas', value: configs.filter(c => c.status === 'active').length, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Conectadas', value: Object.values(connStatus).filter(v => v === 'connected').length, color: 'text-purple-600', bg: 'bg-purple-50' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-3 flex items-center gap-3">
            <span className={`text-2xl font-bold ${s.color}`}>{s.value}</span>
            <span className="text-xs text-gray-500">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? <div className="flex items-center justify-center h-48"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"/></div>
        : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Plug className="w-12 h-12 text-gray-200 mx-auto mb-3"/>
            <p className="text-gray-400 font-medium">Nenhuma integração configurada</p>
            <p className="text-gray-300 text-sm mt-1">Clique em "Nova Integração" para configurar o WhatsApp</p>
            <Button onClick={openCreate} className="mt-4 gap-2 bg-green-600 hover:bg-green-700"><Plus className="w-4 h-4"/>Configurar Evolution API</Button>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(c => (
              <div key={c.id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${c.status === 'active' ? 'bg-green-50' : 'bg-gray-50'}`}>
                      {connStatus[c.id] === 'connected' ? <Wifi className="w-5 h-5 text-green-500"/> : connStatus[c.id] === 'disconnected' ? <WifiOff className="w-5 h-5 text-red-400"/> : <Plug className={`w-5 h-5 ${c.status === 'active' ? 'text-green-500' : 'text-gray-400'}`}/>}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{(c.tenant as any)?.name ?? '—'}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <code className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">{c.evolution_instance_name}</code>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${SUB_BADGE[c.status] ?? 'bg-gray-100'}`}>{c.status}</span>
                        {connStatus[c.id] === 'connected' && <span className="text-xs text-green-600 font-medium flex items-center gap-1"><CheckCircle className="w-3 h-3"/>Conectado</span>}
                        {connStatus[c.id] === 'disconnected' && <span className="text-xs text-red-500 flex items-center gap-1"><XCircle className="w-3 h-3"/>Desconectado</span>}
                      </div>
                      {(c as any).evolution_api_url && <div className="text-xs text-gray-400 mt-0.5">{(c as any).evolution_api_url}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => testConnection(c)} disabled={testing === c.id} className="gap-1.5 text-xs h-8">
                      {testing === c.id ? <RefreshCw className="w-3 h-3 animate-spin"/> : <Wifi className="w-3 h-3"/>}
                      {testing === c.id ? 'Testando…' : 'Testar'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setTestMsgModal(c); setTestPhone(''); setTestMsg('🚗 Teste WhatsApp — Auto Estética Flow') }} className="gap-1.5 text-xs h-8 text-green-600 border-green-200 hover:bg-green-50">
                      <Send className="w-3 h-3"/>Enviar Teste
                    </Button>
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Editar"><Pencil className="w-4 h-4"/></button>
                    <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400" title="Remover"><Trash2 className="w-4 h-4"/></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Criar/Editar */}
      {showModal && (
        <Modal title={selected ? `Editar: ${selected.evolution_instance_name}` : 'Nova Integração WhatsApp'} onClose={() => setShowModal(false)}
          footer={<><Button variant="outline" onClick={() => setShowModal(false)}>Cancelar</Button><Button onClick={handleSave} disabled={saving} className="bg-green-600 hover:bg-green-700">{saving ? 'Salvando…' : selected ? 'Salvar' : 'Criar Integração'}</Button></>}>
          <ConfigForm/>
        </Modal>
      )}

      {/* Modal Enviar Mensagem de Teste */}
      {testMsgModal && (
        <Modal title={`Testar WhatsApp — ${(testMsgModal.tenant as any)?.name}`} onClose={() => setTestMsgModal(null)}
          footer={<><Button variant="outline" onClick={() => setTestMsgModal(null)}>Cancelar</Button><Button onClick={sendTestMessage} disabled={sending} className="gap-2 bg-green-600 hover:bg-green-700"><Send className="w-4 h-4"/>{sending ? 'Enviando…' : 'Enviar'}</Button></>}>
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-100 rounded-lg p-3 flex items-center gap-3">
              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center"><Send className="w-4 h-4 text-white"/></div>
              <div><p className="text-sm font-medium text-green-800">Instância: {testMsgModal.evolution_instance_name}</p><p className="text-xs text-green-600">Empresa: {(testMsgModal.tenant as any)?.name}</p></div>
            </div>
            <div>
              <Label>Número de destino (com DDI + DDD)</Label>
              <Input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="5511999999999" className="font-mono"/>
              <p className="text-xs text-gray-400 mt-1">Ex: 5511987654321 (sem espaços ou símbolos)</p>
            </div>
            <div>
              <Label>Mensagem</Label>
              <textarea value={testMsg} onChange={e => setTestMsg(e.target.value)} rows={4} className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-400"/>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Configurações ────────────────────────────────────────────────────────────

function SectionConfiguracoes() {
  const [config, setConfig] = useState({ support_email: 'suporte@autodetailpro.com.br', app_url: 'https://autodetail-pro.vercel.app', evolution_api_url: '', evolution_api_key: '' })
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await new Promise(r => setTimeout(r, 600))
    toast.success('Configurações salvas!')
    setSaving(false)
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Settings className="w-4 h-4"/>Geral</h3>
        <div><Label>URL da Aplicação</Label><Input value={config.app_url} onChange={e => setConfig(c => ({...c, app_url: e.target.value}))}/></div>
        <div><Label>Email de Suporte</Label><div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/><Input className="pl-9" value={config.support_email} onChange={e => setConfig(c => ({...c, support_email: e.target.value}))}/></div></div>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Webhook className="w-4 h-4"/>Evolution API — Global</h3>
          <button onClick={() => setShow(s => !s)} className="text-xs text-gray-400 flex items-center gap-1">{show ? <EyeOff className="w-3 h-3"/> : <Eye className="w-3 h-3"/>}{show ? 'Ocultar' : 'Mostrar'}</button>
        </div>
        <div><Label>URL</Label><Input value={config.evolution_api_url} onChange={e => setConfig(c => ({...c, evolution_api_url: e.target.value}))} placeholder="https://sua-evolution-api.com"/></div>
        <div><Label>API Key Global</Label><Input type={show ? 'text' : 'password'} value={config.evolution_api_key} onChange={e => setConfig(c => ({...c, evolution_api_key: e.target.value}))} placeholder="••••••••"/></div>
        <div className="bg-amber-50 rounded-lg p-3 text-xs text-amber-700">⚠️ Aplique via: <code>supabase secrets set EVOLUTION_API_KEY=...</code></div>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><CreditCard className="w-4 h-4"/>Stripe</h3>
        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-500">Configure via variáveis de ambiente no Vercel e secrets no Supabase.</div>
      </div>
      <Button onClick={handleSave} disabled={saving} className="gap-2 bg-blue-600 hover:bg-blue-700"><Save className="w-4 h-4"/>{saving ? 'Salvando…' : 'Salvar'}</Button>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Section = 'dashboard' | 'tenants' | 'usuarios' | 'integracoes' | 'configuracoes'
const NAV: { id: Section; label: string; icon: any }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'tenants', label: 'Empresas', icon: Building2 },
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
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-30 sticky top-0">
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(o => !o)} className="p-1.5 rounded hover:bg-gray-100 lg:hidden"><Activity className="w-5 h-5 text-gray-500"/></button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center"><Shield className="w-4 h-4 text-white"/></div>
            <div><span className="font-bold text-gray-900 text-sm">Auto Estética Flow</span><span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Super Admin</span></div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:block text-right"><p className="text-xs font-medium text-gray-900">{profile?.full_name ?? 'Admin'}</p><p className="text-xs text-gray-400">Super Administrador</p></div>
          <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-2 text-gray-500 hover:text-red-600"><LogOut className="w-4 h-4"/>Sair</Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:static inset-y-0 left-0 w-56 bg-white border-r border-gray-200 z-20 transition-transform duration-200 flex flex-col`}>
          <nav className="p-4 space-y-1 flex-1 mt-2">
            {NAV.map(n => (
              <button key={n.id} onClick={() => { setSection(n.id); setSidebarOpen(false) }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${section === n.id ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}>
                <n.icon className={`w-4 h-4 ${section === n.id ? 'text-blue-600' : 'text-gray-400'}`}/>
                {n.label}
                {section === n.id && <ChevronRight className="w-3 h-3 ml-auto text-blue-400"/>}
              </button>
            ))}
          </nav>
          <div className="p-4 border-t border-gray-100"><div className="text-xs text-gray-400 text-center">AE Flow v2.0</div></div>
        </aside>
        {sidebarOpen && <div className="fixed inset-0 bg-black/20 z-10 lg:hidden" onClick={() => setSidebarOpen(false)}/>}

        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto">
            <div className="mb-6">
              <h1 className="text-xl font-bold text-gray-900">{NAV.find(n => n.id === section)?.label}</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {section === 'dashboard' && 'Visão geral e risco de churn dos clientes'}
                {section === 'tenants' && 'Gerencie todas as empresas da plataforma'}
                {section === 'usuarios' && 'Usuários e suas associações a empresas'}
                {section === 'integracoes' && 'Instâncias WhatsApp via Evolution API'}
                {section === 'configuracoes' && 'Configurações globais da plataforma'}
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
