import { useNavigate } from 'react-router-dom'
import { Car, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/hooks/use-auth'

export default function TrialExpired() {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardContent className="pt-8 pb-8 space-y-6">
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center">
              <Clock className="h-8 w-8 text-amber-600" />
            </div>
          </div>
          <div>
            <h1 className="text-xl font-bold">Trial expirado</h1>
            <p className="text-muted-foreground text-sm mt-2">
              Seu período de 14 dias gratuitos chegou ao fim. Assine um plano para continuar usando o Auto Estética Flow.
            </p>
          </div>
          <div className="space-y-3">
            <Button className="w-full" onClick={() => navigate('/#planos')}>
              Ver Planos e Assinar
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => { signOut(); navigate('/') }}>
              Sair
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
