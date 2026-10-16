import { draftKey, legacyDraftKey, windowDraftId } from './util'
import { t } from '../../i18n'

function parse(raw: string | null): unknown[] | null {
  if (!raw) return null
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value)) throw new Error(t('Rascunho local inválido.', 'Invalid local draft.'))
  return value
}

export async function loadDraft(pageId: string): Promise<unknown[] | null> {
  const native = window.api
  if (native) {
    if (!native.draftLoad || !native.draftSave) throw new Error(t('Armazenamento criptografado de rascunhos indisponível.', 'Encrypted draft storage is unavailable.'))
    const stored = await native.draftLoad(pageId, windowDraftId())
    if (stored) return stored
    const legacy = parse(localStorage.getItem(legacyDraftKey(pageId)) ?? localStorage.getItem(draftKey(pageId)))
    if (!legacy) return null
    await native.draftSave(pageId, windowDraftId(), legacy)
    localStorage.removeItem(legacyDraftKey(pageId))
    localStorage.removeItem(draftKey(pageId))
    return legacy
  }
  return parse(localStorage.getItem(draftKey(pageId)) ?? localStorage.getItem(legacyDraftKey(pageId)))
}

export async function saveDraft(pageId: string, blocks: unknown[]): Promise<void> {
  const native = window.api
  if (native) {
    if (!native.draftSave) throw new Error(t('Armazenamento criptografado de rascunhos indisponível.', 'Encrypted draft storage is unavailable.'))
    await native.draftSave(pageId, windowDraftId(), blocks)
  } else localStorage.setItem(draftKey(pageId), JSON.stringify(blocks))
}

export async function deleteDraft(pageId: string): Promise<void> {
  const native = window.api
  if (native) {
    if (!native.draftDelete) throw new Error(t('Armazenamento criptografado de rascunhos indisponível.', 'Encrypted draft storage is unavailable.'))
    await native.draftDelete(pageId, windowDraftId())
  } else localStorage.removeItem(draftKey(pageId))
  localStorage.removeItem(legacyDraftKey(pageId))
  localStorage.removeItem(draftKey(pageId))
}
