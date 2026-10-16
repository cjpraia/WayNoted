// Espelho Markdown (docs/DEVELOPMENT.md D1): decide quais páginas entram, o que mudou e gera os arquivos
// reaproveitando o conversor da exportação (src/export). Puro e testável: sem store, sem Electron.
// Nunca entram: páginas protegidas por senha (e subpáginas), "Não espelhar", lixeira.
import type { Page, SyncedBlockRecord } from '../types'
import type { Locale } from '../localization'
import { isLivePage } from '../components/database/derived.ts'
import { buildLayout, type Layout } from '../export/layout.ts'
import { buildExportPackage, referencedBlockIds } from '../export/package.ts'
import { encodeLinkPath, object, relativePath, tr, type ExportSource, type PackageFiles } from '../export/model.ts'
import type { ObjectType } from '../objecttypes/model.ts'
import { canvasToSvg } from '../canvas/svg.ts'
import { LIGHT_PALETTE, type CanvasObject } from '../canvas/model.ts'

/** Mude ao alterar o formato dos arquivos: força a regravação de tudo. */
export const MIRROR_VERSION = 1

/** Por que uma página fica de fora (para a contagem e para o aviso na interface). */
export type MirrorExclusion = 'protected' | 'skipped'

export interface Mirrorable { pages: Record<string, Page>; excluded: Map<string, MirrorExclusion> }

/** Páginas vivas que podem ir para o espelho. Protegidas por senha (trancadas ou não) e "Não espelhar" saem com as subpáginas. */
export function mirrorablePages(pages: Record<string, Page>): Mirrorable {
  const verdict = new Map<string, MirrorExclusion | null>()
  const judge = (id: string): MirrorExclusion | null => {
    if (verdict.has(id)) return verdict.get(id)!
    verdict.set(id, 'protected') // ciclo: fora por segurança
    const page = pages[id]
    let result: MirrorExclusion | null = null
    if (page) {
      if (page.passwordLock) result = 'protected'
      else {
        const parent = page.parentId ? judge(page.parentId) : null
        result = parent === 'protected' ? 'protected' : page.mirrorSkip === true ? 'skipped' : parent
      }
    }
    verdict.set(id, result)
    return result
  }
  const out: Record<string, Page> = {}
  const excluded = new Map<string, MirrorExclusion>()
  for (const id of Object.keys(pages)) {
    if (!isLivePage(id, pages)) continue // lixeira nunca
    const reason = judge(id)
    if (reason) excluded.set(id, reason)
    else out[id] = pages[id]
  }
  return { pages: out, excluded }
}

/** FNV-1a de 32 bits: assinatura barata de uma página (não é criptográfica). */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36) + text.length.toString(36)
}

export interface MirrorPrevPage { sig: string; files: string[] }
export interface MirrorPrev { version: number; globalSig: string; pages: Record<string, MirrorPrevPage> }
export interface PagePlan { file: string; files: string[]; sig: string }

export interface PlanInput {
  pages: Record<string, Page>
  syncedBlocks?: Record<string, SyncedBlockRecord>
  objectTypes?: ObjectType[]
  locale: Locale
  workspaceName: string
  prev: MirrorPrev | null
  force?: boolean
}
export interface MirrorPlan {
  mirrorable: Mirrorable
  layout: Layout
  pages: Record<string, PagePlan>
  dirty: Set<string>
  /** Páginas do espelho anterior que sumiram (excluídas, movidas para a lixeira, protegidas ou "Não espelhar"). */
  removed: string[]
  /** Todas as páginas foram regeradas: dá para limpar anexos que ninguém mais usa. */
  complete: boolean
  globalSig: string
}

const untitledOf = (locale: Locale) => tr(locale, 'Sem título', 'Untitled')

/** Arquivos que pertencem a uma página: o `.md`, e para bancos o CSV e o schema; para lousas o SVG. */
export function filesOfNode(node: Layout['order'][number]): string[] {
  const files = [node.file]
  if (node.kind === 'database') files.push(`${node.dir ? node.dir + '/' : ''}${node.base}.csv`, `${node.dir}/schema.json`)
  if (node.page.canvas) files.push(node.file.replace(/\.md$/, '.svg'))
  return files
}

