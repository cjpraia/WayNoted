import { actions, api } from '../../store'
import { t } from '../../i18n'

/** Mark a single mounted page and its ancestors for the native print media pass. */
export async function printElement(target: HTMLElement, exporter: () => Promise<boolean>) {
  const ancestors: HTMLElement[] = []
  for (let parent = target.parentElement; parent; parent = parent.parentElement) ancestors.push(parent)
  target.classList.add('np-print-target')
  ancestors.forEach(element => element.classList.add('np-print-ancestor'))
  try { return await exporter() }
  finally {
    target.classList.remove('np-print-target')
    ancestors.forEach(element => element.classList.remove('np-print-ancestor'))
  }
}

export async function exportVisiblePage(pageId: string, filename: string) {
  if (!api.exportPDF) throw new Error(t('A exportação PDF requer o aplicativo desktop.', 'PDF export requires the desktop app.'))
  await actions.flushAll()
  const target = [...document.querySelectorAll<HTMLElement>('.pg-root[data-page-id], .dbv[data-page-id]')].find(element => element.dataset.pageId === pageId)
  if (!target) throw new Error(t('Abra a página antes de exportar o PDF.', 'Open the page before exporting its PDF.'))
  return printElement(target, () => api.exportPDF!(filename))
}
