// Escolha da exportação do Export Bundle: diálogo nativo no Electron, <input type=file> no navegador (desenvolvimento).
import type { SourceFile } from './vfs.ts'

export interface PickedExport { name: string; kind: 'zip' | 'folder' | 'enex'; files: SourceFile[] }
interface BundleImportBridge { pickBundleExport?(kind: 'zip' | 'folder' | 'enex'): Promise<PickedExport | null> }

function bridge(): BundleImportBridge | undefined { return (window as unknown as { api?: BundleImportBridge }).api }

export function hasNativePicker(): boolean { return typeof bridge()?.pickBundleExport === 'function' }

export async function pickExport(kind: 'zip' | 'folder' | 'enex'): Promise<PickedExport | null> {
  const native = bridge()
  if (native?.pickBundleExport) return native.pickBundleExport(kind)
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (kind === 'zip') input.accept = '.zip,application/zip'
    else if (kind === 'enex') { input.accept = '.enex'; input.multiple = true }
    else { input.setAttribute('webkitdirectory', ''); input.multiple = true }
    input.oncancel = () => resolve(null)
    input.onchange = async () => {
      try {
        const list = [...input.files ?? []]
        if (!list.length) return resolve(null)
        const files = await Promise.all(list.map(async file => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, data: new Uint8Array(await file.arrayBuffer()) })))
        const name = kind === 'zip' || kind === 'enex' ? (list.length > 1 ? `${list.length} .enex` : list[0].name) : (files[0].path.split('/')[0] || list[0].name)
        resolve({ name, kind, files })
      } catch (error) { reject(error) }
    }
    input.click()
  })
}

/** Arquivos soltos arrastados para o diálogo. */
export async function filesFromDrop(list: FileList): Promise<PickedExport | null> {
  const files = [...list]
  if (!files.length) return null
  const sources = await Promise.all(files.map(async file => ({ path: file.name, data: new Uint8Array(await file.arrayBuffer()) })))
  return { name: files.length === 1 ? files[0].name : `${files.length}`, kind: 'zip', files: sources }
}
