import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Users, Car, Wrench, ClipboardList,
  DollarSign, Megaphone, MessageSquare, Settings, LogOut,
  Menu, X, ChevronDown, Shield, Package, FileText, Repeat, Moon, Sun, CalendarDays,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

/* ── Nav groups ─────────────────────────────────────────────────────── */

const NAV_GROUPS = [
  {
    label: 'Principal',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/agenda',    icon: CalendarDays,    label: 'Agenda' },
      { to: '/ordens',    icon: ClipboardList,   label: 'Ordens de Serviço' },
      { to: '/financeiro',icon: DollarSign,       label: 'Financeiro' },
    ],
  },
  {
    label: 'Clientes & Frota',
    items: [
      { to: '/clientes',  icon: Users,   label: 'Clientes' },
      { to: '/veiculos',  icon: Car,     label: 'Veículos' },
      { to: '/tecnicos',  icon: Wrench,  label: 'Técnicos' },
    ],
  },
  {
    label: 'Catálogo',
    items: [
      { to: '/servicos',  icon: Wrench,  label: 'Serviços' },
      { to: '/combos',    icon: Repeat,  label: 'Combos & Assinaturas' },
      { to: '/estoque',   icon: Package, label: 'Estoque' },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { to: '/campanhas', icon: Megaphone,      label: 'Campanhas' },
      { to: '/mensagens', icon: MessageSquare,  label: 'WhatsApp' },
      { to: '/templates', icon: FileText,       label: 'Templates' },
    ],
  },
]

/* ── Dark mode hook ─────────────────────────────────────────────────── */

function useDarkMode() {
  const stored = localStorage.getItem('theme')
  const [dark, setDark] = useState(stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])
  return { dark, toggle: () => setDark(d => !d) }
}

/* ── Plan badge ─────────────────────────────────────────────────────── */

const PLAN_STYLES: Record<string, string> = {
  starter:    'bg-slate-700/80 text-slate-200',
  pro:        'bg-blue-600/80 text-blue-100',
  enterprise: 'bg-purple-600/80 text-purple-100',
  trial:      'bg-amber-600/80 text-amber-100',
}

/* ── Car SVG silhouette (inline, sem dependência externa) ──────────── */

function CarSilhouette({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 80" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M185 48 L178 48 L175 38 C173 32 167 28 161 28 L62 28 C56 28 46 32 40 38 L32 48 L15 48 C11 48 8 51 8 55 L8 62 C8 66 11 68 15 68 L25 68 C26 74 32 78 39 78 C46 78 52 74 53 68 L147 68 C148 74 154 78 161 78 C168 78 174 74 175 68 L185 68 C189 68 192 66 192 62 L192 55 C192 51 189 48 185 48 Z M68 28 L95 18 L140 18 L155 28 L68 28 Z" opacity="0.15"/>
      <circle cx="39" cy="70" r="10" opacity="0.2"/>
      <circle cx="161" cy="70" r="10" opacity="0.2"/>
    </svg>
  )
}

/* ── Layout ─────────────────────────────────────────────────────────── */

export default function Layout() {
  const { dark, toggle: toggleDark } = useDarkMode()
  const { profile, tenant, isSuperAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleSignOut = async () => {
    const { error } = await signOut()
    if (error) toast.error('Erro ao sair')
    else navigate('/login')
  }

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : 'AU'

  const planType = (tenant?.plan_type ?? tenant?.subscription_type ?? 'trial') as string
  const trialDays = tenant?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ── */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-30 w-64 flex flex-col transition-transform duration-300 lg:relative lg:translate-x-0',
        'bg-gray-950 dark:bg-gray-950',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      )}>

        {/* Logo / header */}
        <div className="relative overflow-hidden">
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600/20 via-transparent to-transparent pointer-events-none"/>
          {/* Car silhouette background */}
          <CarSilhouette className="absolute -bottom-2 -right-4 w-48 text-blue-400 pointer-events-none"/>

          <div className="relative flex items-center justify-between px-4 py-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/30 shrink-0">
                <Car className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-sm text-white leading-tight truncate max-w-[120px]">
                  {tenant?.name ?? 'Auto Estética Flow'}
                </p>
                {planType && (
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-semibold', PLAN_STYLES[planType] ?? PLAN_STYLES.trial)}>
                    {planType.toUpperCase()}
                  </span>
                )}
              </div>
            </div>
            <Button variant="ghost" size="icon" className="lg:hidden h-7 w-7 text-gray-400 hover:text-white hover:bg-white/10"
              onClick={() => setSidebarOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-2 overflow-y-auto space-y-4 scrollbar-thin">
          {NAV_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest px-2 mb-1">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(({ to, icon: Icon, label }) => (
                  <NavLink key={to} to={to} onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) => cn(
                      'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                      isActive
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                        : 'text-gray-400 hover:text-white hover:bg-white/8',
                    )}>
                    {({ isActive }) => (
                      <>
                        <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-white' : 'text-gray-500')} />
                        <span className="truncate">{label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}

          {/* Configurações */}
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest px-2 mb-1">Sistema</p>
            <NavLink to="/settings" onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                isActive ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20' : 'text-gray-400 hover:text-white hover:bg-white/8',
              )}>
              {({ isActive }) => (
                <>
                  <Settings className={cn('h-4 w-4 shrink-0', isActive ? 'text-white' : 'text-gray-500')} />
                  Configurações
                </>
              )}
            </NavLink>

            {isSuperAdmin && (
              <NavLink to="/super-admin" onClick={() => setSidebarOpen(false)}
                className={({ isActive }) => cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all mt-0.5',
                  isActive ? 'bg-red-600 text-white' : 'text-red-400 hover:text-red-300 hover:bg-red-500/10',
                )}>
                {({ isActive }) => (
                  <>
                    <Shield className={cn('h-4 w-4 shrink-0', isActive ? 'text-white' : 'text-red-400')} />
                    Super Admin
                  </>
                )}
              </NavLink>
            )}
          </div>
        </nav>

        {/* Trial banner */}
        {planType === 'trial' && trialDays !== null && (
          <div className="mx-3 mb-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
            <p className="text-xs font-semibold text-amber-400">
              ⏰ Trial: {trialDays} dia{trialDays !== 1 ? 's' : ''} restante{trialDays !== 1 ? 's' : ''}
            </p>
            <button onClick={() => navigate('/settings?tab=plano')}
              className="text-xs text-amber-500 underline mt-0.5 hover:text-amber-300">
              Assinar agora →
            </button>
          </div>
        )}

        {/* User menu */}
        <div className="p-3 border-t border-white/5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost"
                className="w-full justify-start gap-2.5 px-2 h-auto py-2 text-gray-300 hover:text-white hover:bg-white/8">
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback className="text-xs bg-blue-600 text-white font-bold">{initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-xs font-medium truncate text-white">{profile?.full_name || 'Usuário'}</p>
                  <p className="text-[10px] text-gray-500 truncate">{profile?.email}</p>
                </div>
                <ChevronDown className="h-3 w-3 text-gray-500 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={toggleDark}>
                {dark ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
                {dark ? 'Modo claro' : 'Modo escuro'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings className="h-4 w-4 mr-2" />Configurações
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="h-4 w-4 mr-2" />Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-gray-950">
          <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center">
              <Car className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-semibold text-sm text-white">{tenant?.name ?? 'Auto Estética Flow'}</span>
          </div>
          <button onClick={toggleDark} className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-white">
            {dark ? <Sun className="w-4 h-4"/> : <Moon className="w-4 h-4"/>}
          </button>
        </header>

        <main className="flex-1 overflow-y-auto bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
