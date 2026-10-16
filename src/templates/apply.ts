// Aplicação de modelos com variáveis: contexto do usuário, perguntas, aviso de variáveis desconhecidas.
// Não destrutivo: variável desconhecida fica literal e é avisada; cancelar a pergunta cancela a aplicação.
import { getState } from '../store.ts'
import { getLocale, t } from '../i18n.ts'
import { showToast } from '../components/ui/toastQueue.ts'
import type { Page } from '../types'
import { askTemplateQuestions } from './promptBus.ts'
import { rowTemplateQuestions } from './rowTemplate.ts'
export { rowPropValues } from './rowTemplate.ts'
import { rowPropValues } from './rowTemplate.ts'
import { collectQuestions, expandTemplate, expandTemplateText, nowContext, propKey, type ExpandResult, type TemplateContext } from './variables.ts'

export interface PrepareOptions {
  /** Título da página que recebe o modelo ({{titulo}}). */
  title?: string
  /** Linha de banco: libera {{prop:Nome}}. */
  row?: Page
  /** false = não perguntar (criação automática); usa os valores padrão. */
  prompt?: boolean
  /** Título do modelo (pode ter variáveis): suas perguntas entram no mesmo diálogo e o resultado vem em `title`. */
  titleTemplate?: string
  /** Nome da pergunta no cabeçalho do diálogo. */
  heading?: string
  warn?: boolean
}

export function contextFor(options: PrepareOptions = {}, answers?: Record<string, string>): TemplateContext {
  const state = getState()
  return nowContext(getLocale(), {
    title: options.title, userName: state.settings.userName || undefined, answers,
    ...(options.row ? { props: rowPropValues(options.row, options.row.parentId ? state.pages[options.row.parentId]?.database : undefined, state.pages) } : {}),
  })
}

export function warnUnknownVariables(unknown: readonly string[]) {
  if (!unknown.length) return
  const shown = unknown.slice(0, 3).join(' ') + (unknown.length > 3 ? '…' : '')
  showToast({ message: t('Variável desconhecida mantida como texto: {names}', 'Unknown variable kept as text: {names}', { names: shown }), duration: 7000 })
}

export interface PreparedTemplate extends ExpandResult { title?: string; answers: Record<string, string> }

/** Expande o modelo (perguntando antes, se houver). `null` = o usuário cancelou. */
export async function prepareTemplate(blocks: readonly unknown[], options: PrepareOptions = {}): Promise<PreparedTemplate | null> {
  const questions = collectQuestions(blocks, options.titleTemplate ? [options.titleTemplate] : [])
  let answers: Record<string, string> = {}
  if (questions.length) {
    if (options.prompt === false) answers = Object.fromEntries(questions.map(q => [q.label, q.default]))
    else { const given = await askTemplateQuestions(questions, options.heading); if (!given) return null; answers = given }
  }
  let ctx = contextFor(options, answers)
  const titled = options.titleTemplate !== undefined ? expandTemplateText(options.titleTemplate, ctx) : null
  if (titled && options.title === undefined) ctx = { ...ctx, title: titled.text }
  const result = expandTemplate(blocks, ctx, undefined, { keepIds: true, mergeText: true })
  const unknown = [...new Set([...result.unknown, ...(titled?.unknown ?? [])])]
  if (options.warn !== false) warnUnknownVariables(unknown)
  return { ...result, unknown, answers, ...(titled ? { title: titled.text } : {}) }
}

/** Perguntas do modelo de linha (o escolhido ou o padrão do banco). `undefined` = não há perguntas; `null` = cancelou. */
export async function askRowTemplate(dbId: string, templateId?: string): Promise<Record<string, string> | null | undefined> {
  const schema = getState().pages[dbId]?.database
  const template = schema?.templates?.find(item => item.id === (templateId ?? schema.defaultTemplateId))
  if (!template) return undefined
  const questions = rowTemplateQuestions(template as { title: string; bodyBlocks?: unknown[] }, template.props as never)
  if (!questions.length) return undefined
  return askTemplateQuestions(questions, template.name || template.title)
}

/** Há perguntas no modelo de linha? (síncrono: evita atrasar a criação quando não há.) */
export function rowTemplateHasQuestions(dbId: string, templateId?: string): boolean {
  const schema = getState().pages[dbId]?.database
  const template = schema?.templates?.find(item => item.id === (templateId ?? schema.defaultTemplateId))
  return !!template && rowTemplateQuestions(template as { title: string; bodyBlocks?: unknown[] }, template.props as never).length > 0
}
