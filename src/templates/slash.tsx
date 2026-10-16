// Menu "/variável": insere a {{variável}} de modelo como texto no editor (para quem escreve um modelo). docs/USAGE.md
import { Braces } from 'lucide-react'
import type { SlashCommand } from '../components/page/slashMenu/catalog'
import { TEMPLATE_VARIABLES, type VariableInfo } from './variables'

const ids = ['date', 'time', 'title', 'weekday', 'week', 'month', 'year', 'user', 'date-plus', 'cursor', 'ask', 'prop']
const infos: VariableInfo[] = ids.map(id => TEMPLATE_VARIABLES.find(info => info.id === id)!).filter(Boolean)

export const TEMPLATE_VARIABLE_COMMANDS: readonly SlashCommand[] = infos.map(info => ({
  id: `template-var-${info.id}`, en: `Variable: ${info.en}`, pt: `Variável: ${info.pt}`, category: 'Inline' as const, operation: `tplvar:${info.id}`,
  aliases: ['variavel', 'variável', 'variable', 'modelo', 'template', 'placeholder', info.en.toLowerCase(), info.pt.toLowerCase()], status: 'local' as const,
}))
export function templateVariableIcon(id: string) { return id.startsWith('template-var-') ? <Braces size={18} strokeWidth={1.6} /> : null }

interface TextEditor { insertInlineContent: (content: unknown[]) => void }
/** Executa "tplvar:*"; devolve false se a operação não for deste módulo. */
export function runTemplateVariableCommand(operation: string, editor: TextEditor, locale: 'pt-BR' | 'en-US'): boolean {
  if (!operation.startsWith('tplvar:')) return false
  const info = TEMPLATE_VARIABLES.find(item => item.id === operation.slice(7))
  if (!info) return false
  editor.insertInlineContent([{ type: 'text', text: info.token[locale], styles: {} }])
  return true
}
