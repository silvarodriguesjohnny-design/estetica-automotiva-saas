import { useEffect, useRef, useState } from 'react'
import QRCodeLib from 'qrcode'
import { Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ══════════════════════════════════════════════════════════════
   QR Code gerado LOCALMENTE.

   Antes usávamos api.qrserver.com. Isso significava que o QR da
   agenda dependia de um serviço de terceiros estar no ar, não ser
   bloqueado por firewall corporativo e não esbarrar em CSP. Se
   qualquer uma dessas coisas falhasse, o dono da estética via um
   quadrado vazio e não tinha como divulgar a agenda.

   Agora o código é desenhado no canvas do próprio navegador.
   Funciona offline, sem rede, sem dependência externa.
   ══════════════════════════════════════════════════════════════ */

interface Props {
  /** Conteúdo codificado — normalmente a URL da agenda */
  value: string
  /** Lado do quadrado em pixels */
  size?: number
  className?: string
  /** Cor dos módulos escuros */
  dark?: string
  /** Cor do fundo */
  light?: string
  /** Recebe o dataURL assim que o código é desenhado — útil para download */
  onReady?: (dataUrl: string) => void
}

export default function QRCode({
  value,
  size = 200,
  className,
  dark = '#0f172a',
  light = '#ffffff',
  onReady,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (!canvasRef.current || !value) {
      setState('error')
      return
    }

    let cancelled = false
    setState('loading')

    QRCodeLib.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 2,
      // Nível M tolera ~15% de dano. Suficiente para cartaz impresso
      // que pode sujar ou amassar no balcão.
      errorCorrectionLevel: 'M',
      color: { dark, light },
    })
      .then(() => {
        if (cancelled) return
        setState('ready')
        if (onReady && canvasRef.current) {
          onReady(canvasRef.current.toDataURL('image/png'))
        }
      })
      .catch(err => {
        if (cancelled) return
        console.error('[QRCode]', err)
        setState('error')
      })

    return () => { cancelled = true }
  }, [value, size, dark, light, onReady])

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}>

      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className={cn('rounded-lg transition-opacity', state === 'ready' ? 'opacity-100' : 'opacity-0')}
      />

      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
        </div>
      )}

      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gray-50 rounded-lg border border-gray-200 p-3">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <p className="text-[10px] text-gray-400 text-center leading-tight">
            Não foi possível gerar o código
          </p>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   Helpers para download e impressão — sem depender de rede
   ══════════════════════════════════════════════════════════════ */

/** Gera o PNG em memória e dispara o download. */
export async function downloadQRCode(value: string, filename: string, size = 600) {
  try {
    const dataUrl = await QRCodeLib.toDataURL(value, {
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = filename.endsWith('.png') ? filename : `${filename}.png`
    a.click()
    return true
  } catch (err) {
    console.error('[downloadQRCode]', err)
    return false
  }
}

/** Devolve o dataURL do QR — usado para montar o cartaz de impressão. */
export async function qrDataUrl(value: string, size = 420): Promise<string | null> {
  try {
    return await QRCodeLib.toDataURL(value, {
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    })
  } catch (err) {
    console.error('[qrDataUrl]', err)
    return null
  }
}
