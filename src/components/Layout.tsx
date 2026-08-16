import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Users, Car, Wrench, ClipboardList,
  DollarSign, Megaphone, MessageSquare, Settings, LogOut,
  Menu, X, ChevronDown, Shield, Package, FileText,
  Calendar, Sun, Moon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const NAV_ITEMS = [
  { to: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/clientes',   icon: Users,           label: 'Clientes' },
  { to: '/veiculos',   icon: Car,             label: 'Veículos' },
  { to: '/tecnicos',   icon: Wrench,          label: 'Técnicos' },
  { to: '/ordens',     icon: ClipboardList,   label: 'Ordens de Serviço' },
  { to: '/financeiro', icon: DollarSign,      label: 'Financeiro' },
  { to: '/estoque',    icon: Package,         label: 'Estoque' },
  { to: '/servicos',   icon: Wrench,          label: 'Serviços' },
  { to: '/campanhas',  icon: Megaphone,       label: 'Campanhas' },
  { to: '/mensagens',  icon: MessageSquare,   label: 'WhatsApp' },
  { to: '/templates',  icon: FileText,        label: 'Templates' },
  { to: '/settings',   icon: Settings,        label: 'Configurações' },
]

function useDarkMode() {
  const stored = localStorage.getItem('theme')
  const [dark, setDark] = useState(
    stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)
  )
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])
  return { dark, toggle: () => setDark(d => !d) }
}

const PLAN_STYLES: Record<string, string> = {
  starter:    'bg-blue-50 text-blue-700 border border-blue-100',
  pro:        'bg-purple-50 text-purple-700 border border-purple-100',
  enterprise: 'bg-amber-50 text-amber-700 border border-amber-100',
  trial:      'bg-gray-100 text-gray-600',
}

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

  const planType = tenant?.plan_type ?? 'trial'
  const daysLeft = tenant?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ── */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-30 w-60 bg-card border-r border-border flex flex-col transition-transform duration-300 lg:relative lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center shrink-0 shadow-sm">
              <Car className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm leading-tight truncate text-foreground">
                {tenant?.name ?? 'Auto Estética Flow'}
              </p>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md font-semibold mt-0.5 inline-block', PLAN_STYLES[planType])}>
                {planType.toUpperCase()}
              </span>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden h-7 w-7 shrink-0" onClick={() => setSidebarOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}>
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}

          {isSuperAdmin && (
            <>
              <div className="my-2 border-t border-border" />
              <NavLink to="/super-admin" onClick={() => setSidebarOpen(false)}
                className={({ isActive }) => cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive ? 'bg-destructive text-white' : 'text-destructive hover:bg-destructive/10',
                )}>
                <Shield className="h-4 w-4 shrink-0" />
                Super Admin
              </NavLink>
            </>
          )}
        </nav>

        {/* Trial banner */}
        {tenant?.subscription_type === 'trial' && daysLeft !== null && (
          <div className="mx-3 mb-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              ⏰ Trial expira em {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'}
            </p>
            <button onClick={() => navigate('/settings?tab=plano')} className="text-xs text-amber-600 dark:text-amber-400 underline mt-0.5 hover:no-underline">
              Assinar agora →
            </button>
          </div>
        )}

        {/* User menu */}
        <div className="p-3 border-t border-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start gap-2.5 px-2 h-auto py-2 hover:bg-accent">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="text-xs font-bold bg-primary/10 text-primary">{initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-xs font-semibold truncate text-foreground">{profile?.full_name || 'Usuário'}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{profile?.email ?? profile?.role}</p>
                </div>
                <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={toggleDark} className="gap-2">
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {dark ? 'Modo Claro' : 'Modo Escuro'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/settings')} className="gap-2">
                <Settings className="h-4 w-4" />
                Configurações
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive gap-2">
                <LogOut className="h-4 w-4" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-card shadow-sm">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <Car className="h-5 w-5 text-primary shrink-0" />
            <span className="font-bold text-sm truncate text-foreground">{tenant?.name ?? 'Auto Estética Flow'}</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
