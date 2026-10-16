// Itens do menu "/" das integrações locais do macOS: Ditado e Agenda de hoje.
import { CalendarDays, Mic } from 'lucide-react'
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions'
import type { SlashCommand } from '../page/slashMenu/catalog'
import type { PageEditorType } from '../page/schema'
import { toggleDictation } from './dictationSession'

const item = (id: string, en: string, pt: string, category: SlashCommand['category'], operation: string, aliases: string[], limit: string): SlashCommand =>
  ({ id, en, pt, category, operation, aliases: [...new Set([id, en.toLowerCase(), pt.toLowerCase(), ...aliases])], status: 'local-adaptation', limit })

export const INTEGRATION_COMMANDS: readonly SlashCommand[] = [
  item('dictation', 'Dictation', 'Ditado', 'Media', 'integration:dictation', ['dictate', 'ditar', 'voz', 'voice', 'speech', 'fala', 'transcrever', 'microfone'], 'Reconhecimento de fala no dispositivo; sem nuvem.'),
  item('today-agenda', 'Today’s agenda', 'Agenda de hoje', 'Advanced blocks', 'integration:agenda', ['agenda', 'calendar', 'calendário', 'calendario', 'eventos', 'events', 'today', 'hoje'], 'Eventos do Calendário do macOS escolhidos em Configurações.'),
]

export function integrationIcon(id: string) {
  if (id === 'dictation') return <Mic size={18} strokeWidth={1.6} />
  if (id === 'today-agenda') return <CalendarDays size={18} strokeWidth={1.6} />
  return null
}

/** Executa um item de integração; devolve false se a operação não for deste módulo. */
export function runIntegrationCommand(operation: string, editor: PageEditorType, targetBlockId?: string): boolean {
  if (operation === 'integration:dictation') { void toggleDictation(editor, { blockId: targetBlockId ?? editor.getTextCursorPosition().block.id }); return true }
  if (operation === 'integration:agenda') { insertOrUpdateBlockForSlashMenu(editor, { type: 'calendarAgenda' } as never); return true }
  return false
}
