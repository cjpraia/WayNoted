// Item "/Tipo" do menu de barra: abre a escolha de tipo para a página atual.
import { Tag } from 'lucide-react'
import type { SlashCommand } from '../page/slashMenu/catalog'
import { openTypePicker } from '../../objecttypes/ui'

export const TYPE_COMMANDS: readonly SlashCommand[] = [
  { id: 'object-type', en: 'Type', pt: 'Tipo', category: 'Actions', operation: 'objecttype:apply', aliases: ['object-type', 'type', 'tipo', 'tipo de objeto', 'object type', 'supertag', 'tag', 'aplicar tipo', 'apply type'], status: 'local' },
]
export function typeIcon(id: string) { return id === 'object-type' ? <Tag size={18} strokeWidth={1.6} /> : null }
/** Executa "objecttype:*"; devolve false se a operação não for deste módulo. */
export function runTypeCommand(operation: string, pageId: string): boolean {
  if (operation !== 'objecttype:apply') return false
  openTypePicker([pageId])
  return true
}
