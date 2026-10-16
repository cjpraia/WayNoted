import COMPAT from '../../shared/compatibility.ts'
// Notas diárias — parte com store: banco gerenciado "Notas diárias", criação sob demanda (uma nota por
// dia local AAAA-MM-DD), modelo configurável e navegação (hoje/ontem/amanhã, ‹ ›, links workspace://daily/…).
import { warnUnknownVariables } from '../templates/apply.ts'
import { setPendingCursor } from '../templates/cursor.ts'
import { trackStep } from '../onboarding/tracker.ts'
import { actions, api, getState, selectors } from '../store.ts'
import { translate } from '../localization.ts'
import { lockedAncestor, protectedAncestor } from '../security/pageLock.ts'
import { blocksToText } from '../components/page/util.ts'
import { documentLinks } from '../workspace.ts'
import { addDays, applyDailyTemplateFull, dailyDatabaseSchema, dailyDateProperty, dailyIndex, dailyLink, dailyTitle, defaultDailyTemplate, isISODate, localDay, type DailyContext, type DailyLocale } from './dailyCore.ts'
import type { DailyFlowSettings, Page } from '../types.ts'
import { tasksOnDay } from '../tasks/taskCore.ts'

const message = (pt: string, en: string) => translate(getState().settings.locale, pt, en)
const locale = (): DailyLocale => getState().settings.locale === 'en-US' ? 'en-US' : 'pt-BR'

export function dailySettings(): DailyFlowSettings { return getState().settings.dailyFlow ?? {} }
export function updateDailySettings(patch: Partial<DailyFlowSettings>) {
  actions.updateSettings({ dailyFlow: { ...dailySettings(), ...patch } })
}

/** Banco configurado, se ainda estiver vivo e for um banco. */
export function dailyDatabaseId(): string | null {
  const id = dailySettings().databaseId
  const page = id ? getState().pages[id] : undefined
  return page?.database && selectors.isLive(page.id) && dailyDateProperty(page.database) ? page.id : null
}

let indexMemo: { pages: Record<string, Page>; id: string; map: Map<string, Page> } | null = null
/** Data → nota diária (memoizado por versão das páginas). */
export function dailyNotesIndex(): Map<string, Page> {
  const id = dailyDatabaseId()
  const { pages } = getState()
  if (!id) return new Map()
  if (indexMemo && indexMemo.pages === pages && indexMemo.id === id) return indexMemo.map
  indexMemo = { pages, id, map: dailyIndex(pages, id, selectors.isLive) }
  return indexMemo.map
}

export function dailyNoteFor(date: string): Page | undefined { return dailyNotesIndex().get(date) }

/** Data da nota diária, quando `pageId` é uma nota diária do banco gerenciado. */
export function dailyDateOf(pageId: string): string | null {
  const id = dailyDatabaseId()
  const page = getState().pages[pageId]
  if (!id || page?.parentId !== id) return null
  const prop = dailyDateProperty(getState().pages[id].database)
  const value = prop ? page.props?.[prop] as { start?: unknown } | undefined : undefined
  return value && isISODate(value.start) ? value.start : null
}

/** Garante o banco "Notas diárias" na raiz; nunca sob página com senha. */
export function ensureDailyDatabase(): string {
  const existing = dailyDatabaseId()
  if (existing) {
    const { pages } = getState()
    if (lockedAncestor(pages, existing) || protectedAncestor(pages, existing)) throw new Error(message('O banco “Notas diárias” está dentro de uma página protegida por senha. Mova-o para fora (ou para a raiz) para criar notas diárias.', 'The “Daily notes” database is inside a password-protected page. Move it out (or to the top level) to create daily notes.'))
    return existing
  }
  const { schema } = dailyDatabaseSchema(locale())
  const id = actions.createPage(null, { title: message('Notas diárias', 'Daily notes'), icon: 'lucide:calendar-days:red', database: schema })
  updateDailySettings({ databaseId: id })
  return id
}

async function templateBlocks(): Promise<unknown[]> {
  const templateId = dailySettings().templateId
  if (templateId) {
    const personal = getState().settings.personalTemplates?.find(template => template.id === templateId)
    if (personal) return personal.blocks
    // Modelos de página embutidos (carregados sob demanda: o módulo puxa o editor).
    const { availableTemplates } = await import('../components/page/templates.ts')
    const builtIn = availableTemplates().find(template => template.id === templateId)
    if (builtIn) return builtIn.blocks
  }
  return defaultDailyTemplate(locale())
}