export function planMirror(input: PlanInput): MirrorPlan {
  const mirrorable = mirrorablePages(input.pages)
  const layout = buildLayout(mirrorable.pages, 'workspace', undefined, 'md', untitledOf(input.locale), true)
  const globalSig = fingerprint(JSON.stringify([MIRROR_VERSION, input.locale, input.workspaceName, input.objectTypes ?? []]))
  const prev = input.prev && input.prev.version === MIRROR_VERSION && input.prev.globalSig === globalSig && !input.force ? input.prev : null
  const pages: Record<string, PagePlan> = {}
  const dirty = new Set<string>()
  let structural = !prev
  for (const node of layout.order) {
    const page = node.page
    const synced = (page.syncedBlockIds ?? []).map((id) => input.syncedBlocks?.[id]?.updatedAt ?? 0).join(',')
    const files = filesOfNode(node)
    const sig = fingerprint(JSON.stringify(page) + '|' + synced + '|' + node.file)
    pages[page.id] = { file: node.file, files, sig }
    const before = prev?.pages[page.id]
    if (!before || before.sig !== sig) dirty.add(page.id)
    // Mudou de lugar/nome: links em outras páginas mudam de destino.
    if (before && before.files[0] !== node.file) structural = true
  }
  const removed = prev ? Object.keys(prev.pages).filter((id) => !pages[id]) : []
  if (removed.length) structural = true
  if (structural) for (const id of Object.keys(pages)) dirty.add(id)
  else if (dirty.size) {
    // Linhas e fontes de bancos vinculados: o banco mostra a tabela das linhas.
    const viewsOf = new Map<string, string[]>()
    for (const node of layout.order) {
      const db = node.page.database
      if (!db) continue
      for (const source of [db.linkedSourceId, ...(db.sourceDatabaseIds ?? [])]) if (source) viewsOf.set(source, [...(viewsOf.get(source) ?? []), node.page.id])
    }
    for (const id of [...dirty]) {
      const page = layout.nodes.get(id)?.page
      const parent = page?.parentId
      if (parent && layout.nodes.get(parent)?.page.database) dirty.add(parent)
      for (const view of viewsOf.get(id) ?? []) dirty.add(view)
      for (const view of parent ? viewsOf.get(parent) ?? [] : []) dirty.add(view)
    }
  }
  return { mirrorable, layout, pages, dirty, removed, complete: dirty.size >= layout.order.length, globalSig }
}

/** Ids de bloco citados (links `#block=`, comentários) por UM documento. */
export function docRefs(doc: unknown[]): string[] {
  return [...referencedBlockIds({ pages: {}, documents: { x: doc }, workspaceName: '', locale: 'pt-BR' })]
}
/** Une as citações por página, os blocos sincronizados e os comentários: ids de bloco que precisam sobreviver no Markdown. */
export function keepIdsFrom(refs: Iterable<readonly string[]>, pages: Record<string, Page>, syncedBlocks?: Record<string, SyncedBlockRecord>): Set<string> {
  const out = new Set<string>()
  for (const ids of refs) for (const id of ids) out.add(id)
  for (const record of Object.values(syncedBlocks ?? {})) for (const id of docRefs(record.blocks as unknown[])) out.add(id)
  for (const id of referencedBlockIds({ pages, documents: {}, workspaceName: '', locale: 'pt-BR' })) out.add(id)
  return out
}
/** Atalho para quem já tem todos os documentos (testes). */
export function keepIdsOf(pages: Record<string, Page>, documents: Record<string, unknown[]>, syncedBlocks?: Record<string, SyncedBlockRecord>): Set<string> {
  return keepIdsFrom(Object.values(documents).map(docRefs), pages, syncedBlocks)
}

export interface BuildInput {
  plan: MirrorPlan
  documents: Record<string, unknown[]>
  syncedBlocks?: Record<string, SyncedBlockRecord>
  objectTypes?: ObjectType[]
  workspaceName: string
  locale: Locale
  keepIds?: Set<string>
  /** Opcional: gera só estas páginas (padrão: as sujas do plano). */
  only?: ReadonlySet<string>
}

/** Gera os arquivos (relativos à pasta do espaço) das páginas sujas. */
export async function buildMirrorFiles(input: BuildInput): Promise<PackageFiles> {
  const { plan } = input
  const only = input.only ?? plan.dirty
  // Blocos sincronizados de páginas excluídas não podem vazar para dentro de outras páginas.
  const syncedBlocks = Object.fromEntries(Object.entries(input.syncedBlocks ?? {}).filter(([, record]) => !!plan.mirrorable.pages[record.sourcePageId]))
  const source: ExportSource = {
    pages: plan.mirrorable.pages,
    documents: Object.fromEntries(Object.keys(plan.mirrorable.pages).map((id) => [id, input.documents[id] ?? []])),
    syncedBlocks, objectTypes: input.objectTypes, workspaceName: input.workspaceName, locale: input.locale,
  }
  const { files } = await buildExportPackage(source, {
    format: 'markdown', scope: 'workspace', includeFiles: true, stableNames: true, only, skipManifest: true,
    keepIds: input.keepIds ?? keepIdsOf(plan.mirrorable.pages, source.documents, syncedBlocks),
  })
  // Lousas: SVG ao lado do Markdown (imagens ficam de fora para o arquivo não crescer).
  for (const id of only) {
    const node = plan.layout.nodes.get(id)
    if (!node?.page.canvas || !files[node.file]) continue
    const block = (input.documents[id] ?? []).find((b) => object(b) && b.type === 'canvas') as { props?: { objects?: unknown } } | undefined
    const objects = (Array.isArray(block?.props?.objects) ? block!.props!.objects : []).filter(object).map((o) => o.type === 'image' ? { ...o, src: '' } : o) as unknown as CanvasObject[]
    if (!objects.length) continue
    try {
      const svgPath = node.file.replace(/\.md$/, '.svg')
      files[svgPath] = canvasToSvg(objects, { palette: LIGHT_PALETTE, images: false, card: (pageId) => ({ title: plan.mirrorable.pages[pageId]?.title || untitledOf(input.locale), icon: '', excerpt: '', state: 'ok' }) })
      const name = svgPath.split('/').pop()!
      files[node.file] = `${files[node.file] as string}\n![${tr(input.locale, 'Lousa', 'Whiteboard')}](${encodeLinkPath(relativePath(node.file, svgPath)) || encodeLinkPath(name)})\n`
    } catch { /* SVG é um extra: o Markdown legível já está no arquivo */ }
  }
  return files
}
