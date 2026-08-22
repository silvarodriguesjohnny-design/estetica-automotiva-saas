/**
 * ============================================================
 * BUSCA DE ENDEREÇO POR CEP
 * ============================================================
 *
 * Consulta em cascata com duas fontes públicas e gratuitas:
 *
 *   1. BrasilAPI    (api.brasilapi.com.br) — mais rápida, tem CDN
 *   2. ViaCEP       (viacep.com.br)        — mais antiga e estável
 *
 * POR QUE DUAS FONTES:
 * São APIs públicas sem SLA. Qualquer uma pode cair ou ficar lenta.
 * Se o preenchimento automático falhar bem na hora em que o cliente
 * está contratando, ele abandona. O fallback custa pouco e salva a
 * conversão.
 *
 * CACHE EM MEMÓRIA:
 * O mesmo CEP costuma ser consultado mais de uma vez na mesma
 * sessão (usuário corrige um dígito, volta uma etapa). Guardar o
 * resultado evita chamada repetida.
 * ============================================================
 */

export interface Endereco {
  cep: string
  rua: string
  bairro: string
  cidade: string
  uf: string
  complemento?: string
  /** Fonte que respondeu — útil para diagnóstico */
  fonte: 'brasilapi' | 'viacep' | 'cache'
}

export type CepErro =
  | 'formato'      // não tem 8 dígitos
  | 'nao_encontrado'
  | 'offline'      // nenhuma API respondeu

const cache = new Map<string, Endereco>()

export const onlyDigits = (v: string) => v.replace(/\D/g, '')

/** Formata para 00000-000 enquanto o usuário digita. */
export function formatCep(v: string): string {
  return onlyDigits(v).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')
}

/** Um CEP só é consultável com 8 dígitos. */
export const isCepCompleto = (v: string) => onlyDigits(v).length === 8

/** fetch com timeout — API pública lenta não pode travar o formulário. */
async function fetchTimeout(url: string, ms = 5000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

/* ── Fonte 1: BrasilAPI ─────────────────────────────────────── */
async function viaBrasilApi(cep: string): Promise<Endereco | null> {
  const r = await fetchTimeout(`https://brasilapi.com.br/api/cep/v1/${cep}`)
  if (!r.ok) return null
  const d = await r.json()
  if (!d?.city) return null
  return {
    cep,
    rua: d.street ?? '',
    bairro: d.neighborhood ?? '',
    cidade: d.city ?? '',
    uf: d.state ?? '',
    fonte: 'brasilapi',
  }
}

/* ── Fonte 2: ViaCEP ────────────────────────────────────────── */
async function viaViaCep(cep: string): Promise<Endereco | null> {
  const r = await fetchTimeout(`https://viacep.com.br/ws/${cep}/json/`)
  if (!r.ok) return null
  const d = await r.json()
  if (d?.erro || !d?.localidade) return null
  return {
    cep,
    rua: d.logradouro ?? '',
    bairro: d.bairro ?? '',
    cidade: d.localidade ?? '',
    uf: d.uf ?? '',
    complemento: d.complemento || undefined,
    fonte: 'viacep',
  }
}

/**
 * Busca o endereço de um CEP.
 * Lança `CepErro` como string em caso de falha, para o chamador
 * decidir a mensagem que faz sentido no contexto dele.
 */
export async function buscarCep(input: string): Promise<Endereco> {
  const cep = onlyDigits(input)

  if (cep.length !== 8) throw 'formato' as CepErro

  const cached = cache.get(cep)
  if (cached) return { ...cached, fonte: 'cache' }

  let indisponivel = 0

  for (const fonte of [viaBrasilApi, viaViaCep]) {
    try {
      const res = await fonte(cep)
      if (res) {
        cache.set(cep, res)
        return res
      }
      // Respondeu, mas o CEP não existe naquela base — tenta a próxima
    } catch {
      indisponivel++
    }
  }

  // Se as duas falharam por rede, é problema de conexão, não CEP inválido.
  throw (indisponivel === 2 ? 'offline' : 'nao_encontrado') as CepErro
}

/** Mensagem pronta em português para cada tipo de erro. */
export function mensagemErroCep(e: unknown): string {
  switch (e) {
    case 'formato':        return 'CEP incompleto'
    case 'nao_encontrado': return 'CEP não encontrado — confira os números'
    case 'offline':        return 'Não conseguimos consultar agora. Preencha manualmente.'
    default:               return 'Erro ao buscar o CEP'
  }
}
