import type { ReactNode, SVGProps } from 'react'

/** Neutral block glyphs drawn for the 16–20px menu and sidebar scale. */
export function BlockIcon({ name, size = 18, ...props }: SVGProps<SVGSVGElement> & { name: string; size?: number }) {
  const normalized = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[ _]/g, '-')
  const key = normalized.startsWith('turn-') ? normalized.slice(5) : normalized
  let drawing: ReactNode
  let fallback = false
  const swatch = key.replace(/^(?:text-color|background-color)-/, '')
  const palette = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']
  if (key.startsWith('text-color-') && palette.includes(swatch)) {
    const color = swatch === 'default' ? 'var(--text)' : `var(--bn-colors-highlights-${swatch}-text)`
    drawing = <><rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="var(--bg-popover)" stroke="var(--border-strong)"/><text x="7" y="18" fill={color} stroke="none" fontSize="16" fontWeight="600">A</text></>
  } else if (key.startsWith('background-color-') && palette.includes(swatch)) {
    const color = swatch === 'default' ? 'var(--bg-popover)' : `var(--bn-colors-highlights-${swatch}-background)`
    drawing = <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill={color} stroke="var(--border-strong)"/>
  } else switch (key) {
    case 'page':
    case 'file-text':
      drawing = <><path d="M6 2.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V4A1.5 1.5 0 0 1 6.5 2.5Z"/><path d="M14 2.5V7h4M8 12h7M8 16h7"/></>; break
    case 'page-in':
    case 'link-to-page':
      drawing = <><path d="M6 2.5h8l4 4V12M14 2.5V7h4M6.5 2.5A1.5 1.5 0 0 0 5 4v16a1.5 1.5 0 0 0 1.5 1.5H11"/><path d="M11 20 20 11m-6 0h6v6"/></>; break
    case 'database':
    case 'database-full-page':
    case 'table':
    case 'table-view':
      drawing = <><rect x="2.5" y="3.5" width="19" height="17" rx="2"/><path d="M2.5 9h19M2.5 14.5h19M9.5 9v11.5"/></>; break
    case 'database-inline':
      drawing = <><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 10h6M9 14h6M2.5 9V6a3.5 3.5 0 0 1 3.5-3.5H9M15 2.5h3A3.5 3.5 0 0 1 21.5 6v3M21.5 15v3a3.5 3.5 0 0 1-3.5 3.5h-3M9 21.5H6A3.5 3.5 0 0 1 2.5 18v-3"/></>; break
    case 'linked-data-source':
      drawing = <><rect x="2.5" y="3.5" width="17" height="14" rx="2"/><path d="M2.5 8h17M8 8v9.5M13 11h8m-4-4 4 4-4 4"/></>; break
    case 'board':
    case 'board-view':
      drawing = <><rect x="2.5" y="3.5" width="19" height="17" rx="2"/><path d="M9 3.5v17M15.5 3.5v17"/></>; break
    case 'gallery':
    case 'gallery-view':
      drawing = <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>; break
    case 'list':
    case 'list-view':
      drawing = <><path d="M9 5h12M9 12h12M9 19h12"/><circle cx="4.5" cy="5" r=".7" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r=".7" fill="currentColor" stroke="none"/><circle cx="4.5" cy="19" r=".7" fill="currentColor" stroke="none"/></>; break
    case 'feed':
    case 'feed-view':
      drawing = <><rect x="6" y="3" width="15" height="17" rx="2"/><path d="M6 7H3a1 1 0 0 0-1 1v13h15M9 9h9M9 13h9M9 17h6"/></>; break
    case 'dashboard':
    case 'dashboard-view':
      drawing = <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="11" height="7" rx="1"/><rect x="18" y="14" width="3" height="7" rx="1"/></>; break
    case 'calendar':
    case 'calendar-view':
      drawing = <><rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M3 9.5h18M7 2.5v4M17 2.5v4"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01" strokeWidth="2.5" strokeLinecap="round"/></>; break
    case 'timeline':
    case 'timeline-view':
      drawing = <><rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="M6 8h12M6 12h8M9 16h9"/></>; break
    case 'map':
    case 'map-view':
      drawing = <><path d="m2.5 5 6.5-2 6 2 6.5-2v16l-6.5 2-6-2-6.5 2V5ZM9 3v16M15 5v16"/></>; break
    case 'chart':
    case 'chart-vertical-bar':
    case 'vertical-bar-chart':
      drawing = <><rect x="3" y="11" width="3" height="10" rx=".5"/><rect x="10.5" y="6" width="3" height="15" rx=".5"/><rect x="18" y="3" width="3" height="18" rx=".5"/></>; break
    case 'horizontal-bar-chart':
    case 'chart-horizontal-bar':
      drawing = <><rect x="3" y="3" width="14" height="3" rx=".5"/><rect x="3" y="10.5" width="18" height="3" rx=".5"/><rect x="3" y="18" width="10" height="3" rx=".5"/></>; break
    case 'line-chart':
    case 'chart-line':
      drawing = <><path d="M3 3v18h18M5.5 16 10 11l4 3 6-8"/></>; break
    case 'donut-chart':
    case 'chart-donut':
      drawing = <><path d="M12 3a9 9 0 1 0 9 9h-7a2 2 0 1 1-2-2V3Z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15Z"/></>; break
    case 'number-chart':
    case 'chart-number':
      drawing = <><path d="M9 3 6 21M18 3l-3 18M3 9h18M2 16h18"/></>; break
    case 'form':
      drawing = <><path d="M3 4h17M3 9h13M3 14h17M3 19h11"/></>; break
    case 'text':
      drawing = <><path d="M4 4h16M12 4v16"/></>; break
    case 'heading-1':
    case 'heading-2':
    case 'heading-3':
    case 'heading-4':
    case 'toggle-heading-1':
    case 'toggle-heading-2':
    case 'toggle-heading-3':
    case 'toggle-heading-4':
      drawing = <><path d="M3 4v16M13 4v16M3 12h10"/><text x="16" y="20" fill="currentColor" stroke="none" fontSize="10" fontWeight="600">{key.slice(-1)}</text></>; break
    case 'bulleted-list':
      drawing = <><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none"/></>; break
    case 'numbered-list':
      drawing = <><path d="M9 6h12M9 12h12M9 18h12"/><text x="2" y="8" fill="currentColor" stroke="none" fontSize="7">1</text><text x="2" y="14" fill="currentColor" stroke="none" fontSize="7">2</text><text x="2" y="20" fill="currentColor" stroke="none" fontSize="7">3</text></>; break
    case 'to-do-list':
      drawing = <><rect x="2.5" y="3.5" width="5" height="5" rx=".5"/><rect x="2.5" y="15.5" width="5" height="5" rx=".5"/><path d="m3.5 5.5 1.5 1.5 3-4M11 6h10M11 18h10"/></>; break
    case 'toggle-list':
      drawing = <><path d="m3 3 6 3-6 3V3ZM12 6h9M3 15l6 3-6 3v-6ZM12 18h9"/></>; break
    case 'quote':
      drawing = <><path d="M10 6C5 7 3 10 3 15a3 3 0 0 0 6 0c0-2-1-3-3-3M21 6c-5 1-7 4-7 9a3 3 0 0 0 6 0c0-2-1-3-3-3"/></>; break
    case 'callout':
      drawing = <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M12 8v10"/></>; break
    case 'divider':
      drawing = <path d="M2 12h20"/>; break
    case 'image':
      drawing = <><rect x="2.5" y="3.5" width="19" height="17" rx="2"/><circle cx="8" cy="8.5" r="1"/><path d="m3 18 6-6 4 4 3-3 5 5"/></>; break
    case 'video':
    case 'online-video':
    case 'onlineVideo':
      drawing = <><rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="m10 8 6 4-6 4V8Z"/></>; break
    case 'audio':
      drawing = <><path d="M3 9h4l5-4v14l-5-4H3V9ZM16 8c2 2 2 6 0 8M19 5c4 4 4 10 0 14"/></>; break
    case 'embed-pdf':
    case 'import-pdf':
      drawing = <><path d="M6 2.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V4A1.5 1.5 0 0 1 6.5 2.5Z"/><path d="M14 2.5V7h4"/><text x="7" y="17" fill="currentColor" stroke="none" fontSize="5.5" fontWeight="700">PDF</text></>; break
    case 'import-word':
      drawing = <><path d="M6 2.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V4A1.5 1.5 0 0 1 6.5 2.5Z"/><path d="M14 2.5V7h4"/><text x="7" y="17" fill="currentColor" stroke="none" fontSize="8" fontWeight="700">W</text></>; break
    case 'import-zip':
      drawing = <><path d="M6 2.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V4A1.5 1.5 0 0 1 6.5 2.5Z"/><path d="M14 2.5V7h4M10 7h2M10 10h2M10 13h2M10 16h2M9 19h4"/></>; break
    case 'code':
      drawing = <><path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 4l-4 16"/></>; break
    case 'file':
      drawing = <><path d="M8 12 15 5a4 4 0 0 1 5 6L10 21a6 6 0 0 1-8-8l10-10"/></>; break
    case 'bookmark':
    case 'web-bookmark':
      drawing = <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-5-7 5V4a1 1 0 0 1 1-1Z"/>; break
    case 'table-of-contents':
      drawing = <><path d="M8 5h13M8 12h13M8 19h13M3 5h2M3 12h2M3 19h2"/></>; break
    case 'equation':
    case 'block-equation':
      drawing = <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M16 7H8l5 5-5 5h8"/></>; break
    case 'button':
      drawing = <><rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="M7 12h10m-4-4 4 4-4 4"/></>; break
    case 'breadcrumb':
      drawing = <><path d="M6 2.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V4A1.5 1.5 0 0 1 6.5 2.5Z"/><path d="M14 2.5V7h4M8 12h7M8 16h7"/></>; break
    case 'tabs':
      drawing = <><rect x="2.5" y="3" width="19" height="18" rx="2"/><path d="M2.5 9h19M9 3v6"/></>; break
    case 'embed':
    case 'html':
    case 'html-suggested':
    case 'external-reference':
      drawing = <><path d="M8 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3M16 5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3M9 15l6-6M10 9h5v5"/></>; break
    case 'emoji':
      drawing = <><circle cx="12" cy="12" r="9"/><path d="M8 15c2.5 3 5.5 3 8 0M8.5 9h.01M15.5 9h.01"/></>; break
    case 'person':
    case 'mention-person':
      drawing = <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="9" r="3"/><path d="M6.5 18c1-2.5 3-3.5 5.5-3.5s4.5 1 5.5 3.5"/></>; break
    case 'date':
    case 'date-or-reminder':
    case 'date-reminder':
      drawing = <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l-4 3"/></>; break
    case 'mention-page':
      drawing = <><path d="M6 2.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V4A1.5 1.5 0 0 1 6.5 2.5Z"/><path d="M14 2.5V7h4M8 12h7M8 16h7"/></>; break
    case 'inline-equation':
      drawing = <><path d="m2 14 4 4 5-11M13 18l4-10M20 8l-3 10M15 13h7"/></>; break
    case 'ai-block':
    case 'ai-meeting-notes':
    case 'ai-meeting-notes-advanced':
    case 'ask-ai':
      drawing = <><path d="M5 3.5h10l3 3V12M15 3.5V7h3M5 3.5A1.5 1.5 0 0 0 3.5 5v14A1.5 1.5 0 0 0 5 20.5h7M7 11h7M7 15h5M17 14l.8 2.2L20 17l-2.2.8L17 20l-.8-2.2L14 17l2.2-.8L17 14Z"/></>; break
    case 'copy-link':
      drawing = <><path d="M9.5 14.5a4 4 0 0 0 6 .3l3.5-3.5a4 4 0 0 0-5.7-5.7l-2 2M14.5 9.5a4 4 0 0 0-6-.3L5 12.7a4 4 0 0 0 5.7 5.7l2-2"/></>; break
    case 'comment':
      drawing = <><path d="M4 3.5h16a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H9l-6.5 4V5A1.5 1.5 0 0 1 4 3.5Z"/><path d="M7 8h10M7 13h7"/></>; break
    case 'duplicate':
      drawing = <><rect x="7" y="7" width="14" height="14" rx="2"/><path d="M17 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/></>; break
    case 'move-to':
      drawing = <><path d="M3 12h17m-6-6 6 6-6 6"/></>; break
    case 'delete':
      drawing = <><path d="M4 6h16M9 6V4h6v2M6 6l1 15h10l1-15M10 10v7M14 10v7"/></>; break
    case 'mermaid':
    case 'code-mermaid':
      drawing = <><circle cx="4" cy="5" r="1.5"/><circle cx="20" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/><path d="M5.5 5h13M5 6.5 11 18M19 6.5 13 18"/></>; break
    case 'synced-block':
      drawing = <><path d="M3 6h12M3 12h9M3 18h11M16 7a5 5 0 0 1 5 5M21 12l-2-2M21 12l2-2M20 17a5 5 0 0 1-5 4M15 21l2-2M15 21l2 2"/></>; break
    case 'columns-2':
    case 'columns-3':
    case 'columns-4':
    case 'columns-5': {
      const count = Number(key.slice(-1))
      drawing = <><rect x="2.5" y="3.5" width="19" height="17" rx="2"/>{Array.from({ length: count - 1 }, (_, i) => <path key={i} d={`M${2.5 + 19 * (i + 1) / count} 3.5v17`}/>)}</>; break
    }
    default:
      fallback = !key.startsWith('embed-')
      drawing = key.startsWith('embed-')
        ? <><path d="M8 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3M16 5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3M9 15l6-6M10 9h5v5"/></>
        : <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8M12 8v8"/></>
  }
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-block-icon={key} data-block-icon-fallback={fallback || undefined} {...props}>{drawing}</svg>
}
