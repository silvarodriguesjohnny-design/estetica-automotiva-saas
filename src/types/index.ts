// ============================================================
// TIPOS PRINCIPAIS - SISTEMA ESTÉTICA AUTOMOTIVA
// ============================================================

export interface Profile {
  id: string
  role: 'admin' | 'operator' | 'viewer'
  full_name: string
  email: string
  avatar_url: string | null
  created_at: string
  tenant_id: string | null
  is_super_admin: boolean
}

export type PlanType = 'starter' | 'pro' | 'enterprise'
export type SubscriptionType = 'trial' | 'active' | 'past_due' | 'cancelled'
export type ServiceOrderStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
export type PaymentStatus = 'pending' | 'paid' | 'partial' | 'cancelled'
export type PaymentMethod = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'transferencia' | 'boleto'
export type ServiceCategory =
  | 'lavagem'
  | 'polimento'
  | 'vitrificacao'
  | 'ppf'
  | 'higienizacao'
  | 'funilaria'
  | 'pelicula'
  | 'cristalizacao'
  | 'detailing'
  | 'outros'
export type FuelType = 'gasolina' | 'etanol' | 'flex' | 'diesel' | 'eletrico' | 'hibrido'
export type PhotoType = 'before' | 'during' | 'after'

export interface Tenant {
  id: string
  name: string
  slug: string
  logo_url: string | null
  plan_type: PlanType
  subscription_type: SubscriptionType
  subscription_id: string | null
  trial_ends_at: string | null
  whatsapp_phone: string | null
  whatsapp_instance: string | null
  owner_id: string
  created_at: string
  updated_at: string
  full_name?: string | null
  email?: string | null
  phone?: string | null
  cpf_cnpj?: string | null
  cep?: string | null
  rua?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  is_active?: boolean
  horario_funcionamento?: Record<string, unknown> | null
  numero_vagas?: number | null
  quantidade_tecnicos?: number | null
}

export interface Customer {
  id: string
  tenant_id: string
  name: string
  email: string | null
  phone: string | null
  cpf: string | null
  birthday: string | null
  notes: string | null
  communication_preferences: string[] | null
  discount_percentage: number | null
  created_at: string
  last_visit_at: string | null
}

export interface Vehicle {
  id: string
  tenant_id: string
  customer_id: string
  brand: string
  model: string
  year: number | null
  color: string | null
  plate: string | null
  vin: string | null
  fuel_type: FuelType | null
  notes: string | null
  created_at: string
}

export interface VehicleWithCustomer extends Vehicle {
  customer?: Pick<Customer, 'id' | 'name' | 'phone'>
}

export interface Technician {
  id: string
  tenant_id: string
  name: string
  phone: string | null
  specialty: string[] | null
  is_active: boolean
  created_at: string
}

export interface Service {
  id: string
  tenant_id: string
  name: string
  description: string | null
  price: number
  duration_minutes: number
  category: ServiceCategory | null
  is_active: boolean
  created_at: string
}

export interface ServiceOrder {
  id: string
  tenant_id: string
  order_number: number
  customer_id: string
  vehicle_id: string
  technician_id: string | null
  status: ServiceOrderStatus
  start_time: string
  estimated_end_time: string | null
  end_time: string | null
  notes: string | null
  internal_notes: string | null
  total_amount: number
  payment_method: PaymentMethod | null
  payment_status: PaymentStatus
  created_at: string
  updated_at: string
}

export interface ServiceOrderItem {
  id: string
  tenant_id: string
  service_order_id: string
  service_id: string | null
  name: string
  price: number
  quantity: number
  created_at: string
}

export interface ServiceOrderPhoto {
  id: string
  tenant_id: string
  service_order_id: string
  url: string
  type: PhotoType
  created_at: string
}

export interface ServiceOrderWithRelations extends ServiceOrder {
  customer?: Pick<Customer, 'id' | 'name' | 'phone'>
  vehicle?: Pick<Vehicle, 'id' | 'brand' | 'model' | 'plate' | 'color'>
  technician?: Pick<Technician, 'id' | 'name'>
  items?: ServiceOrderItem[]
  photos?: ServiceOrderPhoto[]
}

export type TransactionType = 'income' | 'expense'

export interface Transaction {
  id: string
  tenant_id: string
  type: TransactionType
  amount: number
  description: string | null
  category: string | null
  payment_method: string | null
  customer_id: string | null
  service_order_id: string | null
  created_at: string
}

