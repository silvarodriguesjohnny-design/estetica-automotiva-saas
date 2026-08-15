import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ReactNode } from 'react'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Loader2 } from 'lucide-react'
import { AuthProvider, useAuth } from '@/hooks/use-auth'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import SetPassword from './pages/SetPassword'
import TrialExpired from './pages/TrialExpired'
import NotFound from './pages/NotFound'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Clientes from './pages/Clientes'
import Veiculos from './pages/Veiculos'
import Tecnicos from './pages/Tecnicos'
import OrdensServico from './pages/OrdensServico'
import Financeiro from './pages/Financeiro'
import Campanhas from './pages/Campanhas'
import MensagensWhatsApp from './pages/MensagensWhatsApp'
import Estoque from './pages/Estoque'
import Servicos from './pages/Servicos'
import TemplatesMensagens from './pages/TemplatesMensagens'
import Settings from './pages/Settings'
import SuperAdmin from './pages/SuperAdmin'
import PublicBooking from './pages/PublicBooking'

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, profile, loading } = useAuth()
  if (loading || (user && profile === undefined)) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin w-8 h-8 text-blue-600"/></div>
  if (!user) return <Navigate to="/login" replace />
  if (profile?.is_super_admin) return <Navigate to="/super-admin" replace />
  return <>{children}</>
}

function SuperAdminRoute({ children }: { children: ReactNode }) {
  const { user, profile, loading } = useAuth()
  if (loading || (user && profile === undefined)) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin w-8 h-8 text-blue-600"/></div>
  if (!user || !profile?.is_super_admin) return <Navigate to="/login" replace />
  return <>{children}</>
}

const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Routes>
          {/* Públicas */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/set-password" element={<SetPassword />} />
          <Route path="/trial-expired" element={<TrialExpired />} />
          <Route path="/agendar/:tenantId" element={<PublicBooking />} />

          {/* App — protegido */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/veiculos" element={<Veiculos />} />
            <Route path="/tecnicos" element={<Tecnicos />} />
            <Route path="/ordens" element={<OrdensServico />} />
            <Route path="/financeiro" element={<Financeiro />} />
            <Route path="/estoque" element={<Estoque />} />
            <Route path="/servicos" element={<Servicos />} />
            <Route path="/campanhas" element={<Campanhas />} />
            <Route path="/mensagens" element={<MensagensWhatsApp />} />
            <Route path="/templates" element={<TemplatesMensagens />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          {/* Super Admin — standalone, sem Layout (super admin não tem tenant) */}
          <Route path="/super-admin" element={<SuperAdminRoute><SuperAdmin /></SuperAdminRoute>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </TooltipProvider>
    </AuthProvider>
  </BrowserRouter>
)

export default App
