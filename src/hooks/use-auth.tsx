import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import type { Profile, Tenant } from '@/types'

interface AuthContextType {
  user: User | null
  session: Session | null
  profile: Profile | null
  tenant: Tenant | null
  isSuperAdmin: boolean
  trialExpired: boolean
  loading: boolean
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: any }>
  signIn: (email: string, password: string) => Promise<{ error: any }>
  signOut: () => Promise<{ error: any }>
  refreshAuth: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return context
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*, tenant:tenants(*)')
      .eq('id', uid)
      .single()

    if (data) {
      const { tenant: t, ...profileData } = data as any
      setProfile(profileData as Profile)
      setTenant(t as Tenant | null)
    }
  }, [])

  useEffect(() => {
    // Inicializa sessão
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Escuta mudanças de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (event === 'SIGNED_OUT') {
        setProfile(null)
        setTenant(null)
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (user) {
      fetchProfile(user.id)
    } else {
      setProfile(null)
      setTenant(null)
    }
  }, [user, fetchProfile])

  const refreshAuth = useCallback(async () => {
    if (user) await fetchProfile(user.id)
  }, [user, fetchProfile])

  const signUp = async (email: string, password: string, fullName?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    })
    return { error }
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
  }

  const isSuperAdmin = profile?.is_super_admin ?? false

  // Verifica se trial expirou (OWASP A04: access control baseado em assinatura)
  const trialExpired = useMemo(() => {
    if (!tenant) return false
    if (tenant.subscription_type === 'past_due' || tenant.subscription_type === 'cancelled') return true
    if (tenant.subscription_type === 'trial' && tenant.trial_ends_at) {
      return new Date(tenant.trial_ends_at) < new Date()
    }
    return false
  }, [tenant])

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        tenant,
        isSuperAdmin,
        trialExpired,
        loading,
        signUp,
        signIn,
        signOut,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
