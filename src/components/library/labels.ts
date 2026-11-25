import { t } from '../../i18n'
import type { LibraryScope } from '../../types'

export function libraryTitle(scope: LibraryScope) {
  if (scope === 'recent') return t('Recentes', 'Recents')
  if (scope === 'untyped') return t('Sem tipo', 'Untyped')
  return t('Acervo', 'Library')
}
