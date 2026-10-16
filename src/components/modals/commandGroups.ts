/** Grupos do ⌘K (Miller/Chunking): no máximo 7 comandos por grupo antes de "Mais". */
export const COMMAND_GROUP_LIMIT = 7
export type CommandGroupId = 'goto' | 'create' | 'page' | 'settings' | 'ai'
export const COMMAND_GROUPS: { id: CommandGroupId; label: (t: (pt: string, en: string) => string) => string }[] = [
  { id: 'goto', label: (t) => t('Ir para', 'Go to') },
  { id: 'create', label: (t) => t('Criar', 'Create') },
  { id: 'page', label: (t) => t('Ações da página', 'Page actions') },
  { id: 'settings', label: (t) => t('Configurações', 'Settings') },
  { id: 'ai', label: (t) => t('IA', 'AI') },
]

const GROUP_BY_ID: Record<string, CommandGroupId> = {
  home: 'goto', graph: 'goto', inbox: 'goto', tasks: 'goto', productivity: 'goto', back: 'goto', forward: 'goto', tab: 'goto', window: 'goto',
  'daily-today': 'goto', 'daily-yesterday': 'goto', 'daily-tomorrow': 'goto', 'object-types': 'create', 'types-guide': 'settings', 'types-manage': 'settings',
  new: 'create', db: 'create', 'canvas-new': 'create', subpage: 'create', query: 'create',
  'trash-open': 'goto', import: 'settings', export: 'settings', backup: 'settings',
  settings: 'settings', 'calendar-panel': 'settings', sidebar: 'settings', light: 'settings', dark: 'settings', system: 'settings', language: 'settings', shortcuts: 'settings',
  'ask-notes': 'ai', 'local-ai': 'ai',
}

export function commandGroup(id: string): CommandGroupId {
  if (GROUP_BY_ID[id]) return GROUP_BY_ID[id]
  if (id.startsWith('type-collection-')) return 'goto'
  if (id.startsWith('template-') || id.startsWith('query-')) return 'create'
  return 'page'
}
