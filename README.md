# Auto Estética Flow — Sistema SaaS de Gestão para Estéticas Automotivas

Sistema multi-tenant completo para gestão de estéticas automotivas, desenvolvido com foco em segurança (OWASP Top 10), escalabilidade e integração com WhatsApp via Evolution API.

## Stack Tecnológica

- **Frontend:** React 19 + Vite + TypeScript + shadcn/ui + Tailwind CSS
- **Backend/DB:** Supabase (PostgreSQL + Auth + Edge Functions + Storage)
- **Deploy:** Vercel
- **WhatsApp:** Evolution API (via Supabase Edge Function como proxy seguro)
- **Pagamentos:** Stripe ou Asaas (plug-and-play)

---

## Funcionalidades

| Módulo | Descrição |
|--------|-----------|
| **Landing Page** | Hero, features, planos com checkout integrado, criação automática de tenant |
| **Dashboard** | KPIs em tempo real: receita, OS abertas, ticket médio, gráficos |
| **Clientes** | Cadastro completo com histórico de visitas e veículos |
| **Veículos** | Gestão por cliente: marca, modelo, placa, chassi, combustível |
| **Técnicos** | Profissionais com especialidades, controle de ativação |
| **Ordens de Serviço** | OS completas com itens, técnico, fotos before/after, status pipeline |
| **Financeiro** | Receitas, despesas, gráficos, ticket médio |
| **Campanhas** | Marketing com disparo automático por inatividade |
| **WhatsApp** | Envio via Evolution API com templates automáticos |
| **Agendamento Público** | Link `/agendar/:tenantId` para clientes agendarem |
| **Super Admin** | Gerenciamento de tenants e aprovações |

---

## Segurança — OWASP Top 10

| # | Categoria | Implementação |
|---|-----------|---------------|
| A01 | Broken Access Control | RLS (Row Level Security) no Supabase por tenant, roles (admin/operator/viewer) |
| A02 | Cryptographic Failures | HTTPS obrigatório, PKCE flow no auth, credenciais da Evolution API nunca expostas no frontend |
| A03 | Injection | Queries parametrizadas via Supabase client, Zod para validação de todos os inputs |
| A04 | Insecure Design | Trial expirado bloqueia acesso, limites por plano, rate limiting nas Edge Functions |
| A05 | Security Misconfiguration | Headers HTTP no vercel.json (CSP, HSTS, X-Frame-Options, nosniff) |
| A06 | Vulnerable Components | Dependências modernas, sem libs deprecadas |
| A07 | Auth Failures | Supabase Auth com PKCE, autoRefreshToken, sessão com expiração |
| A08 | Software Integrity | Build via CI/CD no Vercel, sem eval() ou execução dinâmica |
| A09 | Security Logging | Tabela `audit_logs` registra ações críticas (create_tenant, send_whatsapp, login) |
| A10 | SSRF | Chamadas à Evolution API são feitas exclusivamente via Supabase Edge Function (server-side) |

---

## Setup — Passo a Passo

### 1. Clonar e instalar

```bash
git clone <seu-repositorio>
cd estetica-automotiva
npm install
```

### 2. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com)
2. Execute a migration:
   ```bash
   # Via Supabase CLI
   supabase db push
   # ou cole o conteúdo de supabase/migrations/001_initial_schema.sql no SQL Editor
   ```
3. Copie as credenciais do painel: `Project URL` e `anon key`

### 3. Evolution API

1. Configure sua instância Evolution API (self-hosted ou cloud)
2. Crie uma instância WhatsApp com o nome que vai usar
3. Anote a `API Key` e a `URL` da sua instância

### 4. Variáveis de ambiente

```bash
cp .env.example .env
```

Edite `.env`:
```env
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

VITE_EVOLUTION_API_URL=https://sua-evolution-api.com
VITE_EVOLUTION_API_KEY=sua-key  # NÃO é usada no frontend — apenas via Edge Function
```

### 5. Configurar Edge Function (WhatsApp)

