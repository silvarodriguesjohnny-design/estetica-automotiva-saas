import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { useState } from 'react'
import {
  LayoutDashboard,
  Users,
  Car,
  Wrench,
  ClipboardList,
  DollarSign,
  Megaphone,
  MessageSquare,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Shield,
  Package,
  FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const NAV_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/clientes', icon: Users, label: 'Clientes' },
  { to: '/veiculos', icon: Car, label: 'Veículos' },
  { to: '/tecnicos', icon: Wrench, label: 'Técnicos' },
  { to: '/ordens', icon: ClipboardList, label: 'Ordens de Serviço' },
  { to: '/financeiro', icon: DollarSign, label: 'Financeiro' },
  { to: '/estoque', icon: Package, label: 'Estoque' },
  { to: '/servicos', icon: Wrench, label: 'Serviços' },
  { to: '/campanhas', icon: Megaphone, label: 'Campanhas' },
  { to: '/mensagens', icon: MessageSquare, label: 'WhatsApp' },
  { to: '/templates', icon: FileText, label: 'Templates' },
  { to: '/settings', icon: Settings, label: 'Configurações' },
]

// Hook dark mode global
function useDarkMode() {
  const stored = localStorage.getItem('theme')
  const [dark, setDark] = useState(stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])
  return { dark, toggle: () => setDark(d => !d) }
}

export default function Layout() {
  const { dark, toggle: toggleDark } = useDarkMode()
  const { profile, tenant, isSuperAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleSignOut = async () => {
    const { error } = await signOut()
    if (error) {
      toast.error('Erro ao sair')
    } else {
      navigate('/login')
    }
  }

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'AU'

  const planColors = {
    starter: 'bg-slate-100 text-slate-700',
    pro: 'bg-blue-100 text-blue-700',
    enterprise: 'bg-purple-100 text-purple-700',
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Overlay mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 w-64 bg-card border-r border-border flex flex-col transition-transform duration-300 lg:relative lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Car className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <p className="font-bold text-sm leading-none">{tenant?.name ?? 'Auto Estética Flow'}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tenant?.plan_type && (
                  <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', planColors[tenant.plan_type])}>
                    {tenant.plan_type.toUpperCase()}
                  </span>
                )}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden h-7 w-7"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}

          {isSuperAdmin && (
            <>
              <div className="my-2 border-t border-border" />
              <NavLink
                to="/super-admin"
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-destructive text-destructive-foreground'
                      : 'text-destructive hover:bg-destructive/10',
                  )
                }
              >
                <Shield className="h-4 w-4 shrink-0" />
                Super Admin
              </NavLink>
            </>
          )}
        </nav>

        {/* Trial warning */}
        {tenant?.subscription_type === 'trial' && tenant.trial_ends_at && (
          <div className="mx-3 mb-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs font-medium text-amber-800">
              ⏰ Trial expira em{' '}
              {Math.max(
                0,
                Math.ceil(
                  (new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86400000,
                ),
              )}{' '}
              dias
            </p>
            <button
              onClick={() => navigate('/settings?tab=plano')}
              className="text-xs text-amber-600 underline mt-0.5"
            >
              Assinar agora
            </button>
          </div>
        )}

        {/* User menu */}
        <div className="p-3 border-t border-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start gap-2 px-2 h-auto py-2">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-xs bg-primary/10 text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-xs font-medium truncate">{profile?.full_name || 'Usuário'}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{profile?.email}</p>
                </div>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings className="h-4 w-4 mr-2" />
                Configurações
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="h-4 w-4 mr-2" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center gap-3 p-4 border-b border-border bg-card">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Car className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">{tenant?.name ?? 'Auto Estética Flow'}</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
