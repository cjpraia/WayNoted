// Tipos prontos para começar (um clique), em PT-BR/EN. Puro: gera ids novos a cada criação.
import type { OptionColor, Property, PropType } from '../types'
import type { ObjectType } from './model.ts'

export type PresetId = 'person' | 'project' | 'meeting' | 'book' | 'task' | 'recipe' | 'idea' | 'resource' | 'company'
/** Tipos que nascem criados e visíveis em todo espaço, na ordem de exibição (docs/USAGE.md, "Tipos nativos desde o início"). Receita fica só na galeria. */
export const NATIVE_PRESETS: readonly PresetId[] = ['person', 'project', 'meeting', 'task', 'book', 'idea', 'resource', 'company']
type Locale = 'pt-BR' | 'en-US'
type L = [pt: string, en: string]
interface FieldSpec { name: L; type: PropType; options?: [L, OptionColor, ('todo' | 'progress' | 'complete')?][]; numberFormat?: Property['numberFormat']; dflt?: number }
interface PresetSpec { id: PresetId; name: L; icon: string; color: OptionColor; description: L; titleTemplate?: L; fields: FieldSpec[]; blocks: [kind: 'h' | 'p' | 'todo' | 'bullet', text: L][] }

const STATUS: FieldSpec['options'] = [[['Não iniciado', 'Not started'], 'gray', 'todo'], [['Em andamento', 'In progress'], 'blue', 'progress'], [['Concluído', 'Done'], 'green', 'complete']]

export const PRESETS: PresetSpec[] = [
  { id: 'person', name: ['Pessoa', 'Person'], icon: 'lucide:user:blue', color: 'blue', description: ['Contatos, colegas e amigos', 'Contacts, colleagues and friends'],
    fields: [{ name: ['E-mail', 'Email'], type: 'email' }, { name: ['Telefone', 'Phone'], type: 'phone' }, { name: ['Empresa', 'Company'], type: 'text' }, { name: ['Aniversário', 'Birthday'], type: 'date' }, { name: ['Relação', 'Relationship'], type: 'select', options: [[['Trabalho', 'Work'], 'blue'], [['Família', 'Family'], 'pink'], [['Amizade', 'Friend'], 'green']] }],
    blocks: [['h', ['Sobre', 'About']], ['p', ['', '']], ['h', ['Conversas', 'Conversations']], ['bullet', ['', '']]] },
  { id: 'project', name: ['Projeto', 'Project'], icon: 'lucide:folder-kanban:purple', color: 'purple', description: ['Objetivo, prazo e andamento', 'Goal, deadline and progress'],
    fields: [{ name: ['Status', 'Status'], type: 'status', options: STATUS, dflt: 0 }, { name: ['Prazo', 'Deadline'], type: 'date' }, { name: ['Prioridade', 'Priority'], type: 'select', options: [[['Alta', 'High'], 'red'], [['Média', 'Medium'], 'yellow'], [['Baixa', 'Low'], 'gray']] }, { name: ['Responsável', 'Owner'], type: 'person' }],
    blocks: [['h', ['Objetivo', 'Goal']], ['p', ['', '']], ['h', ['Próximos passos', 'Next steps']], ['todo', ['', '']]] },
  { id: 'meeting', name: ['Reunião', 'Meeting'], icon: 'lucide:calendar-check:orange', color: 'orange', description: ['Pauta, decisões e próximos passos', 'Agenda, decisions and next steps'], titleTemplate: ['Reunião {data}', 'Meeting {date}'],
    fields: [{ name: ['Data', 'Date'], type: 'date' }, { name: ['Participantes', 'Attendees'], type: 'text' }, { name: ['Tipo de reunião', 'Meeting kind'], type: 'select', options: [[['1:1', '1:1'], 'blue'], [['Equipe', 'Team'], 'green'], [['Cliente', 'Client'], 'orange']] }],
    blocks: [['h', ['Pauta', 'Agenda']], ['p', ['', '']], ['h', ['Decisões', 'Decisions']], ['p', ['', '']], ['h', ['Próximos passos', 'Next steps']], ['todo', ['', '']]] },
  { id: 'book', name: ['Livro', 'Book'], icon: 'lucide:book-open:brown', color: 'brown', description: ['Leituras, autores e notas', 'Reading list, authors and notes'],
    fields: [{ name: ['Autor', 'Author'], type: 'text' }, { name: ['Status de leitura', 'Reading status'], type: 'status', options: [[['Quero ler', 'To read'], 'gray', 'todo'], [['Lendo', 'Reading'], 'blue', 'progress'], [['Lido', 'Read'], 'green', 'complete']], dflt: 0 }, { name: ['Nota', 'Rating'], type: 'number' }, { name: ['Gênero', 'Genre'], type: 'multiSelect', options: [[['Ficção', 'Fiction'], 'purple'], [['Não ficção', 'Non-fiction'], 'blue'], [['Técnico', 'Technical'], 'gray']] }, { name: ['Terminado em', 'Finished on'], type: 'date' }],
    blocks: [['h', ['Resumo', 'Summary']], ['p', ['', '']], ['h', ['Citações', 'Quotes']], ['bullet', ['', '']]] },
  { id: 'task', name: ['Tarefa', 'Task'], icon: 'lucide:circle-check:green', color: 'green', description: ['Algo a fazer, com prazo', 'Something to do, with a due date'],
    fields: [{ name: ['Concluída', 'Done'], type: 'checkbox' }, { name: ['Prazo', 'Due'], type: 'date' }, { name: ['Prioridade', 'Priority'], type: 'select', options: [[['Alta', 'High'], 'red'], [['Média', 'Medium'], 'yellow'], [['Baixa', 'Low'], 'gray']] }],
    blocks: [['todo', ['', '']]] },
  { id: 'recipe', name: ['Receita', 'Recipe'], icon: 'lucide:cooking-pot:red', color: 'red', description: ['Ingredientes, tempo e preparo', 'Ingredients, time and steps'],
    fields: [{ name: ['Tempo (min)', 'Time (min)'], type: 'number' }, { name: ['Porções', 'Servings'], type: 'number' }, { name: ['Categoria', 'Category'], type: 'select', options: [[['Prato principal', 'Main'], 'orange'], [['Sobremesa', 'Dessert'], 'pink'], [['Bebida', 'Drink'], 'blue']] }, { name: ['Fonte', 'Source'], type: 'url' }],
    blocks: [['h', ['Ingredientes', 'Ingredients']], ['bullet', ['', '']], ['h', ['Preparo', 'Steps']], ['p', ['', '']]] },
  { id: 'idea', name: ['Ideia', 'Idea'], icon: 'lucide:lightbulb:yellow', color: 'yellow', description: ['Pensamentos para desenvolver', 'Thoughts to develop'],
    fields: [{ name: ['Estágio', 'Stage'], type: 'select', options: [[['Semente', 'Seed'], 'gray'], [['Explorando', 'Exploring'], 'blue'], [['Pronta', 'Ready'], 'green']] }, { name: ['Área', 'Area'], type: 'multiSelect', options: [] }],
    blocks: [['p', ['', '']]] },
  { id: 'resource', name: ['Recurso', 'Resource'], icon: 'lucide:link:blue', color: 'blue', description: ['Links, artigos e vídeos para ver depois', 'Links, articles and videos to check later'],
    fields: [{ name: ['URL', 'URL'], type: 'url' }, { name: ['Fonte', 'Source'], type: 'text' }, { name: ['Status de leitura', 'Reading status'], type: 'status', options: [[['Quero ver', 'To watch'], 'gray', 'todo'], [['Vendo', 'Watching'], 'blue', 'progress'], [['Visto', 'Watched'], 'green', 'complete']], dflt: 0 }, { name: ['Nota', 'Note'], type: 'text' }, { name: ['Tags', 'Tags'], type: 'multiSelect', options: [] }],
    blocks: [['h', ['Resumo', 'Summary']], ['p', ['', '']], ['h', ['Anotações', 'Notes']], ['bullet', ['', '']]] },
  { id: 'company', name: ['Empresa', 'Company'], icon: 'lucide:building-2:gray', color: 'gray', description: ['Organizações, clientes e fornecedores', 'Organizations, clients and vendors'],
    fields: [{ name: ['Site', 'Website'], type: 'url' }, { name: ['Setor', 'Industry'], type: 'select', options: [[['Tecnologia', 'Technology'], 'blue'], [['Finanças', 'Finance'], 'green'], [['Saúde', 'Health'], 'red'], [['Educação', 'Education'], 'purple'], [['Varejo', 'Retail'], 'orange'], [['Outro', 'Other'], 'gray']] }, { name: ['Contato principal', 'Main contact'], type: 'text' }, { name: ['Notas', 'Notes'], type: 'text' }],
    blocks: [['h', ['Sobre', 'About']], ['p', ['', '']], ['h', ['Contatos e histórico', 'Contacts and history']], ['bullet', ['', '']]] },
]

