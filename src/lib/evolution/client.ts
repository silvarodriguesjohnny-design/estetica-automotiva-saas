// ============================================================
// EVOLUTION API CLIENT - Integração WhatsApp
// OWASP A10: chamadas feitas server-side via Supabase Edge Functions
// O API_KEY nunca é exposto no frontend
// ============================================================

const EVOLUTION_API_URL = import.meta.env.VITE_EVOLUTION_API_URL as string

export interface EvolutionInstance {
  instance: string
  status: 'open' | 'close' | 'connecting'
  qrcode?: string
}

export interface WhatsAppMessage {
  number: string
  text: string
}

export interface SendMessageResult {
  success: boolean
  messageId?: string
  error?: string
}

/**
 * Envia mensagem WhatsApp via Supabase Edge Function (backend-proxy).
 * O API_KEY do Evolution é guardado no Supabase Vault — nunca no frontend.
 * OWASP A02, A10: sem credenciais expostas no client.
 */
export async function sendWhatsAppMessage(
  instanceName: string,
  phone: string,
  message: string,
): Promise<SendMessageResult> {
  try {
    // Sanitiza o número: remove não-dígitos, adiciona 55 se necessário
    const sanitizedPhone = sanitizePhone(phone)
    if (!sanitizedPhone) return { success: false, error: 'Número inválido' }

    // Chama Edge Function que contém as credenciais
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ instanceName, phone: sanitizedPhone, message }),
    })

    if (!response.ok) {
      const err = await response.json()
      return { success: false, error: err.message || 'Erro ao enviar mensagem' }
    }

    const data = await response.json()
    return { success: true, messageId: data.key?.id }
  } catch (error) {
    console.error('[WhatsApp] Erro:', error)
    return { success: false, error: 'Erro de conexão com servidor de mensagens' }
  }
}

/**
 * Obtém status da instância WhatsApp via backend
 */
export async function getInstanceStatus(instanceName: string): Promise<EvolutionInstance | null> {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-instance-status`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ instanceName }),
      },
    )
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Sanitiza número de telefone para formato internacional BR
 * OWASP A03: input sanitization
 */
export function sanitizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 10) return null
  if (digits.startsWith('55') && digits.length >= 12) return digits
  if (digits.length === 11) return `55${digits}`
  if (digits.length === 10) return `55${digits}`
  return null
}

/**
 * Formata template de mensagem substituindo variáveis
 * OWASP A03: sem eval, substituição segura via mapa
 */
export function formatMessageTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return variables[key] ?? `{{${key}}}`
  })
}

// Templates padrão de mensagens
export const MESSAGE_TEMPLATES = {
  os_confirmada: (params: { nome: string; placa: string; data: string; hora: string }) =>
    `Olá, *${params.nome}*! ✅\n\nSua *Ordem de Serviço* foi confirmada!\n\n🚗 Veículo: ${params.placa}\n📅 Data: ${params.data}\n⏰ Horário: ${params.hora}\n\nQualquer dúvida, estamos à disposição!`,

  os_andamento: (params: { nome: string; placa: string }) =>
    `Olá, *${params.nome}*! 🔧\n\nSeu veículo *${params.placa}* está em atendimento agora.\n\nAvisaremos quando estiver pronto! 🚀`,

  os_concluida: (params: { nome: string; placa: string; valor: string }) =>
    `Olá, *${params.nome}*! 🎉\n\nSeu veículo *${params.placa}* está pronto!\n\n💰 Total: ${params.valor}\n\nObrigado pela preferência! Aguardamos você em breve. ⭐`,

  lembrete_inatividade: (params: { nome: string; dias: string }) =>
    `Olá, *${params.nome}*! 👋\n\nFaz *${params.dias} dias* que você não nos visita.\n\nSentimos sua falta! Que tal agendar uma revisão para seu veículo? 🚗✨`,

  campanha: (params: { nome: string; titulo: string; desconto: string; validade: string }) =>
    `Olá, *${params.nome}*! 🎁\n\n*${params.titulo}*\n\n🏷️ Desconto especial de *${params.desconto}%*!\n\nVálido até: ${params.validade}\n\nAgende já pelo link do nosso sistema!`,
}
