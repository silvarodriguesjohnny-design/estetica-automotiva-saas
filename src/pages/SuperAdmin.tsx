import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Users, TrendingUp, TrendingDown, AlertTriangle, DollarSign,
  Activity, Search, RefreshCw, ExternalLink, Clock,
  CheckCircle2, XCircle, BarChart3, Zap
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'

interface Tenant {
  id: string
  name: string
  owner_email: string
  subscription_type: string
  plan: string
  trial_ends_at: string | null
  created_at: string
  cidade: string | null
  // computed
  total_os: number
  total_customers: number
  last_os_date: string | null
  days_since_last_os: number | null
  churn_risk: 'low' | 'medium' | 'high' | 'critical'
  churn_reasons: string[]
  monthly_revenue: number
  usage_score: number
}

const CHURN_COLOR: Record<string, string> = {
  low: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
}

const CHURN_LABEL: Record<string, string> = {
  low: '✅ Saudável',
  medium: '⚠️ Atenção',
  high: '🔴 Risco Alto',
  critical: '🚨 Crítico',
}

const PLAN_PRICE: Record<string, number> = {
  starter: 97.33,
  pro: 159.90,
  enterprise: 297.90,
  trial: 0,
}

function computeChurnRisk(tenant: Partial<Tenant>): { risk: Tenant['churn_risk']; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  const daysSinceOs = tenant.days_since_last_os ?? 999
  const totalOs = tenant.total_os ?? 0
  const totalCustomers = tenant.total_customers ?? 0

  if (totalOs === 0) { reasons.push('Nenhuma OS criada'); score += 40 }
  else if (daysSinceOs > 30) { reasons.push(`Sem OS há ${daysSinceOs} dias`); score += 30 }
  else if (daysSinceOs > 14) { reasons.push('Pouca atividade recente'); score += 15 }

  if (totalOs < 3 && totalOs > 0) { reasons.push('Baixo volume de serviços'); score += 20 }
  if (totalCustomers < 2) { reasons.push('Poucos clientes cadastrados'); score += 15 }
  if (tenant.subscription_type === 'trial' && tenant.trial_ends_at) {
    const daysLeft = Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86400000)
    if (daysLeft <= 3) { reasons.push(`Trial expira em ${daysLeft} dia(s)`); score += 25 }
  }

  if (score >= 55) return { risk: 'critical', reasons }
  if (score >= 35) return { risk: 'high', reasons }
  if (score >= 15) return { risk: 'medium', reasons }
  return { risk: 'low', reasons }
}

