import type { Locale } from '../../localization.ts'

/** Configuração serializada do botão de página; nenhuma ação externa ou script é aceito. */
export type LocalPageButtonAction =
  | { kind: 'openPage'; targetPageId: string }
  | { kind: 'createPage'; parentPageId: string; title: string }
  | { kind: 'createRow'; databaseId: string; title: string }
  | { kind: 'setProperty'; rowId: string; propertyId: string; value: string | number | boolean | null }
  | { kind: 'duplicatePage'; targetPageId: string }
  | { kind: 'archivePage'; targetPageId: string }

export type LocalButtonErrorCode = 'configurationTooLong' | 'invalidConfiguration' | 'tooManyActions' | 'invalidAction' | 'incompleteAction'
const messages: Record<LocalButtonErrorCode, Record<Locale, string>> = {
  configurationTooLong: { 'pt-BR': 'Configuração de botão longa demais.', 'en-US': 'Button configuration is too long.' },
  invalidConfiguration: { 'pt-BR': 'Configuração de botão inválida.', 'en-US': 'Invalid button configuration.' },
  tooManyActions: { 'pt-BR': 'Botão aceita até 16 ações locais.', 'en-US': 'A button supports up to 16 local actions.' },
  invalidAction: { 'pt-BR': 'Ação de botão inválida.', 'en-US': 'Invalid button action.' },
  incompleteAction: { 'pt-BR': 'Complete o destino e a propriedade de cada ação antes de executar.', 'en-US': 'Complete each action’s target and property before running.' },
}
export class LocalButtonValidationError extends Error {
  readonly code: LocalButtonErrorCode
  constructor(code: LocalButtonErrorCode, locale: Locale) { super(messages[code][locale]); this.name = 'LocalButtonValidationError'; this.code = code }
}
const shortText = (value: unknown) => typeof value === 'string' && value.length <= 1000

/** Incomplete IDs are allowed only when rendering editable draft controls. Execution uses strict mode. */
export function decodeLocalButtonActions(json: string, locale: Locale = 'pt-BR', options: { allowIncomplete?: boolean } = {}): LocalPageButtonAction[] {
  const invalid = (code: LocalButtonErrorCode) => new LocalButtonValidationError(code, locale)
  const shortId = (value: unknown) => {
    if (typeof value !== 'string' || value.length > 200) throw invalid('invalidAction')
    if (!value.length && !options.allowIncomplete) throw invalid('incompleteAction')
    return true
  }
  if (json.length > 20_000) throw invalid('configurationTooLong')
  let raw: unknown
  try { raw = JSON.parse(json || '[]') } catch { throw invalid('invalidConfiguration') }
  if (!Array.isArray(raw)) throw invalid('invalidConfiguration')
  if (raw.length > 16) throw invalid('tooManyActions')
  return raw.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !('kind' in entry)) throw invalid('invalidAction')
    const action = entry as Record<string, unknown>
    if (['openPage', 'duplicatePage', 'archivePage'].includes(String(action.kind)) && shortId(action.targetPageId)) return { kind: action.kind, targetPageId: action.targetPageId } as LocalPageButtonAction
    if (action.kind === 'createPage' && shortId(action.parentPageId) && shortText(action.title)) return { kind: 'createPage', parentPageId: action.parentPageId, title: action.title } as LocalPageButtonAction
    if (action.kind === 'createRow' && shortId(action.databaseId) && shortText(action.title)) return { kind: 'createRow', databaseId: action.databaseId, title: action.title } as LocalPageButtonAction
    if (action.kind === 'setProperty' && shortId(action.rowId) && shortId(action.propertyId) && (action.value === null || typeof action.value === 'string' && action.value.length <= 1000 || typeof action.value === 'number' && Number.isFinite(action.value) || typeof action.value === 'boolean')) return { kind: 'setProperty', rowId: action.rowId, propertyId: action.propertyId, value: action.value } as LocalPageButtonAction
    throw invalid('invalidAction')
  })
}
