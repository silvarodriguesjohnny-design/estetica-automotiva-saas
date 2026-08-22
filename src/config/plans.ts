/**
 * ============================================================
 * CONFIGURAÇÃO CENTRAL DOS PLANOS
 * ============================================================
 *
 * Fonte única de verdade sobre preço, limites e comissão.
 * A Landing, o Onboarding e o Settings leem daqui — assim um
 * ajuste de preço não exige caçar número espalhado em 4 telas.
 *
 * Os PRICE IDs são gerados pelo script:
 *   node scripts/setup-stripe.mjs
 * ============================================================
 */

export type PlanId = 'starter' | 'pro' | 'enterprise'

/* ── Price IDs do Stripe ────────────────────────────────────
   Rode o script e cole a saída aqui.
   Enquanto estiverem vazios, o sistema cria o preço na hora
   (price_data inline) — funciona, mas sem trial automático. */

export const STRIPE_PRICE_IDS_TEST: Record<PlanId, string> = {
  starter:    'price_1U75Hb3cm0oHoYeDCtTeWvQA',
  pro:        'price_1U75Hc3cm0oHoYeDo1w0au0A',
  enterprise: 'price_1U75Hd3cm0oHoYeDWXhi7C53',
}

export const STRIPE_PRICE_IDS_LIVE: Record<PlanId, string> = {
  starter:    '',
  pro:        '',
  enterprise: '',
}

/** Escolhe o conjunto certo conforme a chave publicável em uso. */
export function getPriceId(planId: PlanId): string | null {
  const pk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? ''
  const table = pk.startsWith('pk_live_') ? STRIPE_PRICE_IDS_LIVE : STRIPE_PRICE_IDS_TEST
  return table[planId] || null
}

/* ── Definição dos planos ──────────────────────────────────── */

export interface PlanDef {
  id: PlanId
  name: string
  subtitle: string
  price: number          // reais
  accent: 'blue' | 'purple' | 'amber'
  badge: string | null
  /** % que a plataforma retém em agendamentos pagos antecipadamente */
  commissionPct: number
  maxServices: number | null   // null = ilimitado
  features: string[]
  missing: string[]
}

export const TRIAL_DAYS = 14

export const PLANS: PlanDef[] = [
  {
    id: 'starter',
    name: 'Padrão',
    subtitle: 'Para quem está começando',
    price: 97.33,
    accent: 'blue',
    badge: null,
    commissionPct: 2,
    maxServices: 2,
    features: [
      'Até 2 serviços cadastrados',
      'Clientes ilimitados',
      'Ordens de serviço',
      'Agenda pública com link próprio',
      'WhatsApp integrado',
      'Financeiro básico',
    ],
    missing: ['Campanhas em massa', 'Combos e assinaturas', 'Múltiplos técnicos'],
  },
  {
    id: 'pro',
    name: 'Especialista',
    subtitle: 'Para quem já é referência',
    price: 159.90,
    accent: 'purple',
    badge: 'Mais popular',
    commissionPct: 2,
    maxServices: 4,
    features: [
      'Até 4 serviços cadastrados',
      'Tudo do plano Padrão',
      'Campanhas em massa por WhatsApp',
      'Combos e assinaturas recorrentes',
      'Múltiplos técnicos',
      'Relatórios avançados',
    ],
    missing: ['Automações de retenção', 'Controle de estoque'],
  },
  {
    id: 'enterprise',
    name: 'Premium',
    subtitle: 'Operação completa',
    price: 249.90,
    accent: 'amber',
    badge: null,
    commissionPct: 2,
    maxServices: null,
    features: [
      'Serviços ilimitados',
      'Tudo do plano Especialista',
      'Automações de retenção',
      'Controle de estoque com alertas',
      'Relatórios de assinantes',
      'Suporte prioritário',
    ],
    missing: [],
  },
]

export const getPlan = (id?: string | null): PlanDef =>
  PLANS.find(p => p.id === id) ?? PLANS[1]

export const getCommission = (planId?: string | null): number =>
  getPlan(planId).commissionPct

/* ── Estilos de destaque por plano ─────────────────────────── */

export const PLAN_ACCENT = {
  blue: {
    ring: 'border-blue-500 bg-blue-50',
    dot: 'bg-blue-600',
    text: 'text-blue-600',
    btn: 'bg-blue-600 hover:bg-blue-700',
  },
  purple: {
    ring: 'border-purple-500 bg-purple-50',
    dot: 'bg-purple-600',
    text: 'text-purple-600',
    btn: 'bg-purple-600 hover:bg-purple-700',
  },
  amber: {
    ring: 'border-amber-500 bg-amber-50',
    dot: 'bg-amber-600',
    text: 'text-amber-600',
    btn: 'bg-amber-600 hover:bg-amber-700',
  },
} as const
