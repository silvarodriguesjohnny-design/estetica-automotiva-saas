import { createClient } from '@supabase/supabase-js'

/* ══════════════════════════════════════════════════════════════
   Client ANÔNIMO — exclusivo da agenda pública

   Por que um segundo client em vez de reusar o global?

   O client global guarda sessão em localStorage e a reanexa em
   toda requisição. Isso é correto para a área logada e ERRADO
   para a agenda pública, por um motivo que não aparece em teste
   de banco: as políticas de RLS da agenda são `TO anon`.

   Se o dono da estética abre a própria agenda no mesmo navegador
   em que está logado, o JWT dele viaja junto. O role deixa de ser
   `anon` e vira `authenticated` — e as políticas `TO anon` param
   de valer. Sobra só a de isolamento por tenant. Resultado: a
   página carrega, a query retorna 200, e vem um array vazio.
   Nenhum erro em lugar nenhum.

   É o pior tipo de bug: só se manifesta para quem está logado,
   ou seja, exatamente para você testando. O cliente real no tablet
   nunca teria visto o problema, e você nunca conseguiria reproduzir
   o sucesso dele.

   Este client não lê nem escreve sessão. Ele é anônimo por
   construção, não por acidente.
   ══════════════════════════════════════════════════════════════ */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Variáveis de ambiente Supabase não configuradas.')
}

export const supabasePublic = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // Nada de sessão: sem storage, sem persistência, sem refresh.
    persistSession: false,
    autoRefreshToken: false,
    // Sem isto, um link com #access_token na URL sequestraria a sessão
    detectSessionInUrl: false,

    /* storageKey própria — este é o detalhe que trava a página.

       Por padrão o supabase-js deriva a chave da URL do projeto.
       Como o client global usa a mesma URL, os dois GoTrueClient
       acabam disputando a MESMA chave e coordenam entre si por um
       lock de navegador (navigator.locks). Se o lock não é
       liberado, a próxima chamada fica pendurada para sempre:
       sem erro, sem rejeição, sem timeout. O "Verificando..."
       eterno vem daí.

       Dando uma chave exclusiva, os dois deixam de se conhecer. */
    storageKey: 'sb-agenda-publica-noauth',

    /* Sem lock: este client não tem sessão para proteger de
       concorrência, então o lock só existiria para criar o
       problema acima. */
    lock: async (_name: string, _acquireTimeout: number, fn: () => Promise<unknown>) => fn(),
  },
  global: {
    headers: { 'X-Client-Info': 'estetica-agenda-publica/1.0' },
  },
})