export interface Campaign {
  id: string
  tenant_id: string
  title: string
  discount_percentage: number
  start_date: string | null
  end_date: string | null
  auto_trigger: boolean
  trigger_days_inactive: number | null
  message_template: string | null
  is_active: boolean
  created_at: string
}

export interface MessagingConfig {
  id: string
  tenant_id: string
  channel: string
  instance_name: string | null
  api_key: string | null
  webhook_url: string | null
  is_active: boolean
  connected_at: string | null
  created_at: string
}

export interface InactivityAlert {
  id: string
  tenant_id: string
  days: number
  message: string
  channels: string[]
  active: boolean
  created_at: string
}

export interface PendingTenant {
  id: string
  full_name: string
  email: string
  phone: string | null
  cpf_cnpj: string | null
  nome_negocio: string
  plan_type: PlanType
  cep: string | null
  rua: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  estado: string | null
  numero_vagas: number
  quantidade_tecnicos: number
  horario_funcionamento: string | null
  status: 'pending' | 'approved' | 'rejected' | 'converted'
  payment_session_id: string | null
  created_at: string
}

export interface DashboardMetrics {
  totalRevenue: number
  ordensAbertas: number
  ordensHoje: number
  veiculosAtendidos: number
  ticketMedio: number
  clientesAtivos: number
  clientesInativos: number
  revenueData: { day: string; income: number }[]
  categoryData: { name: string; value: number; fill: string }[]
  recentOrders: ServiceOrderWithRelations[]
  statusDistribution: { status: string; count: number }[]
}

export interface PlanConfig {
  id: PlanType
  name: string
  price: number
  description: string
  features: string[]
  maxTechnicians: number
  maxVehiclesPerMonth: number
  highlighted?: boolean
}

export const PLANS: PlanConfig[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 97,
    description: 'Ideal para estéticas que estão começando',
    maxTechnicians: 3,
    maxVehiclesPerMonth: 100,
    features: [
      'Até 3 técnicos',
      'Até 100 OS/mês',
      'Gestão de clientes e veículos',
      'Ordens de Serviço completas',
      'Financeiro básico',
      'Agendamento online',
      'Suporte por e-mail',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 197,
    description: 'Para estéticas em crescimento',
    maxTechnicians: 10,
    maxVehiclesPerMonth: 500,
    highlighted: true,
    features: [
      'Até 10 técnicos',
      'OS ilimitadas',
      'Tudo do Starter',
      'Notificações WhatsApp',
      'Campanhas de marketing',
      'Fotos before/after nas OS',
      'Relatórios avançados',
      'Alertas de inatividade',
      'Suporte prioritário',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 397,
    description: 'Para redes e franquias',
    maxTechnicians: 999,
    maxVehiclesPerMonth: 999999,
    features: [
      'Técnicos ilimitados',
      'Multi-unidade',
      'Tudo do Pro',
      'API de integração',
      'Webhook personalizado',
      'Gestor de conta dedicado',
      'Onboarding guiado',
      'SLA garantido',
      'Customizações sob medida',
    ],
  },
]

export const SERVICE_CATEGORIES: { value: ServiceCategory; label: string }[] = [
  { value: 'lavagem', label: 'Lavagem' },
  { value: 'polimento', label: 'Polimento' },
  { value: 'vitrificacao', label: 'Vitrificação' },
  { value: 'ppf', label: 'PPF (Película Protetora)' },
  { value: 'higienizacao', label: 'Higienização Interna' },
  { value: 'funilaria', label: 'Funilaria e Pintura' },
  { value: 'pelicula', label: 'Película Solar' },
  { value: 'cristalizacao', label: 'Cristalização' },
  { value: 'detailing', label: 'Detailing Completo' },
  { value: 'outros', label: 'Outros' },
]

export const ORDER_STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  pending: 'Aguardando',
  confirmed: 'Confirmado',
  in_progress: 'Em Andamento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
}

export const ORDER_STATUS_COLORS: Record<ServiceOrderStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-purple-100 text-purple-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  partial: 'Parcial',
  cancelled: 'Cancelado',
}

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'pix', label: 'PIX' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'credito', label: 'Cartão de Crédito' },
  { value: 'debito', label: 'Cartão de Débito' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'boleto', label: 'Boleto' },
]
