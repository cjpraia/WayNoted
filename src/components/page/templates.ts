import { BlockNoteEditor } from '@blocknote/core'
import { actions, api, getState, selectors } from '../../store'
import type { PersonalTemplate } from '../../types'
import { blocksToText } from './util'
import { schema } from './schema'
import { getLocale, t } from '../../i18n'
import { prepareTemplate } from '../../templates/apply'
import { setPendingCursor } from '../../templates/cursor'

interface Template {
  id: string
  title: string
  description: string
  icon: string | null
  blocks: unknown[]
}

const text = (value: string) => [{ type: 'text', text: value, styles: {} }]
const heading = (value: string, level: 1 | 2 | 3 = 2) => ({ type: 'heading', props: { level }, content: text(value) })
const paragraph = (value = '') => ({ type: 'paragraph', content: value ? text(value) : [] })

export const templates: Template[] = [
  {
    id: 'meeting', title: 'Reunião', description: 'Pauta, decisões e próximos passos', icon: 'lucide:calendar-check:orange',
    blocks: [heading('Pauta'), paragraph(''), heading('Anotações'), paragraph(''), heading('Decisões'), paragraph(''),
      heading('Próximos passos'), { type: 'checkListItem', content: [] }],
  },
  {
    id: 'project', title: 'Projeto', description: 'Objetivo, escopo e andamento', icon: 'lucide:folder-kanban:purple',
    blocks: [heading('Objetivo'), paragraph(''), heading('Escopo'), paragraph(''), heading('Andamento'),
      { type: 'bulletListItem', content: [] }, heading('Referências'), paragraph('')],
  },
  {
    id: 'tasks', title: 'Tarefas', description: 'Lista prática de tarefas', icon: 'lucide:list-todo:green',
    blocks: [heading('A fazer'), { type: 'checkListItem', content: [] }, heading('Notas'), paragraph('')],
  },
  {
    id: 'journal', title: 'Diário', description: 'Registro pessoal com reflexão', icon: 'lucide:book-open:brown',
    blocks: [heading('Hoje'), paragraph(''), heading('O que aconteceu'), paragraph(''), heading('Ideias'), paragraph('')],
  },
]

export function availableTemplates(): Template[] {
  if (getLocale() !== 'en-US') return [...templates, ...(getState().settings.personalTemplates ?? [])]
  const copy = structuredClone(templates)
  const labels: Record<string, [string, string]> = {
    meeting: ['Meeting', 'Agenda, decisions, and next steps'],
    project: ['Project', 'Goal, scope, and progress'],
    tasks: ['Tasks', 'A practical task list'],
    journal: ['Journal', 'Personal notes and reflections'],
  }
  const headings: Record<string, string> = {
    Pauta: 'Agenda', Anotações: 'Notes', Decisões: 'Decisions', 'Próximos passos': 'Next steps',
    Objetivo: 'Goal', Escopo: 'Scope', Andamento: 'Progress', Referências: 'References',
    'A fazer': 'To do', Notas: 'Notes', Hoje: 'Today', 'O que aconteceu': 'What happened', Ideias: 'Ideas',
  }
  for (const preset of copy) {
    ;[preset.title, preset.description] = labels[preset.id]
    for (const block of preset.blocks as { content?: { text?: string }[] }[]) {
      for (const inline of block.content ?? []) if (inline.text && headings[inline.text]) inline.text = headings[inline.text]
    }
  }
  return [...copy, ...(getState().settings.personalTemplates ?? [])]
}

export async function savePersonalTemplate(pageId: string, title: string, description = ''): Promise<string> {
  const page = selectors.page(pageId)
  if (!page) throw new Error(t('Página não encontrada.', 'Page not found.'))
  const blocks = (await api.loadDoc(pageId)) ?? []
  if (JSON.stringify(blocks).length > 2_000_000) throw new Error(t('Este modelo excede 2 MB. Remova anexos grandes antes de salvá-lo.', 'This template exceeds 2 MB. Remove large attachments before saving it.'))
  const now = Date.now()
  const item: PersonalTemplate = {
    id: crypto.randomUUID(), title: title.trim() || page.title || t('Modelo pessoal', 'Personal template'),
    description: description.trim(), icon: page.icon ?? '📄', blocks: structuredClone(blocks),
    createdAt: now, updatedAt: now,
  }
  actions.updateSettings({ personalTemplates: [...(getState().settings.personalTemplates ?? []), item] })
  await actions.flushMeta()
  return item.id
}

export async function deletePersonalTemplate(id: string): Promise<void> {
  actions.updateSettings({ personalTemplates: (getState().settings.personalTemplates ?? []).filter((item) => item.id !== id) })
  await actions.flushMeta()
}

/**
 * Resolvido somente depois que documento e metadados foram gravados localmente. Variáveis `{{…}}` do modelo
 * (título e corpo) são expandidas aqui; modelos pessoais são salvos crus. `null` = o usuário cancelou as perguntas.
 */
export async function createFromTemplate(id: string, parentId: string | null): Promise<string | null> {
  const template = availableTemplates().find((item) => item.id === id)
  if (!template) throw new Error(t('Modelo não encontrado.', 'Template not found.'))
  const prepared = await prepareTemplate(template.blocks, { titleTemplate: template.title, heading: template.title.includes('{{') ? undefined : template.title })
  if (!prepared) return null
  const document = BlockNoteEditor.create({ schema, initialContent: prepared.blocks as never }).document
  const pageId = actions.createPage(parentId, { title: prepared.title ?? template.title, icon: template.icon, text: blocksToText(prepared.blocks) })
  setPendingCursor(pageId, prepared.cursor)
  await api.saveDoc(pageId, document)
  await actions.flushMeta()
  return pageId
}
