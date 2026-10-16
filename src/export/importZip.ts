import PRODUCT from '../../shared/product.json' with { type: 'json' }
// Reimporta um ZIP exportado em Markdown pelo próprio aplicativo (schema.json + front-matter).
import { actions, getState } from '../store'
import { t } from '../i18n'
import { findPackageRoot, packageToBackup } from './importPackage.ts'

const MAX_TOTAL = 1024 * 1024 * 1024

/** Devolve o id da primeira página importada, ou null se o ZIP não é um pacote do aplicativo. */
export async function importWorkspacePackage(archive: Uint8Array, parentId: string): Promise<string | null> {
  const { unzipSync } = await import('fflate')
  const names: string[] = []
  unzipSync(archive, { filter: (entry) => { names.push(entry.name); return false } })
  const root = findPackageRoot(names)
  if (root === null) return null
  let total = 0
  const files = unzipSync(archive, {
    filter: (entry) => {
      if (entry.name.endsWith('/')) return false
      if (entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').some((part) => part === '..')) throw new Error(t('O ZIP contém um caminho inválido.', 'The ZIP contains an invalid path.'))
      total += entry.originalSize
      if (total > MAX_TOTAL) throw new Error(t('O pacote excede 1 GB descompactado.', 'The package exceeds 1 GB uncompressed.'))
      return true
    },
  })
  let backup
  try { backup = packageToBackup(files) } catch (error) {
    throw new Error(t(`Pacote do ${PRODUCT.name} inválido: {reason}`, `Invalid ${PRODUCT.name} package: {reason}`, { reason: error instanceof Error ? error.message : String(error) }))
  }
  const before = new Set(Object.keys(getState().pages))
  await actions.importBackup(backup, parentId)
  const added = Object.values(getState().pages).filter((page) => !before.has(page.id) && page.parentId === parentId).sort((a, b) => a.order - b.order)
  return added[0]?.id ?? parentId
}
