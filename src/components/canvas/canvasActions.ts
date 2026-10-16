// Ações do quadro ligadas ao store: criar quadro, adicionar páginas, informações de cartão e exportação.
import { actions, api, getState, selectors } from '../../store'
import type { Page } from '../../types'
import { t } from '../../i18n'
import { flushDoc } from '../page/util'
import { iconLabel } from '../page/PageIcon'
import { lockedAncestor, protectedAncestor } from '../../security/pageLock'
import { canvasDocument, CANVAS_VERSION, DARK_PALETTE, DEFAULT_SIZE, LIGHT_PALETTE, readCanvasDocument, type CanvasObject, type CanvasPalette } from '../../canvas/model'
import { objectBounds, unionRects, type Point } from '../../canvas/geometry'
import { createBox, lookupOf } from '../../canvas/ops'
import { DEAD_LABEL, drawScene, type CardInfo } from '../../canvas/render'
import { canvasToSvg } from '../../canvas/svg'
import { embedInPng, embedInSvg } from '../../canvas/scene'
import { freezeConnectorEnds } from '../../canvas/ops'
import { printElement } from '../modals/printPage'

/** API of a mounted board (so actions elsewhere add cards to the live state instead of the file). */
export interface BoardHandle { addPages(pageIds: string[], at?: Point): string[]; focusObject(id: string): void }
const boards = new Map<string, BoardHandle>()
export function registerBoard(pageId: string, handle: BoardHandle) { boards.set(pageId, handle); return () => { if (boards.get(pageId) === handle) boards.delete(pageId) } }

export const isCanvasPage = (page: Page | undefined | null) => !!page?.canvas

export function createCanvas(parentId: string | null, init: Partial<Page> = {}): string {
  return actions.createPage(parentId, { title: '', ...init, canvas: { version: CANVAS_VERSION } })
}

/** Live boards, most recently edited first. */
export function canvasPages(): Page[] {
  return Object.values(getState().pages).filter(page => page.canvas && selectors.isLive(page.id) && !lockedAncestor(getState().pages, page.id)).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Card object for a page (database pages become database cards). */
export function cardFor(pageId: string, at: Point): CanvasObject {
  const page = getState().pages[pageId]
  const type = page?.database ? 'database' : 'page'
  const [w, h] = DEFAULT_SIZE[type]
  return createBox(type, at, { pageId, w, h })
}

/** Adds pages to a board (live board if mounted, otherwise its document). Returns the new object ids. */
export async function addPagesToCanvas(canvasId: string, pageIds: string[]): Promise<string[]> {
  const ids = pageIds.filter(id => id !== canvasId && selectors.isLive(id))
  if (!ids.length) return []
  const canvas = getState().pages[canvasId]
  if (!canvas?.canvas || !selectors.isLive(canvasId)) throw new Error(t('Lousa indisponível.', 'Whiteboard unavailable.'))
  if (canvas.locked) throw new Error(t('Esta lousa está bloqueada.', 'This whiteboard is locked.'))
  const live = boards.get(canvasId)
  if (live) return live.addPages(ids)
  await flushDoc(canvasId)
  const blocks = await api.loadDoc(canvasId)
  const doc = readCanvasDocument(blocks)
  const lookup = lookupOf(doc.data.objects)
  const extent = unionRects(doc.data.objects.map(o => objectBounds(o, lookup)))
  let x = extent ? extent.x + extent.w + 80 : 0, y = extent ? extent.y : 0
  const added: CanvasObject[] = []
  for (const id of ids) {
    const card = cardFor(id, { x: 0, y: 0 }) as Extract<CanvasObject, { x: number }>
    card.x = x; card.y = y
    y += card.h + 40
    added.push(card)
  }
  const next = { ...doc.data, objects: [...doc.data.objects, ...added] }
  await api.saveDoc(canvasId, canvasDocument(next, doc.blockId, doc.preserved), { base: blocks === null ? null : JSON.stringify(blocks), page: canvas, userEdit: true })
  return added.map(o => o.id)
}

/** "Mostrar no quadro": adds the page to `canvasId` (or a new board) and opens the board on its card. */
export async function showOnCanvas(pageId: string, canvasId: string | 'new') {
  const page = getState().pages[pageId]
  if (!page) return
  await actions.flushAll()
  const target = canvasId === 'new' ? createCanvas(null, { title: t('Lousa de {title}', 'Whiteboard for {title}', { title: page.title || t('Sem título', 'Untitled') }) }) : canvasId
  if (canvasId === 'new') await actions.flushMeta()
  const [objectId] = await addPagesToCanvas(target, [pageId])
  actions.openPage(target, objectId ? { blockId: objectId } : {})
}

/** What a card shows for its page, honouring trash and password protection. */
export function cardInfo(pages: Record<string, Page>, pageId: string): CardInfo {
  const page = pages[pageId]
  if (!page) return { title: t('Página excluída', 'Deleted page'), icon: '', excerpt: '', state: 'missing' }
  const locked = lockedAncestor(pages, pageId)
  if (locked) {
    const hidden = !!locked.passwordLock?.hideTitle || !!page.passwordLock?.hideTitle
    return { title: hidden ? t('Página protegida', 'Protected page') : page.title || t('Sem título', 'Untitled'), icon: '', excerpt: '', state: 'locked' }
  }
  const title = page.title || t('Sem título', 'Untitled')
  if (!selectors.isLive(pageId)) return { title, icon: iconLabel(page.icon), excerpt: '', state: 'trash' }
  const protectedPage = !!protectedAncestor(pages, pageId)
  return { title, icon: iconLabel(page.icon), excerpt: protectedPage ? '' : (page.text || '').slice(0, 600), state: 'ok', database: !!page.database, canvas: !!page.canvas }
}

export const paletteFor = (theme: 'light' | 'dark'): CanvasPalette => theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE

// ---------- exportação ----------

function safeName(title: string) { return (title || t('lousa', 'whiteboard')).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) }

