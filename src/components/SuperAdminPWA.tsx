import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import QRCode, { downloadQRCode, qrDataUrl } from '@/components/QRCode'
import {
  Smartphone, QrCode, Copy, ExternalLink, Download, Search,
  CheckCircle2, Tablet, Share2, MessageCircle, X, Printer, Store,
} from 'lucide-react'

/* ══════════════════════════════════════════════════════════════
   GERADOR DE PWA POR TENANT — painel do Super Admin

   Cada estética tem uma agenda pública própria em /agendar/:id.
   Essa página já é um PWA: injeta manifest dinâmico com o nome da
   estética e registra service worker. Instalada no tablet, vira
   um app com ícone próprio, tela cheia e sem barra de navegador.

   Aqui o Super Admin gera, para cada cliente:
     • QR Code (para escanear no tablet ou imprimir no balcão)
     • Link direto
     • Cartaz A5 pronto para impressão
     • Mensagem de WhatsApp pronta
   ══════════════════════════════════════════════════════════════ */

interface Tenant {
  id: string
  name: string
  slug: string | null
  cidade: string | null
  phone: string | null
  logo_url: string | null
  plan_type: string
  is_active: boolean
}


export default function SuperAdminPWA() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<Tenant | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const origin = window.location.origin
  const linkOf = (t: Tenant) => `${origin}/agendar/${t.id}`

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('tenants')
      .select('id, name, slug, cidade, phone, logo_url, plan_type, is_active')
      .order('name')
    setTenants((data as Tenant[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const copy = (text: string, id: string, msg = 'Copiado!') => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    toast.success(msg)
    setTimeout(() => setCopiedId(null), 2000)
  }

  /* ── Baixa o QR como PNG ── */
  const downloadQR = async (t: Tenant) => {
    const nome = `qrcode-agenda-${(t.slug ?? t.name).replace(/[^a-z0-9]/gi, '-').toLowerCase()}`
    const ok = await downloadQRCode(linkOf(t), nome, 600)
    toast[ok ? 'success' : 'error'](ok ? 'QR Code baixado!' : 'Não foi possível gerar o arquivo')
  }

  /* ── Cartaz A5 pronto para impressão ── */
  const printPoster = async (t: Tenant) => {
    const link = linkOf(t)
    const qrImg = await qrDataUrl(link, 420)
    if (!qrImg) { toast.error('Não foi possível gerar o QR do cartaz'); return }
    const win = window.open('', '_blank', 'width=760,height=1000')
    if (!win) { toast.error('Permita pop-ups para imprimir o cartaz'); return }

    win.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Agenda — ${t.name}</title>
<style>
  @page { size: A5; margin: 12mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; margin: 0;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { width: 100%; max-width: 420px; text-align: center; padding: 28px 24px;
          border: 3px solid #1B4FD8; border-radius: 24px; }
  .badge { display: inline-block; background: #1B4FD8; color: #fff; font-size: 11px;
           font-weight: 800; letter-spacing: .12em; padding: 6px 14px; border-radius: 999px; }
  h1 { font-size: 26px; margin: 14px 0 4px; color: #0f172a; line-height: 1.15; }
  .city { color: #64748b; font-size: 13px; margin: 0 0 18px; }
  .qr { padding: 12px; border: 2px solid #e2e8f0; border-radius: 16px; display: inline-block; }
  .qr img { display: block; width: 210px; height: 210px; }
  h2 { font-size: 17px; color: #1B4FD8; margin: 18px 0 10px; }
  ol { text-align: left; font-size: 13px; color: #334155; padding-left: 20px; margin: 0 0 16px; line-height: 1.7; }
  .link { font-family: ui-monospace, monospace; font-size: 10px; color: #94a3b8;
          word-break: break-all; padding-top: 12px; border-top: 1px dashed #cbd5e1; }
  .foot { margin-top: 10px; font-size: 10px; color: #cbd5e1; }
</style></head><body>
  <div class="card">
    <span class="badge">AGENDAMENTO ONLINE</span>
    <h1>${t.name}</h1>
    ${t.cidade ? `<p class="city">${t.cidade}</p>` : '<div style="height:18px"></div>'}
    <div class="qr"><img src="${qrImg}" alt="QR Code"></div>
    <h2>Aponte a câmera e agende</h2>
    <ol>
      <li>Abra a câmera do celular</li>
      <li>Aponte para o código acima</li>
      <li>Escolha o serviço, dia e horário</li>
      <li>Pronto! Confirmação chega no seu WhatsApp</li>
    </ol>
    <p class="link">${link}</p>
    <p class="foot">Auto Estética Flow</p>
  </div>
  <script>window.onload = () => setTimeout(() => window.print(), 600)</script>
</body></html>`)
    win.document.close()
  }

  const filtered = tenants.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.cidade ?? '').toLowerCase().includes(search.toLowerCase()),
  )

  const active = tenants.filter(t => t.is_active)

  return (
    <div className="space-y-5">
      {/* ── Explicação ── */}
      <div className="flex gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
        <Tablet className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-900">
          <p className="font-semibold mb-1">Agenda como app no tablet</p>
          <p className="text-xs text-blue-800 leading-relaxed">
            A agenda pública de cada estética já funciona como PWA: ao instalar no tablet,
            vira um app em tela cheia, com o nome e a cor da estética, e continua abrindo
            mesmo com internet instável. Use o QR Code para instalar rapidamente ou
            imprima o cartaz para o balcão.
          </p>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
            <Store className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Estéticas</p>
            <p className="text-2xl font-bold">{tenants.length}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Agendas ativas</p>
            <p className="text-2xl font-bold text-green-700">{active.length}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">PWAs disponíveis</p>
            <p className="text-2xl font-bold text-purple-700">{active.length}</p>
          </div>
        </div>
      </div>

      {/* ── Busca ── */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input className="pl-9" placeholder="Buscar estética ou cidade..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* ── Grid ── */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-64 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border">
          <Store className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500">Nenhuma estética encontrada</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(t => {
            const link = linkOf(t)
            return (
              <div key={t.id}
                className={`bg-white rounded-2xl border-2 overflow-hidden transition-all hover:shadow-md
                  ${t.is_active ? 'border-gray-200' : 'border-dashed border-gray-200 opacity-60'}`}>

                {/* Cabeçalho */}
                <div className="p-4 pb-3 flex items-center gap-3 border-b border-gray-100">
                  <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shrink-0 overflow-hidden">
                    {t.logo_url
                      ? <img src={t.logo_url} alt="" className="w-full h-full object-cover" />
                      : <Store className="w-5 h-5 text-white" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-gray-900 truncate">{t.name}</p>
                    <p className="text-xs text-gray-400 truncate">{t.cidade ?? 'Sem cidade'}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0
                    ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {t.is_active ? 'Ativa' : 'Inativa'}
                  </span>
                </div>

                {/* QR */}
                <div className="p-4 flex flex-col items-center">
                  <button onClick={() => setModal(t)}
                    className="p-2 bg-white border-2 border-gray-100 rounded-xl hover:border-blue-300 transition-colors"
                    title="Ampliar">
                    <QRCode value={link} size={128} />
                  </button>
                  <p className="text-[10px] text-gray-400 mt-2">Toque para ampliar</p>
                </div>

                {/* Ações */}
                <div className="px-4 pb-4 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs"
                      onClick={() => copy(link, t.id, 'Link copiado!')}>
                      {copiedId === t.id ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedId === t.id ? 'Copiado' : 'Link'}
                    </Button>
                    <a href={link} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs w-full">
                        <ExternalLink className="w-3.5 h-3.5" />Abrir
                      </Button>
                    </a>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs"
                      onClick={() => downloadQR(t)}>
                      <Download className="w-3.5 h-3.5" />QR
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs"
                      onClick={() => printPoster(t)}>
                      <Printer className="w-3.5 h-3.5" />Cartaz
                    </Button>
                  </div>
                  <Button size="sm" className="w-full gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => copy(
                      `Olá! 🚗 Agende seu horário na *${t.name}* pelo link:\n${link}\n\nÉ rápido: escolha o serviço, o dia e pronto. A confirmação chega aqui no WhatsApp. ✨`,
                      `wa-${t.id}`, 'Mensagem copiada! Cole no WhatsApp.',
                    )}>
                    <MessageCircle className="w-3.5 h-3.5" />Mensagem WhatsApp
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ══ MODAL: QR ampliado + instruções ══ */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] overflow-y-auto">

            <div className="p-5 border-b flex items-center justify-between sticky top-0 bg-white rounded-t-3xl">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold">{modal.name}</h3>
              </div>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-6 grid md:grid-cols-2 gap-6">
              {/* QR grande */}
              <div className="flex flex-col items-center">
                <div className="p-4 bg-white border-2 border-gray-100 rounded-2xl">
                  <QRCode value={linkOf(modal)} size={224} />
                </div>
                <div className="flex gap-2 mt-3 w-full">
                  <Button size="sm" variant="outline" className="flex-1 gap-1.5 text-xs"
                    onClick={() => downloadQR(modal)}>
                    <Download className="w-3.5 h-3.5" />Baixar PNG
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 gap-1.5 text-xs"
                    onClick={() => printPoster(modal)}>
                    <Printer className="w-3.5 h-3.5" />Imprimir cartaz
                  </Button>
                </div>
                <div className="mt-3 w-full bg-gray-50 rounded-xl px-3 py-2 font-mono text-[10px] text-gray-500 break-all text-center">
                  {linkOf(modal)}
                </div>
              </div>

              {/* Instruções */}
              <div className="space-y-5">
                <div>
                  <h4 className="font-bold text-sm text-gray-900 flex items-center gap-2 mb-2">
                    <Tablet className="w-4 h-4 text-blue-600" />Instalar no tablet (Android)
                  </h4>
                  <ol className="text-xs text-gray-600 space-y-1.5 list-decimal list-inside leading-relaxed">
                    <li>Escaneie o QR ou abra o link no Chrome</li>
                    <li>Toque no menu <strong>⋮</strong> no canto superior</li>
                    <li>Escolha <strong>"Instalar app"</strong> ou <strong>"Adicionar à tela inicial"</strong></li>
                    <li>Confirme — o ícone aparece na tela do tablet</li>
                  </ol>
                </div>

                <div>
                  <h4 className="font-bold text-sm text-gray-900 flex items-center gap-2 mb-2">
                    <Smartphone className="w-4 h-4 text-gray-500" />No iPad (Safari)
                  </h4>
                  <ol className="text-xs text-gray-600 space-y-1.5 list-decimal list-inside leading-relaxed">
                    <li>Abra o link no <strong>Safari</strong> (não funciona no Chrome do iOS)</li>
                    <li>Toque no ícone <strong>Compartilhar</strong> ↑</li>
                    <li>Role e escolha <strong>"Adicionar à Tela de Início"</strong></li>
                    <li>Confirme o nome e toque em Adicionar</li>
                  </ol>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                  <p className="font-semibold mb-1">Dica para o balcão</p>
                  <p className="leading-relaxed">
                    Depois de instalar, ative o <strong>modo quiosque</strong> do tablet para o
                    cliente não sair do app sem querer. No Android: Configurações → Segurança →
                    Fixação de tela.
                  </p>
                </div>

                <Button className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => copy(
                    `Olá! 🚗 Agende seu horário na *${modal.name}* pelo link:\n${linkOf(modal)}`,
                    `wa-modal-${modal.id}`, 'Mensagem copiada!',
                  )}>
                  <Share2 className="w-4 h-4" />Compartilhar por WhatsApp
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
