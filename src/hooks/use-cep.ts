import { useState, useCallback, useRef, useEffect } from 'react'
import { buscarCep, formatCep, isCepCompleto, mensagemErroCep, type Endereco } from '@/lib/cep'

/**
 * Hook de preenchimento automático por CEP.
 *
 * Dispara a busca sozinho assim que o CEP fica completo (8 dígitos),
 * com debounce — o usuário não precisa clicar em nada nem sair do campo.
 *
 * Uso:
 *   const cep = useCep((end) => {
 *     setRua(end.rua); setBairro(end.bairro)
 *     setCidade(end.cidade); setUf(end.uf)
 *   })
 *
 *   <input value={cep.value} onChange={e => cep.setValue(e.target.value)} />
 *   {cep.loading && <Spinner/>}
 *   {cep.error && <p>{cep.error}</p>}
 */
export function useCep(onFound: (end: Endereco) => void, initial = '') {
  const [value, setValueRaw] = useState(formatCep(initial))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState(false)

  const timerRef = useRef<number | null>(null)
  const lastQueried = useRef<string>('')
  const onFoundRef = useRef(onFound)
  onFoundRef.current = onFound

  const lookup = useCallback(async (raw: string) => {
    const digits = raw.replace(/\D/g, '')
    if (digits === lastQueried.current) return   // evita busca repetida
    lastQueried.current = digits

    setLoading(true)
    setError(null)
    try {
      const end = await buscarCep(digits)
      onFoundRef.current(end)
      setFound(true)
    } catch (e) {
      setError(mensagemErroCep(e))
      setFound(false)
    } finally {
      setLoading(false)
    }
  }, [])

  const setValue = useCallback((raw: string) => {
    const formatted = formatCep(raw)
    setValueRaw(formatted)
    setError(null)
    setFound(false)

    if (timerRef.current) clearTimeout(timerRef.current)

    // Só busca quando estiver completo, com um respiro para o usuário
    // terminar de digitar.
    if (isCepCompleto(formatted)) {
      timerRef.current = window.setTimeout(() => lookup(formatted), 400)
    } else {
      lastQueried.current = ''
    }
  }, [lookup])

  /** Força uma nova busca (botão "tentar de novo"). */
  const retry = useCallback(() => {
    if (!isCepCompleto(value)) return
    lastQueried.current = ''
    lookup(value)
  }, [value, lookup])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return { value, setValue, loading, error, found, retry, complete: isCepCompleto(value) }
}