async function saveBinary(name: string, bytes: Uint8Array, mime: string) {
  if (api.exportBinaryFile) return api.exportBinaryFile(name, bytes)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

function exportObjects(objects: readonly CanvasObject[], selection?: Set<string>): CanvasObject[] {
  const hidden = new Set(objects.filter(o => o.hidden).map(o => o.id))
  // Camadas ocultas não saem; conectores presos a elas também não (senão apareceriam soltos/"mortos").
  const shown = objects.filter(o => !o.hidden && !(o.type === 'connector' && ((o.from.id && hidden.has(o.from.id)) || (o.to.id && hidden.has(o.to.id)))))
  if (!selection?.size) return shown
  // Seleção: objetos escolhidos + conectores entre eles.
  return shown.filter(o => selection.has(o.id) || (o.type === 'connector' && !!o.from.id && !!o.to.id && selection.has(o.from.id) && selection.has(o.to.id)))
}

export function canvasSvg(objects: readonly CanvasObject[], theme: 'light' | 'dark', selection?: Set<string>): string {
  DEAD_LABEL.value = t('página na lixeira', 'page in trash')
  const pages = getState().pages
  return canvasToSvg(exportObjects(objects, selection), { palette: paletteFor(theme), card: id => cardInfo(pages, id) })
}

export async function exportCanvas(format: 'png' | 'svg' | 'pdf', title: string, objects: readonly CanvasObject[], theme: 'light' | 'dark', selection?: Set<string>): Promise<boolean> {
  const picked = exportObjects(objects, selection)
  if (!picked.length) throw new Error(t('Nada para exportar.', 'Nothing to export.'))
  const name = `${safeName(title)}.${format}`
  // PNG/SVG levam a cena embutida: arrastar o arquivo de volta para um quadro recria os objetos editáveis.
  if (format === 'svg') return api.exportFile(name, embedInSvg(canvasSvg(objects, theme, selection), freezeConnectorEnds(picked)))
  if (format === 'pdf') {
    if (!api.exportPDF) throw new Error(t('A exportação PDF requer o aplicativo desktop.', 'PDF export requires the desktop app.'))
    const holder = document.createElement('div')
    holder.className = 'cv-print'
    holder.innerHTML = canvasSvg(objects, 'light', selection)
    document.body.appendChild(holder)
    try { return await printElement(holder, () => api.exportPDF!(name)) } finally { holder.remove() }
  }
  const blob = await canvasPng(picked, theme)
  return saveBinary(name, embedInPng(new Uint8Array(await blob.arrayBuffer()), freezeConnectorEnds(picked)), 'image/png')
}

/** PNG through the same Canvas 2D renderer as the screen (2×, capped at 8192 px / 40 MP). */
export async function canvasPng(objects: readonly CanvasObject[], theme: 'light' | 'dark'): Promise<Blob> {
  DEAD_LABEL.value = t('página na lixeira', 'page in trash')
  const lookup = lookupOf(objects)
  const area = unionRects(objects.map(o => objectBounds(o, lookup)))!
  const pad = 32
  let scale = 2
  const fit = Math.min(8192 / (area.w + pad * 2), 8192 / (area.h + pad * 2), Math.sqrt(40e6 / ((area.w + pad * 2) * (area.h + pad * 2))))
  scale = Math.max(0.1, Math.min(scale, fit))
  const w = Math.ceil((area.w + pad * 2) * scale), h = Math.ceil((area.h + pad * 2) * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('Não foi possível criar a imagem.', 'Could not create the image.'))
  const images = new Map<string, HTMLImageElement>()
  await Promise.all(objects.filter(o => o.type === 'image').map(async o => {
    const src = (o as { src: string }).src
    if (images.has(src)) return
    const img = new Image(); img.src = src
    try { await img.decode(); images.set(src, img) } catch { /* Placeholder drawn instead. */ }
  }))
  const pages = getState().pages
  drawScene(ctx, { k: scale, tx: (pad - area.x) * scale, ty: (pad - area.y) * scale, w, h }, objects, { palette: paletteFor(theme), lookup, card: id => cardInfo(pages, id), image: src => images.get(src) ?? null })
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG')), 'image/png'))
}
