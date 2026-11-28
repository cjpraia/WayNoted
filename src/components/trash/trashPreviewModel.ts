import { normalizeCanvas } from '../../canvas/model.ts'
import { blocksToHtml, esc } from '../../export/html.ts'
import { object, type RawBlock } from '../../export/model.ts'
import { readableText, readableValue } from '../../export/values.ts'
import { translate, type Locale } from '../../localization.ts'
import { isLiveIndexed, liveChildren } from '../../perf/pageIndex.ts'
import { lockedAncestor, withoutLockedPages } from '../../security/pageLock.ts'
import type { Page, Property, SyncedBlockRecord } from '../../types.ts'

type Pages = Record<string, Page>
type SyncedBlocks = Record<string, SyncedBlockRecord>
const RASTER_DATA = /^data:image\/(?:png|jpeg|webp|gif|avif|bmp);base64,[a-z0-9+/]+=*$/i

export function canReadTrashPreview(pages: Pages, id: string): boolean {
  return pages[id]?.trashed === true && !lockedAncestor(pages, id)
}

/** Check current access before starting storage I/O and again before accepting the result. */
export async function readTrashPreview(id: string, getPages: () => Pages, read: (id: string) => Promise<unknown[] | null>): Promise<unknown[] | undefined> {
  if (!canReadTrashPreview(getPages(), id)) return undefined
  const document = await read(id)
  const pages = getPages()
  if (!canReadTrashPreview(pages, id)) return undefined
  return document ?? pages[id].pendingTemplateBlocks ?? []
}

function previewBlocks(blocks: readonly unknown[]): RawBlock[] {
  return blocks.filter(object).map(block => {
    const children = Array.isArray(block.children) ? previewBlocks(block.children) : []
    const props = object(block.props) ? block.props : {}
    if (block.type === 'canvas') return { type: 'canvas', props: { ...normalizeCanvas(props).data }, children }
    if (block.type === 'image' && (typeof props.url !== 'string' || !RASTER_DATA.test(props.url))) {
      return { type: 'paragraph', content: [props.name, props.caption].filter(value => typeof value === 'string' && value).join(' · '), children }
    }
    if (block.type === 'file' || block.type === 'localAttachment' || block.type === 'pdfPreview' || block.type === 'video' || block.type === 'audio') {
      return { type: 'paragraph', content: [props.name, props.caption].filter(value => typeof value === 'string' && value).join(' · '), children }
    }
    return { ...block, props, children }
  })
}

function propertyText(page: Page, property: Property, pages: Pages, locale: Locale): string {
  return readableText(readableValue(page, property, pages), locale)
}

function metadataHtml(page: Page, pages: Pages, locale: Locale): string {
  const columns = page.database?.properties.filter(property => property.type !== 'button')
  const untitled = translate(locale, 'Sem título', 'Untitled')
  if (columns?.length) {
    const rows = liveChildren(pages, page.id)
    if (!rows.length) return ''
    const headers = columns.map(property => `<th scope="col">${esc(property.name)}</th>`).join('')
    const cells = rows.map(row => `<tr>${columns.map(property => `<td>${esc(property.type === 'title' ? row.title.trim() || untitled : propertyText(row, property, pages, locale))}</td>`).join('')}</tr>`).join('')
    return `<div class="table-wrap"><table aria-label="${esc(translate(locale, 'Linhas do banco de dados', 'Database rows'))}"><thead><tr>${headers}</tr></thead><tbody>${cells}</tbody></table></div>`
  }
  const props = (page.parentId && pages[page.parentId]?.database?.properties) || []
  const fields = props.filter(property => property.type !== 'title' && property.type !== 'button').flatMap(property => {
    const value = propertyText(page, property, pages, locale)
    return value ? [`<div><dt>${esc(property.name)}</dt><dd>${esc(value)}</dd></div>`] : []
  })
  return fields.length ? `<dl class="props">${fields.join('')}</dl>` : ''
}

/** Reuse the app's static renderer with no embed players, navigation, or remote media. */
export function trashPreviewHtml(owner: Document, pageId: string, blocks: readonly unknown[], pages: Pages, syncedBlocks: SyncedBlocks, locale: Locale): string {
  if (!canReadTrashPreview(pages, pageId)) return ''
  const accessible = withoutLockedPages(pages)
  const template = owner.createElement('template')
  template.innerHTML = metadataHtml(pages[pageId], accessible, locale) + blocksToHtml(previewBlocks(blocks), {
    href: () => '',
    media: url => RASTER_DATA.test(url) ? url : '',
    pageLink(id) {
      const label = accessible[id]?.title.trim() || translate(locale, 'Página indisponível', 'Unavailable page')
      return { label, destination: '' }
    },
    synced(id) {
      const record = syncedBlocks[id]
      const source = record && accessible[record.sourcePageId]
      return source && (source.id === pageId || isLiveIndexed(accessible, source.id)) ? previewBlocks(record.blocks) : undefined
    },
  })
  // The inert template never loads resources. Drop the links generated for static video and page references before mounting it.
  for (const anchor of template.content.querySelectorAll('a[href]')) anchor.removeAttribute('href')
  for (const details of template.content.querySelectorAll('details')) details.open = true
  return template.content.textContent?.trim() || template.content.querySelector('img, svg, hr') ? template.innerHTML : ''
}