```bash
# Instale o Supabase CLI
npm install -g supabase

# Deploy da Edge Function
supabase functions deploy send-whatsapp

# Configure secrets (nunca em .env do frontend)
supabase secrets set EVOLUTION_API_URL=https://sua-evolution-api.com
supabase secrets set EVOLUTION_API_KEY=sua-api-key
```

### 6. Deploy no Vercel

```bash
# Instale o Vercel CLI
npm install -g vercel

vercel --prod
```

**Ou via GitHub:**
1. Faça push para GitHub
2. Importe no [vercel.com](https://vercel.com)
3. Configure as variáveis de ambiente no painel Vercel

### 7. Configurar Pagamentos (opcional para produção)

**Stripe:**
```env
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
```
Configure webhooks Stripe → Supabase Edge Function para atualizar `subscription_type` automaticamente.

**Asaas (alternativa BR):**
```env
VITE_ASAAS_PUBLIC_KEY=...
```

---

## Estrutura do Projeto

```
estetica-automotiva/
├── src/
│   ├── pages/
│   │   ├── Landing.tsx          # Landing page + checkout
│   │   ├── Login.tsx
│   │   ├── Onboarding.tsx       # Setup inicial pós-cadastro
│   │   ├── Dashboard.tsx        # KPIs e métricas
│   │   ├── Clientes.tsx
│   │   ├── Veiculos.tsx         # Entidade central da estética
│   │   ├── Tecnicos.tsx
│   │   ├── OrdensServico.tsx    # OS completa com itens
│   │   ├── Financeiro.tsx
│   │   ├── Campanhas.tsx
│   │   ├── MensagensWhatsApp.tsx
│   │   ├── Settings.tsx
│   │   ├── SuperAdmin.tsx
│   │   └── PublicBooking.tsx    # Agendamento /agendar/:tenantId
│   ├── components/
│   │   └── Layout.tsx           # Sidebar + header responsivo
│   ├── hooks/
│   │   └── use-auth.tsx         # Auth context com trial check
│   ├── lib/
│   │   ├── supabase/client.ts   # Supabase client (PKCE)
│   │   └── evolution/client.ts  # Evolution API helpers
│   └── types/index.ts           # Tipos + constantes do domínio
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql  # Schema + RLS + triggers
│   └── functions/
│       └── send-whatsapp/       # Edge Function (proxy seguro)
├── vercel.json                  # Headers de segurança HTTP
├── .env.example
└── README.md
```

---

## Multi-tenant — Como funciona

Cada cliente (dono de estética) que se cadastra pela landing page vira um **Tenant**. O isolamento é garantido em duas camadas:

1. **Aplicação:** toda query passa o `tenant_id` do usuário autenticado
2. **Banco de dados (RLS):** o Supabase bloqueia no nível do PostgreSQL — mesmo que a aplicação errasse, o banco não entregaria dados de outro tenant

```sql
-- Exemplo de policy RLS
CREATE POLICY customers_tenant_isolation ON customers
  FOR ALL USING (tenant_id = auth.tenant_id());
```

---

## Fluxo de Criação de Tenant (Landing Page → Dashboard)

```
1. Cliente acessa a Landing Page
2. Escolhe um plano e preenche o formulário
3. Sistema chama supabase.auth.signUp() + pending_tenants INSERT
4. Supabase dispara trigger → cria profile
5. RPC create_tenant_for_user() → cria tenant + serviços padrão
6. Usuário confirma e-mail → redireciona para /onboarding
7. Onboarding completa os dados do negócio
8. Acesso liberado ao /dashboard
```

---

## WhatsApp — Arquitetura de Segurança

```
Frontend → Supabase Edge Function (autenticado por JWT)
          ↓ verifica tenant + permissão
          ↓ busca API Key no banco (criptografada)
          ↓ chama Evolution API (server-side)
          ↓ registra audit_log
          → retorna resultado ao frontend
```

A `API Key` da Evolution API **nunca passa pelo browser**. Isso previne o OWASP A02 (Cryptographic Failures) e A10 (SSRF).

---

## Licença

Propriedade privada. Uso restrito ao tenant contratante.
