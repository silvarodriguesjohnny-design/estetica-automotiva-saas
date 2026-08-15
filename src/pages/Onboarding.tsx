import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/lib/supabase/client'
import { Car, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

export default function Onboarding() {
  const { user, refreshAuth } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [nome, setNome] = useState('')
  const [cidade, setCidade] = useState('')
  const [telefone, setTelefone] = useState('')

  const handleConcluir = async () => {
    setLoading(true)
    try {
      if (user) {
        await supabase.from('tenants').update({ cidade, phone: telefone }).eq('owner_id', user.id)
      }
      await refreshAuth()
      navigate('/dashboard')
      toast.success('Bem-vindo ao Auto Estética Flow! 🚗')
    } catch {
      navigate('/dashboard')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center">
              <Car className="h-6 w-6 text-primary-foreground" />
            </div>
          </div>
          <CardTitle>Configuração inicial</CardTitle>
          <p className="text-sm text-muted-foreground">Passo {step} de 2</p>
        </CardHeader>
        <CardContent>
          {step === 1 ? (
            <div className="space-y-4">
              <p className="text-sm text-center text-muted-foreground">
                Vamos configurar algumas informações básicas da sua estética.
              </p>
              <div className="space-y-1.5">
                <Label>Nome da sua estética</Label>
                <Input placeholder="Premium Detail SP" value={nome} onChange={e => setNome(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Cidade</Label>
                <Input placeholder="São Paulo, SP" value={cidade} onChange={e => setCidade(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Telefone de contato</Label>
                <Input placeholder="(11) 99999-9999" value={telefone} onChange={e => setTelefone(e.target.value)} />
              </div>
              <Button className="w-full" onClick={() => setStep(2)}>Próximo</Button>
            </div>
          ) : (
            <div className="space-y-6 text-center">
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
              <div>
                <h3 className="font-bold text-lg">Tudo pronto!</h3>
                <p className="text-muted-foreground text-sm mt-2">
                  Seu sistema já está configurado com serviços padrão da estética automotiva.
                  Você pode personalizar tudo em Configurações.
                </p>
              </div>
              <div className="text-left space-y-2 p-4 bg-muted/50 rounded-lg">
                <p className="text-sm font-semibold mb-2">Próximos passos:</p>
                <p className="text-sm text-muted-foreground">1. Cadastre seus primeiros clientes</p>
                <p className="text-sm text-muted-foreground">2. Adicione os veículos deles</p>
                <p className="text-sm text-muted-foreground">3. Crie sua primeira Ordem de Serviço</p>
                <p className="text-sm text-muted-foreground">4. Configure o WhatsApp para notificações</p>
              </div>
              <Button className="w-full" onClick={handleConcluir} disabled={loading}>
                {loading ? 'Configurando...' : 'Ir para o Dashboard'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
