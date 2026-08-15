import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { Plus, Pencil, MessageSquare, Star, Copy, Search, Trash2 } from 'lucide-react'
import { z } from 'zod'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

interface Template {
  id: string
  company_id: string | null
  name: string
  category: string
  content: string
  variables: string[]
  is_global: boolean
  active: boolean
}

const CATEGORIES = [
  { value: 'confirmacao', label: '✅ Confirmação', color: 'bg-green-100 text-green-800' },
  { value: 'lembrete', label: '⏰ Lembrete', color: 'bg-blue-100 text-blue-800' },
  { value: 'reativacao', label: '🔄 Reativação', color: 'bg-orange-100 text-orange-800' },
  { value: 'aniversario', label: '🎂 Aniversário', color: 'bg-pink-100 text-pink-800' },
  { value: 'promocao', label: '🔥 Promoção', color: 'bg-red-100 text-red-800' },
  { value: 'geral', label: '📨 Geral', color: 'bg-gray-100 text-gray-800' },
]

const VARIABLES_HELP = ['{nome}', '{empresa}', '{data}', '{hora}', '{veiculo}', '{servico}', '{valor}', '{link_agendamento}']

const schema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres'),
  category: z.string(),
  content: z.string().min(10, 'Template muito curto'),
})
type FormData = z.infer<typeof schema>

function extractVariables(content: string): string[] {
  const matches = content.match(/\{[a-z_]+\}/g) || []
  return [...new Set(matches)]
}