export default function SuperAdmin() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [riskFilter, setRiskFilter] = useState('all')
  const [planFilter, setPlanFilter] = useState('all')
  const [sortBy, setSortBy] = useState('churn_risk')

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    try {
      const [{ data: tenantsData }, { data: ordersData }, { data: customersData }] = await Promise.all([
        supabase.from('tenants').select('*').order('created_at', { ascending: false }),
        supabase.from('service_orders').select('tenant_id, created_at'),
        supabase.from('customers').select('tenant_id'),
      ])

      // Agregar OS por tenant
      const osMap: Record<string, { count: number; lastDate: string | null }> = {}
      ;(ordersData || []).forEach(o => {
        if (!osMap[o.tenant_id]) osMap[o.tenant_id] = { count: 0, lastDate: null }
        osMap[o.tenant_id].count++
        if (!osMap[o.tenant_id].lastDate || o.created_at > osMap[o.tenant_id].lastDate!) {
          osMap[o.tenant_id].lastDate = o.created_at
        }
      })

      // Clientes por tenant
      const custMap: Record<string, number> = {}
      ;(customersData || []).forEach(c => { custMap[c.tenant_id] = (custMap[c.tenant_id] || 0) + 1 })

      const enriched: Tenant[] = (tenantsData || []).map(t => {
        const os = osMap[t.id] || { count: 0, lastDate: null }
        const daysSince = os.lastDate
          ? Math.floor((Date.now() - new Date(os.lastDate).getTime()) / 86400000)
          : null
        const { risk, reasons } = computeChurnRisk({
          days_since_last_os: daysSince,
          total_os: os.count,
          total_customers: custMap[t.id] || 0,
          subscription_type: t.subscription_type,
          trial_ends_at: t.trial_ends_at,
        })
        const usageScore = Math.max(0, 100 - (daysSince ?? 100) * 2 + os.count * 3 + (custMap[t.id] || 0) * 2)

        return {
          ...t,
          total_os: os.count,
          total_customers: custMap[t.id] || 0,
          last_os_date: os.lastDate,
          days_since_last_os: daysSince,
          churn_risk: risk,
          churn_reasons: reasons,
          monthly_revenue: PLAN_PRICE[t.plan || t.subscription_type] || 0,
          usage_score: Math.min(100, usageScore),
        }
      })

      setTenants(enriched)
    } finally {
      setLoading(false)
    }
  }

  const filtered = tenants
    .filter(t => {
      const matchSearch = t.name.toLowerCase().includes(search.toLowerCase()) ||
        (t.owner_email || '').toLowerCase().includes(search.toLowerCase())
      const matchRisk = riskFilter === 'all' || t.churn_risk === riskFilter
      const matchPlan = planFilter === 'all' || (t.plan || t.subscription_type) === planFilter
      return matchSearch && matchRisk && matchPlan
    })
    .sort((a, b) => {
      const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 }
      if (sortBy === 'churn_risk') return (riskOrder[a.churn_risk] ?? 4) - (riskOrder[b.churn_risk] ?? 4)
      if (sortBy === 'total_os') return b.total_os - a.total_os
      if (sortBy === 'revenue') return b.monthly_revenue - a.monthly_revenue
      if (sortBy === 'created') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      return 0
    })

  const mrr = tenants.reduce((s, t) => s + t.monthly_revenue, 0)
  const active = tenants.filter(t => t.subscription_type === 'active' || t.subscription_type === 'pro' || t.subscription_type === 'enterprise').length
  const critical = tenants.filter(t => t.churn_risk === 'critical').length
  const highRisk = tenants.filter(t => t.churn_risk === 'high' || t.churn_risk === 'critical').length
  const atRisk = tenants.filter(t => t.churn_risk === 'critical' || t.churn_risk === 'high').reduce((s,t) => s + t.monthly_revenue, 0)

  // Chart data
  const riskChart = [
    { name: 'Saudável', value: tenants.filter(t=>t.churn_risk==='low').length, fill: '#22c55e' },
    { name: 'Atenção', value: tenants.filter(t=>t.churn_risk==='medium').length, fill: '#f59e0b' },
    { name: 'Risco Alto', value: tenants.filter(t=>t.churn_risk==='high').length, fill: '#f97316' },
    { name: 'Crítico', value: tenants.filter(t=>t.churn_risk==='critical').length, fill: '#ef4444' },
  ]

  const topOs = [...tenants].sort((a,b)=>b.total_os-a.total_os).slice(0,5)

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Super Admin</h1>
          <p className="text-gray-500 text-sm">Dashboard de assinaturas e saúde da plataforma</p>
        </div>
        <Button onClick={fetchAll} variant="outline" className="gap-2" disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}/>Atualizar
        </Button>
      </div>

      {/* KPIs principais */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-600"/>
            </div>
            <p className="text-sm text-gray-500">Total clientes</p>
          </div>
          <p className="text-3xl font-black">{tenants.length}</p>
          <p className="text-xs text-gray-400 mt-1">{active} ativos pagos</p>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-green-600"/>
            </div>
            <p className="text-sm text-gray-500">MRR</p>
          </div>
          <p className="text-3xl font-black text-green-700">
            {mrr.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </p>
          <p className="text-xs text-gray-400 mt-1">Receita mensal recorrente</p>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-orange-100 rounded-lg flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-orange-600"/>
            </div>
            <p className="text-sm text-gray-500">Em risco de churn</p>
          </div>
          <p className="text-3xl font-black text-orange-600">{highRisk}</p>
          <p className="text-xs text-orange-500 mt-1">
            {atRisk.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em risco
          </p>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-red-100 rounded-lg flex items-center justify-center">
              <Zap className="w-5 h-5 text-red-600"/>
            </div>
            <p className="text-sm text-gray-500">Críticos</p>
          </div>
          <p className="text-3xl font-black text-red-600">{critical}</p>
          <p className="text-xs text-red-400 mt-1">Ação imediata necessária</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4"/>Saúde dos clientes
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={riskChart}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }}/>
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }}/>
              <Tooltip/>
              <Bar dataKey="value" fill="#3b82f6" radius={[4,4,0,0]}
                   label={{ position: 'top', fontSize: 12, fontWeight: 'bold' }}>
                {riskChart.map((entry, i) => (
                  <rect key={i} fill={entry.fill}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4"/>Top 5 clientes por OS
          </h3>
          <div className="space-y-3">
            {topOs.map((t, i) => (
              <div key={t.id} className="flex items-center gap-3">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold shrink-0">
                  {i+1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{t.name}</p>
                  <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                    <div className="bg-blue-500 h-1.5 rounded-full"
                         style={{ width: `${Math.min(100, (t.total_os / (topOs[0]?.total_os || 1)) * 100)}%` }}/>
                  </div>
                </div>
                <span className="text-sm font-bold text-gray-700 shrink-0">{t.total_os} OS</span>
              </div>
            ))}
            {topOs.length === 0 && <p className="text-gray-400 text-sm">Nenhuma OS ainda</p>}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
          <Input className="pl-9 bg-white" placeholder="Buscar por nome ou email..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <Select value={riskFilter} onValueChange={setRiskFilter}>
          <SelectTrigger className="w-44 bg-white"><SelectValue placeholder="Risco de churn"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os riscos</SelectItem>
            <SelectItem value="critical">🚨 Crítico</SelectItem>
            <SelectItem value="high">🔴 Risco Alto</SelectItem>
            <SelectItem value="medium">⚠️ Atenção</SelectItem>
            <SelectItem value="low">✅ Saudável</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-44 bg-white"><SelectValue placeholder="Ordenar por"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="churn_risk">Risco de churn</SelectItem>
            <SelectItem value="total_os">Mais OS</SelectItem>
            <SelectItem value="revenue">Maior receita</SelectItem>
            <SelectItem value="created">Mais recentes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabela de clientes */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-5 py-3 border-b bg-gray-50 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">{filtered.length} clientes</h3>
          <p className="text-xs text-gray-400">Ordenado por risco de churn</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Cliente</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Plano</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">OS</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Última atividade</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Risco Churn</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Causa raiz</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">MRR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">Carregando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">Nenhum cliente encontrado</td></tr>
              ) : filtered.map(t => (
                <tr key={t.id} className={`hover:bg-gray-50 transition-colors ${t.churn_risk === 'critical' ? 'bg-red-50/40' : ''}`}>
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-semibold text-gray-900">{t.name}</p>
                      <p className="text-xs text-gray-400">{t.owner_email}</p>
                      {t.cidade && <p className="text-xs text-gray-400">{t.cidade}</p>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-xs">
                      {t.plan || t.subscription_type || 'trial'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold">{t.total_os}</span>
                      <span className="text-gray-400 text-xs">OS</span>
                    </div>
                    <p className="text-xs text-gray-400">{t.total_customers} clientes</p>
                  </td>
                  <td className="px-4 py-3">
                    {t.days_since_last_os !== null ? (
                      <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-gray-400"/>
                        <span className={t.days_since_last_os > 30 ? 'text-red-600 font-medium' : 'text-gray-700'}>
                          há {t.days_since_last_os}d
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">Sem OS</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${CHURN_COLOR[t.churn_risk]}`}>
                      {CHURN_LABEL[t.churn_risk]}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-[200px]">
                    {t.churn_reasons.length > 0 ? (
                      <ul className="space-y-0.5">
                        {t.churn_reasons.map((r, i) => (
                          <li key={i} className="text-xs text-orange-700 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 shrink-0"/>{r}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5"/>Nenhum sinal
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-green-700">
                      {t.monthly_revenue > 0
                        ? t.monthly_revenue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                        : <span className="text-gray-400 text-xs">Trial</span>
                      }
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