const pick = (l: L, locale: Locale) => (locale === 'en-US' ? l[1] : l[0])
const text = (value: string) => (value ? [{ type: 'text', text: value, styles: {} }] : [])

export function presetType(id: PresetId, locale: Locale, now = Date.now(), newId: () => string = () => globalThis.crypto.randomUUID()): ObjectType {
  const spec = PRESETS.find((preset) => preset.id === id)!
  const values: Record<string, string> = {}
  const properties: Property[] = spec.fields.map((field) => {
    const property: Property = { id: newId(), name: pick(field.name, locale), type: field.type }
    if (field.options) property.options = field.options.map(([name, color, group]) => ({ id: newId(), name: pick(name, locale), color, ...(group ? { group } : {}) }))
    if (field.numberFormat) property.numberFormat = field.numberFormat
    if (field.dflt !== undefined && property.options?.[field.dflt]) values[property.id] = property.options[field.dflt].id
    return property
  })
  const blocks = spec.blocks.map(([kind, label]) => kind === 'h' ? { type: 'heading', props: { level: 2 }, content: text(pick(label, locale)) } : { type: kind === 'todo' ? 'checkListItem' : kind === 'bullet' ? 'bulletListItem' : 'paragraph', content: text(pick(label, locale)) })
  const type: ObjectType = { id: newId(), name: pick(spec.name, locale), icon: spec.icon, color: spec.color, description: pick(spec.description, locale), properties, template: { blocks, ...(Object.keys(values).length ? { values } : {}) }, preset: spec.id, createdAt: now, updatedAt: now }
  if (spec.titleTemplate) type.titleTemplate = pick(spec.titleTemplate, locale)
  return type
}

export function presetLabel(id: PresetId, locale: Locale): { name: string; icon: string; description: string } {
  const spec = PRESETS.find((preset) => preset.id === id)!
  return { name: pick(spec.name, locale), icon: spec.icon, description: pick(spec.description, locale) }
}