export default function TemplatesMensagens() {
  const { tenant: company } = useAuth()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [showGlobal, setShowGlobal] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Template | null>(null)
  const [preview, setPreview] = useState<Template | null>(null)

  const { register, handleSubmit, reset, control, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { category: 'geral', content: '' }
  })
  const contentValue = watch('content', '')

  useEffect(() => { if (company?.id) fetchTemplates() }, [company?.id])

  async function fetchTemplates() {
    setLoading(true)
    const { data } = await supabase
      .from('message_templates')
      .select('*')
      .or(`company_id.eq.${company!.id},company_id.is.null`)
      .order('is_global', { ascending: false })
      .order('name')
    setTemplates(data || [])
    setLoading(false)
  }

  function openNew() {
    setEditing(null)
    reset({ category: 'geral', content: '' })
    setModalOpen(true)
  }

  function openEdit(t: Template) {
    if (t.is_global) { toast.info('Templates globais não podem ser editados. Duplique-o primeiro.'); return }
    setEditing(t)
    reset({ name: t.name, category: t.category, content: t.content })
    setModalOpen(true)
  }

  async function duplicate(t: Template) {
    const { error } = await supabase.from('message_templates').insert({
      tenant_id: company!.id,
      name: `${t.name} (cópia)`,
      category: t.category,
      content: t.content,
      variables: t.variables,
      is_global: false,
    })
    if (error) { toast.error('Erro ao duplicar'); return }
    toast.success('Template duplicado! Agora você pode editá-lo.')
    fetchTemplates()
  }

  async function deleteTemplate(t: Template) {
    if (t.is_global) return
    if (!confirm(`Excluir o template "${t.name}"?`)) return
    await supabase.from('message_templates').delete().eq('id', t.id)
    toast.success('Template excluído')
    fetchTemplates()
  }

  async function onSubmit(data: FormData) {
    const variables = extractVariables(data.content)
    const payload = { ...data, variables, tenant_id: company!.id, is_global: false }
    if (editing) {
      const { error } = await supabase.from('message_templates').update(payload).eq('id', editing.id)
      if (error) { toast.error('Erro ao salvar'); return }
      toast.success('Template atualizado!')
    } else {
      const { error } = await supabase.from('message_templates').insert(payload)
      if (error) { toast.error('Erro ao criar'); return }
      toast.success('Template criado!')
    }
    setModalOpen(false)
    fetchTemplates()
  }

  function insertVariable(v: string) {
    // Insere variável no textarea — feito via DOM por simplicidade
    const ta = document.getElementById('template-content') as HTMLTextAreaElement
    if (!ta) return
    const start = ta.selectionStart, end = ta.selectionEnd
    const current = ta.value
    const newVal = current.substring(0, start) + v + current.substring(end)
    ta.value = newVal
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const filtered = templates.filter(t => {
    if (!showGlobal && t.is_global) return false
    const matchSearch = t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.content.toLowerCase().includes(search.toLowerCase())
    const matchCat = catFilter === 'all' || t.category === catFilter
    return matchSearch && matchCat
  })

  const myCount = templates.filter(t => !t.is_global).length
  const globalCount = templates.filter(t => t.is_global).length

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Templates de Mensagens</h1>
          <p className="text-gray-500 text-sm">Modelos prontos para WhatsApp</p>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="w-4 h-4"/>Novo Template</Button>
      </div>

      {/* Cards resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <Star className="w-7 h-7 text-yellow-500"/>
          <div>
            <p className="text-xs text-gray-500">Globais</p>
            <p className="text-xl font-bold">{globalCount}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <MessageSquare className="w-7 h-7 text-blue-500"/>
          <div>
            <p className="text-xs text-gray-500">Meus templates</p>
            <p className="text-xl font-bold">{myCount}</p>
          </div>
        </div>
        {CATEGORIES.slice(0,2).map(cat => {
          const count = templates.filter(t=>t.category===cat.value).length
          return (
            <div key={cat.value} className="bg-white rounded-xl border p-4">
              <p className="text-xs text-gray-500">{cat.label}</p>
              <p className="text-xl font-bold">{count}</p>
            </div>
          )
        })}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
          <Input className="pl-9" placeholder="Buscar template..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Categoria"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {CATEGORIES.map(c=><SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <Switch checked={showGlobal} onCheckedChange={setShowGlobal}/>
          Mostrar globais
        </label>
      </div>

      {/* Grid de templates */}
      {loading ? (
        <p className="text-center py-8 text-gray-400">Carregando templates...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.length === 0 ? (
            <p className="col-span-2 text-center py-8 text-gray-400">Nenhum template encontrado</p>
          ) : filtered.map(t => {
            const cat = CATEGORIES.find(c=>c.value===t.category)
            return (
              <div key={t.id} className="bg-white rounded-xl border p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900">{t.name}</h3>
                    {t.is_global && (
                      <Badge className="text-xs bg-yellow-100 text-yellow-800 border-yellow-200">
                        <Star className="w-3 h-3 mr-1"/>Global
                      </Badge>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cat?.color || 'bg-gray-100 text-gray-800'}`}>
                    {cat?.label || t.category}
                  </span>
                </div>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">
                  {t.content}
                </p>
                {t.variables && t.variables.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {t.variables.map(v => (
                      <Badge key={v} variant="outline" className="text-xs font-mono">{v}</Badge>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="gap-1.5 flex-1" onClick={()=>duplicate(t)}>
                    <Copy className="w-3.5 h-3.5"/>Duplicar
                  </Button>
                  {!t.is_global && (
                    <>
                      <Button size="sm" variant="outline" className="gap-1.5 flex-1" onClick={()=>openEdit(t)}>
                        <Pencil className="w-3.5 h-3.5"/>Editar
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-500 hover:text-red-700" onClick={()=>deleteTemplate(t)}>
                        <Trash2 className="w-3.5 h-3.5"/>
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal criar/editar */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Template' : 'Novo Template'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label>Nome do template *</Label>
              <Input {...register('name')} placeholder="Ex: Lembrete de amanhã"/>
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <Label>Categoria</Label>
              <Controller name="category" control={control} render={({field})=>(
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c=><SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              )}/>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Mensagem *</Label>
                <span className="text-xs text-gray-400">{contentValue.length} caracteres</span>
              </div>
              <Textarea
                id="template-content"
                {...register('content')}
                placeholder="Olá {nome}! Sua mensagem aqui..."
                rows={5}
                className="font-mono text-sm resize-none"
              />
              {errors.content && <p className="text-red-500 text-xs mt-1">{errors.content.message}</p>}
              <div className="mt-2">
                <p className="text-xs text-gray-500 mb-1">Inserir variável (clique para adicionar ao texto):</p>
                <div className="flex flex-wrap gap-1">
                  {VARIABLES_HELP.map(v => (
                    <button key={v} type="button" onClick={()=>insertVariable(v)}
                      className="text-xs font-mono bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5 hover:bg-blue-100">
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              {contentValue && extractVariables(contentValue).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="text-xs text-gray-500">Variáveis detectadas:</span>
                  {extractVariables(contentValue).map(v=>(
                    <Badge key={v} variant="outline" className="text-xs font-mono text-green-700">{v}</Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={()=>setModalOpen(false)}>Cancelar</Button>
              <Button type="submit" className="flex-1" disabled={isSubmitting}>
                {isSubmitting ? 'Salvando...' : editing ? 'Salvar' : 'Criar Template'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
