import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/lib/supabase/client'
import { Settings as SettingsIcon, Building, Palette, Shield, Link2, Copy, ExternalLink, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { PLANS } from '@/types'

export default function Settings() {
  const { tenant, profile, refreshAuth } = useAuth()
  const [saving, setSaving] = useState(false)
  const [tenantName, setTenantName] = useState(tenant?.name ?? '')
  const [phone, setPhone] = useState(tenant?.phone ?? '')
  const [email, setEmail] = useState(tenant?.email ?? '')
  const [cidade, setCidade] = useState(tenant?.cidade ?? '')
  const [estado, setEstado] = useState(tenant?.estado ?? '')

  useEffect(() => {
    if (tenant) {
      setTenantName(tenant.name)
      setPhone(tenant.phone ?? '')
      setEmail(tenant.email ?? '')
      setCidade((tenant as any).cidade ?? '')
      setEstado((tenant as any).estado ?? '')
    }
  }, [tenant])

  const saveGeneral = async () => {
    setSaving(true)
    try {
      const { error } = await supabase.from('tenants').update({
        name: tenantName, phone, email, cidade, estado
      }).eq('id', tenant!.id)
      if (error) throw error
      await refreshAuth()
      toast.success('Configurações salvas!')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const currentPlan = PLANS.find(p => p.id === tenant?.plan_type) ?? PLANS[0]

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-sm text-muted-foreground">Gerencie sua conta e preferências</p>
      </div>

      <Tabs defaultValue="geral">
        <TabsList>
          <TabsTrigger value="geral">Geral</TabsTrigger>
          <TabsTrigger value="agendamento">Agendamento</TabsTrigger>
          <TabsTrigger value="plano">Plano</TabsTrigger>
          <TabsTrigger value="seguranca">Segurança</TabsTrigger>
        </TabsList>

        <TabsContent value="geral" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Building className="h-4 w-4" /> Dados do negócio
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Nome da estética</Label>
                  <Input value={tenantName} onChange={e => setTenantName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>E-mail comercial</Label>
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Telefone</Label>
                  <Input value={phone} onChange={e => setPhone(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Cidade</Label>
                  <Input value={cidade} onChange={e => setCidade(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Estado (UF)</Label>
                  <Input maxLength={2} value={estado} onChange={e => setEstado(e.target.value)} />
                </div>
              </div>
              <Button onClick={saveGeneral} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar alterações'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plano" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Plano atual</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-lg">{currentPlan.name}</span>
                  <span className="text-2xl font-bold">R$ {currentPlan.price}<span className="text-sm font-normal text-muted-foreground">/mês</span></span>
                </div>
                <p className="text-sm text-muted-foreground">{currentPlan.description}</p>
                <div className="mt-3 space-y-1">
                  {currentPlan.features.slice(0, 4).map(f => (
                    <p key={f} className="text-xs text-muted-foreground">✓ {f}</p>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold">Fazer upgrade</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {PLANS.filter(p => p.id !== tenant?.plan_type).map(p => (
                    <div key={p.id} className="p-3 border border-border rounded-lg">
                      <p className="font-semibold text-sm">{p.name}</p>
                      <p className="text-xs text-muted-foreground">R$ {p.price}/mês</p>
                      <Button size="sm" className="mt-2 w-full" variant="outline">
                        Fazer upgrade
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seguranca" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Shield className="h-4 w-4" /> Segurança da conta
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-2">
                <p><strong>E-mail:</strong> {profile?.email}</p>
                <p><strong>Role:</strong> {profile?.role}</p>
                <p><strong>Autenticação:</strong> Supabase Auth (PKCE Flow)</p>
                <p><strong>Sessão:</strong> JWT com refresh automático</p>
              </div>
              <Button variant="outline" onClick={async () => {
                const { error } = await supabase.auth.resetPasswordForEmail(profile?.email ?? '')
                if (!error) toast.success('E-mail de redefinição enviado!')
              }}>
                Redefinir senha
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Agendamento ── */}
        <TabsContent value="agendamento" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="w-5 h-5 text-primary"/>
                Link de Agendamento Público
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Compartilhe este link com seus clientes. Eles podem agendar serviços, escolher combos e pagar antecipado — sem precisar ligar.
              </p>

              {/* Link display */}
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-lg px-4 py-3 font-mono text-sm text-foreground break-all border border-border">
                  {`${window.location.origin}/agendar/${tenant?.id}`}
                </div>
                <Button variant="outline" size="icon" className="shrink-0 h-12 w-12"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/agendar/${tenant?.id}`)
                    toast.success('Link copiado!')
                  }}>
                  <Copy className="w-4 h-4"/>
                </Button>
                <a href={`/agendar/${tenant?.id}`} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="icon" className="shrink-0 h-12 w-12">
                    <ExternalLink className="w-4 h-4"/>
                  </Button>
                </a>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <a href={`/agendar/${tenant?.id}`} target="_blank" rel="noopener noreferrer" className="block">
                  <Button className="w-full gap-2 bg-primary hover:bg-primary/90">
                    <ExternalLink className="w-4 h-4"/>
                    Abrir agenda pública
                  </Button>
                </a>
                <Button variant="outline" className="gap-2 w-full"
                  onClick={() => {
                    const text = `Agende seu serviço na ${tenant?.name}!

🔗 ${window.location.origin}/agendar/${tenant?.id}

Escolha o horário, serviço e pague online.`
                    navigator.clipboard.writeText(text)
                    toast.success('Mensagem copiada — cole no WhatsApp!')
                  }}>
                  <Copy className="w-4 h-4"/>
                  Copiar mensagem WhatsApp
                </Button>
              </div>

              {/* Tips */}
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 rounded-xl p-4 space-y-2">
                <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">💡 Como usar</p>
                <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1 list-disc list-inside">
                  <li>Coloque o link na bio do Instagram</li>
                  <li>Mande no WhatsApp para seus clientes</li>
                  <li>Imprima um QR Code e cole na recepção</li>
                  <li>Adicione na sua página do Google Meu Negócio</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
