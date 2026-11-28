import { t } from '../../i18n'
import { protectedTitle } from '../../security/pageLock'
import type { Page } from '../../types'

export function trashPageLabels(page: Page, ancestors: Page[]) {
  const protectedLabel = t('Página protegida', 'Protected page')
  const untitled = t('Sem título', 'Untitled')
  const path: string[] = []
  let concealed = false
  for (const ancestor of ancestors) {
    const hiddenTitle = protectedTitle(ancestor, protectedLabel)
    path.push(hiddenTitle ?? (ancestor.title.trim() || untitled))
    if (hiddenTitle) { concealed = true; break }
  }
  concealed ||= !!protectedTitle(page, protectedLabel)
  return { title: concealed ? protectedLabel : page.title.trim() || untitled, path: path.join(' / '), concealed }
}

export function trashPageTitle(page: Page, ancestors: Page[]) {
  return trashPageLabels(page, ancestors).title
}