async function dayTasks(date: string) {
  try {
    const { currentTasks } = await import('../tasks/taskIndex.ts')
    return tasksOnDay(currentTasks(), date)
  } catch { return [] }
}

const creating = new Map<string, Promise<string>>()

/** Cria (se preciso) e devolve a nota do dia. Chamadas simultâneas para o mesmo dia reutilizam a criação. */
export function ensureDailyNote(date: string): Promise<string> {
  if (!isISODate(date)) return Promise.reject(new Error(message('Data inválida.', 'Invalid date.')))
  const found = dailyNoteFor(date)
  if (found) return Promise.resolve(found.id)
  const pending = creating.get(date)
  if (pending) return pending
  const operation = (async () => {
    const dbId = ensureDailyDatabase()
    const again = dailyNoteFor(date)
    if (again) return again.id
    const lang = locale()
    const neighbor = (iso: string) => { const note = dailyNoteFor(iso); return note ? `workspace://page/${note.id}` : dailyLink(iso) }
    const tasks = (await dayTasks(date)).map(task => ({ title: task.title, pageTitle: task.sourceTitle, time: task.time, href: `workspace://page/${task.pageId}${task.blockId ? `#block=${task.blockId}` : ''}` }))
    const ctx: DailyContext = { date, locale: lang, yesterdayHref: neighbor(addDays(date, -1)), tomorrowHref: neighbor(addDays(date, 1)), tasks, title: dailyTitle(date, lang), userName: getState().settings.userName || undefined }
    const { blocks, cursor, unknown } = applyDailyTemplateFull(await templateBlocks(), ctx)
    warnUnknownVariables(unknown)
    const propId = dailyDateProperty(getState().pages[dbId].database)!
    const text = blocksToText(blocks)
    const links = documentLinks(blocks)
    const id = actions.createRow(dbId, { [propId]: { start: date } }, { title: dailyTitle(date, lang), text, bodyText: text, outboundPageIds: links, bodyOutboundPageIds: links })
    setPendingCursor(id, cursor)
    await api.saveDoc(id, blocks)
    await actions.flushMeta()
    return id
  })()
  creating.set(date, operation)
  operation.finally(() => creating.delete(date)).catch(() => {})
  return operation
}

/** Abre a nota do dia (cria se não existir). */
export async function openDailyNote(date: string, options: { newTab?: boolean } = {}): Promise<string> {
  const id = await ensureDailyNote(date)
  if (date === localDay()) trackStep('daily')
  if (options.newTab) actions.openInNewTab({ type: 'page', id })
  else actions.openPage(id)
  return id
}

export const today = () => localDay()
export const openToday = () => openDailyNote(localDay())
export const openRelativeDay = (days: number) => openDailyNote(addDays(localDay(), days))

/** Links internos workspace://daily/AAAA-MM-DD (modelo: {{ontem}}/{{amanha}}). */
export function handleDailyLink(href: string, newTab = false): boolean {
  const match = new RegExp(`^(?:workspace|${COMPAT.record007}):\\/\\/daily\\/(\\d{4}-\\d{2}-\\d{2})$`, "").exec(href)
  if (!match || !isISODate(match[1])) return false
  void openDailyNote(match[1], { newTab }).catch(actions.reportSaveError)
  return true
}

/** Páginas criadas num dia local (painel do calendário), mais recentes primeiro. */
export function pagesCreatedOn(date: string, limit = 50): Page[] {
  const out: Page[] = []
  for (const page of Object.values(getState().pages)) {
    if (page.trashed || page.passwordLock || !page.createdAt) continue
    if (localDay(page.createdAt) === date && selectors.isLive(page.id)) out.push(page)
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
}

let createdMemo: { pages: Record<string, Page>; days: Map<string, number> } | null = null
/** Contagem de páginas criadas por dia (pontos do mini calendário). */
export function createdDays(): Map<string, number> {
  const { pages } = getState()
  if (createdMemo?.pages === pages) return createdMemo.days
  const days = new Map<string, number>()
  for (const page of Object.values(pages)) {
    if (page.trashed || page.passwordLock || !page.createdAt) continue
    const day = localDay(page.createdAt)
    days.set(day, (days.get(day) ?? 0) + 1)
  }
  createdMemo = { pages, days }
  return days
}
