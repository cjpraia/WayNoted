// Ações em lote da seleção múltipla da barra lateral (duplicar, favoritar, lixeira) e avisos de movimentação.
import { actions, getState } from '../store.ts'
import { t } from '../i18n.ts'
import { isLockedPage } from '../security/pageLock.ts'
import { flushDoc } from '../components/page/util.ts'
import { showToast } from '../components/ui/toastQueue.ts'
import { describeExclusion, type MoveResult } from './actions.ts'

const accessible = (ids: readonly string[]) => ids.filter((id) => { const p = getState().pages[id]; return !!p && !isLockedPage(p) })

export function bulkFavorite(ids: readonly string[]): boolean {
  const pages = accessible(ids).map((id) => getState().pages[id])
  const next = !pages.every((p) => p.favorite)
  for (const page of pages) if (page.favorite !== next) actions.updatePage(page.id, { favorite: next }, false)
  return next
}

export function bulkTrash(ids: readonly string[]): string[] {
  const done = accessible(ids)
  for (const id of done) actions.trashPage(id)
  if (done.length) showToast({
    message: done.length === 1 ? t('1 página foi para a lixeira.', '1 page moved to trash.') : t('{n} páginas foram para a lixeira.', '{n} pages moved to trash.', { n: done.length }),
    actionLabel: t('Desfazer', 'Undo'), onAction: () => { for (const id of done) actions.restorePage(id) },
  })
  if (done.length < ids.length) showToast({ message: t('{n} protegidas por senha ficaram de fora.', '{n} password-protected pages were left out.', { n: ids.length - done.length }), tone: 'error' })
  return done
}

export async function bulkDuplicate(ids: readonly string[]): Promise<number> {
  let count = 0
  for (const id of accessible(ids)) {
    try { await flushDoc(id); if (await actions.duplicatePage(id)) count++ } catch (error) { actions.reportSaveError(error); break }
  }
  await actions.flushMeta()
  showToast({ message: count === 1 ? t('1 página duplicada.', '1 page duplicated.') : t('{n} páginas duplicadas.', '{n} pages duplicated.', { n: count }) })
  return count
}

/** Aviso após mover páginas: entrou num banco (propriedades copiadas), saiu de um banco (propriedades guardadas) ou foi só uma mudança de lugar. */
export function announceMove(result: MoveResult) {
  const undo = { actionLabel: t('Desfazer', 'Undo'), onAction: () => { actions.undoDatabase() } }
  const left = result.excluded.length ? ' ' + t('{n} ficaram de fora ({why}).', '{n} were left out ({why}).', { n: result.excluded.length, why: [...new Set(result.excluded.map((e) => describeExclusion(e.reason)))].join(', ') }) : ''
  if (result.into === 'database') {
    if (!result.moved) { showToast({ message: t('Nenhuma página foi adicionada.', 'No page was added.') + left, tone: 'error' }); return }
    showToast({ message: (result.moved === 1 ? t('Adicionada como linha de “{name}”.', 'Added as a row of “{name}”.', { name: result.databaseTitle || t('banco', 'database') }) : t('{n} páginas adicionadas como linhas de “{name}”.', '{n} pages added as rows of “{name}”.', { n: result.moved, name: result.databaseTitle || t('banco', 'database') })) + left, ...undo })
  } else if (result.into === 'out') {
    showToast({ message: result.hidden
      ? t('Agora é uma página comum. {n} valores de propriedades ficam guardados, ocultos, e voltam se ela entrar num banco com as mesmas propriedades.', 'Now a regular page. {n} property values are kept, hidden, and return if it joins a database with the same properties.', { n: result.hidden })
      : t('Agora é uma página comum.', 'Now a regular page.'), ...undo, duration: 7000 })
  }
}
