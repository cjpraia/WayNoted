// Sistema de arquivos virtual para exportações do Export Bundle: ZIP (inclusive ZIP dentro de ZIP) ou pasta.
// Puro (sem DOM/Electron) para ser testável em Node.
import { unzipSync } from 'fflate'

export interface SourceFile { path: string; data: Uint8Array }
export interface VirtualFS {
  /** Caminho normalizado (NFC, separador '/', sem prefixo) → bytes. */
  files: Map<string, Uint8Array>
  /** Problemas não fatais encontrados ao ler (entradas ignoradas, nomes inválidos…). */
  issues: VfsIssue[]
  nestedArchives: number
}
export type VfsIssue = { kind: 'unsafe-path' | 'too-large' | 'nested-depth' | 'bad-zip' | 'duplicate'; path: string }

export const LIMITS = {
  /** Tamanho máximo descompactado por entrada. */
  entryBytes: 512 * 1024 * 1024,
  /** Tamanho máximo descompactado de toda a exportação. */
  totalBytes: 4 * 1024 * 1024 * 1024,
  /** Profundidade máxima de ZIP dentro de ZIP. */
  nestedDepth: 4,
}

const IGNORED = /(^|\/)(__MACOSX(\/|$)|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i

/** Nomes de ZIP sem o sinalizador UTF-8 chegam decodificados como Latin-1; recupera acentos/emoji. */
export function repairName(name: string): string {
  if (!/[\u0080-ÿ]/.test(name) || /[^\u0000-ÿ]/.test(name)) return name
  try {
    const bytes = Uint8Array.from(name, char => char.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch { return name }
}

/** Normaliza um caminho relativo; devolve null se for inseguro (absoluto, `..`) ou ignorável. */
export function normalizePath(raw: string): string | null {
  const unified = raw.replace(/\\/g, '/').normalize('NFC')
  if (/^([a-z]:)?\//i.test(unified)) return null
  const parts: string[] = []
  for (const part of unified.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') return null
    parts.push(part)
  }
  if (!parts.length) return null
  return parts.join('/')
}

export function isZipName(name: string): boolean { return /\.zip$/i.test(name) }
export function isZipData(data: Uint8Array): boolean { return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && (data[2] === 3 || data[2] === 5) }

export function dirname(path: string): string { const index = path.lastIndexOf('/'); return index < 0 ? '' : path.slice(0, index) }
export function basename(path: string): string { return path.slice(path.lastIndexOf('/') + 1) }
export function joinPath(dir: string, name: string): string { return dir ? `${dir}/${name}` : name }

interface Budget { total: number }

function addFile(vfs: VirtualFS, path: string, data: Uint8Array, depth: number, budget: Budget) {
  if (IGNORED.test(path)) return
  if (isZipName(path) && isZipData(data)) {
    if (depth >= LIMITS.nestedDepth) { vfs.issues.push({ kind: 'nested-depth', path }); return }
    // ZIPs "Part-N" do Export Bundle espelham a mesma árvore: o conteúdo vai para a pasta do ZIP.
    expandZip(vfs, data, dirname(path), depth + 1, budget, path)
    vfs.nestedArchives++
    return
  }
  if (vfs.files.has(path)) {
    if (vfs.files.get(path)!.byteLength === data.byteLength) return
    vfs.issues.push({ kind: 'duplicate', path })
    return
  }
  vfs.files.set(path, data)
}

function expandZip(vfs: VirtualFS, data: Uint8Array, prefix: string, depth: number, budget: Budget, label: string) {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(data, {
      filter: entry => {
        if (entry.name.endsWith('/')) return false
        if (entry.originalSize > LIMITS.entryBytes) { vfs.issues.push({ kind: 'too-large', path: repairName(entry.name) }); return false }
        budget.total += entry.originalSize
        if (budget.total > LIMITS.totalBytes) throw new Error("BUNDLE_IMPORT_TOO_LARGE")
        return true
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === "BUNDLE_IMPORT_TOO_LARGE") throw error
    vfs.issues.push({ kind: 'bad-zip', path: label })
    return
  }
  for (const [rawName, bytes] of Object.entries(entries)) {
    const name = normalizePath(repairName(rawName))
    if (!name) { vfs.issues.push({ kind: 'unsafe-path', path: rawName }); continue }
    addFile(vfs, prefix ? `${prefix}/${name}` : name, bytes, depth, budget)
  }
}

/** Monta o sistema virtual a partir de arquivos soltos (pasta) e/ou ZIPs. */
export function buildVirtualFS(sources: SourceFile[]): VirtualFS {
  const vfs: VirtualFS = { files: new Map(), issues: [], nestedArchives: 0 }
  const budget: Budget = { total: 0 }
  const single = sources.length === 1 && isZipData(sources[0].data)
  for (const source of sources) {
    const path = normalizePath(repairName(source.path))
    if (!path) { vfs.issues.push({ kind: 'unsafe-path', path: source.path }); continue }
    if (single) { expandZip(vfs, source.data, '', 1, budget, path); continue }
    budget.total += source.data.byteLength
    if (budget.total > LIMITS.totalBytes) throw new Error("BUNDLE_IMPORT_TOO_LARGE")
    addFile(vfs, path, source.data, 0, budget)
  }
  stripWrapperFolders(vfs)
  return vfs
}

/** Remove pastas-invólucro únicas sem id (ex.: "Export-…" ou o nome da pasta escolhida). */
function stripWrapperFolders(vfs: VirtualFS) {
  for (let guard = 0; guard < 4; guard++) {
    const tops = new Set<string>()
    let rootFiles = false
    for (const path of vfs.files.keys()) {
      const index = path.indexOf('/')
      if (index < 0) { rootFiles = true; break }
      tops.add(path.slice(0, index))
      if (tops.size > 1) break
    }
    if (rootFiles || tops.size !== 1) return
    const [top] = tops
    // Uma pasta com companheiro (.md/.html/.csv) seria uma página; aqui não há arquivo na raiz, então é invólucro.
    const next = new Map<string, Uint8Array>()
    for (const [path, data] of vfs.files) next.set(path.slice(top.length + 1), data)
    vfs.files = next
  }
}

const decoder = new TextDecoder('utf-8')
export function readText(data: Uint8Array): string {
  const text = decoder.decode(data)
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).normalize('NFC')
}
