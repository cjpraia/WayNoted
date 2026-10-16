// Ícones de linha próprios do quadro (24×24, traço 1.6, `currentColor`), no padrão do BlockIcon.
import type { ReactNode, SVGProps } from 'react'

export type CanvasIconName = 'canvas' | 'select' | 'lasso' | 'layers' | 'eye' | 'eyeOff' | 'chevron' | 'hand' | 'note' | 'text' | 'rect' | 'ellipse' | 'diamond' | 'line' | 'arrow' | 'pen' | 'eraser' | 'section' | 'image' | 'page' | 'database'
  | 'zoomIn' | 'zoomOut' | 'fit' | 'grid' | 'snap' | 'minimap' | 'export' | 'find' | 'lock' | 'unlock' | 'group' | 'ungroup' | 'front' | 'back' | 'forward' | 'backward'
  | 'alignLeft' | 'alignHCenter' | 'alignRight' | 'alignTop' | 'alignVCenter' | 'alignBottom' | 'distributeH' | 'distributeV' | 'duplicate' | 'trash' | 'open' | 'peek'
  | 'curve' | 'straight' | 'orthogonal' | 'dashed' | 'dotted' | 'templates' | 'library' | 'sketch' | 'arrowStart' | 'arrowEnd' | 'undo' | 'redo' | 'more' | 'file'

const PATHS: Record<CanvasIconName, ReactNode> = {
  canvas: <><rect x="3" y="3" width="18" height="18" rx="3" /><rect x="6.5" y="7" width="5" height="4" rx="1" /><rect x="13" y="13" width="5" height="4" rx="1" /><path d="M11.5 9h2.5a1.5 1.5 0 0 1 1.5 1.5V13" /></>,
  select: <path d="M5 3.5 18.5 10l-5.8 1.7L10 17.5 5 3.5Z" />,
  lasso: <><path d="M12 4.5c4.7 0 8 1.8 8 4.2s-3.3 4.2-8 4.2-8-1.8-8-4.2 3.3-4.2 8-4.2Z" strokeDasharray="2.6 2" /><path d="M9 12.6c-.6 1.8-.3 3.3 1 4.3 1.2.9 1 2.1.2 2.6" /></>,
  layers: <><path d="m12 4 8.5 4.5L12 13 3.5 8.5 12 4Z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5" /><path d="m3.5 16 8.5 4.5L20.5 16" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  eyeOff: <><path d="M4 4l16 16" /><path d="M9.6 6a9 9 0 0 1 2.4-.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.8 3.6M6.3 7.6A15 15 0 0 0 2.5 12S6 18.5 12 18.5a8.7 8.7 0 0 0 3.6-.8" /><path d="M10 10a2.8 2.8 0 0 0 4 4" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  hand: <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5V5a1.5 1.5 0 0 1 3 0v6m0-4.5a1.5 1.5 0 0 1 3 0V13a7 7 0 0 1-7 7h-.6a6 6 0 0 1-4.6-2.2L3.6 15a1.5 1.5 0 0 1 2.3-1.9L8 15" />,
  note: <><path d="M4.5 4.5h15v10l-5 5h-10Z" /><path d="M19.5 14.5h-5v5" /></>,
  text: <path d="M5 6.5V5h14v1.5M12 5v14m-3 0h6" />,
  rect: <rect x="4" y="6" width="16" height="12" rx="2" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />,
  diamond: <path d="M12 3.5 20.5 12 12 20.5 3.5 12Z" />,
  line: <path d="M5 19 19 5" />,
  arrow: <><path d="M5 19 18 6" /><path d="M10 5.5h8.5V14" /></>,
  pen: <><path d="M14.5 5.5 18.5 9.5 9 19H5v-4Z" /><path d="m12.5 7.5 4 4" /></>,
  eraser: <><path d="m9 20-5-5a1.5 1.5 0 0 1 0-2.1L13 4a1.5 1.5 0 0 1 2.1 0l5 5a1.5 1.5 0 0 1 0 2.1L11.2 20Z" /><path d="M20 20H9m-1.5-11 7.5 7.5" /></>,
  section: <><rect x="3.5" y="5.5" width="17" height="14" rx="2" strokeDasharray="3 2.2" /><path d="M6 3.5h6" /></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m20.5 16-5-5L6 19.5" /></>,
  page: <><path d="M6.5 2.5h8l4 4v13a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19.5V4a1.5 1.5 0 0 1 1.5-1.5Z" /><path d="M14 2.5V7h4.5M8.5 12h7M8.5 16h5" /></>,
  database: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9.5h18M3 14.5h18M9.5 9.5V20" /></>,
  file: <><path d="M14.5 4.5 7.8 11.2a3 3 0 0 0 4.3 4.3l6.6-6.7a5 5 0 0 0-7.1-7.1L5 8.3a7 7 0 0 0 9.9 9.9l3.6-3.6" /></>,
  zoomIn: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4M8 11h6M11 8v6" /></>,
  zoomOut: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4M8 11h6" /></>,
  fit: <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9m6 0h3.5A1.5 1.5 0 0 1 20 5.5V9m0 6v3.5a1.5 1.5 0 0 1-1.5 1.5H15m-6 0H5.5A1.5 1.5 0 0 1 4 18.5V15" />,
  grid: <path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16" />,
  snap: <><path d="M5 19V5M5 19h14" /><rect x="9" y="6" width="9" height="9" rx="1.5" /><path d="M9 15H5" strokeDasharray="1.5 1.5" /></>,
  minimap: <><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="12" y="11" width="6" height="5" rx="1" /></>,
  export: <><path d="M12 15V3.5m-4 4 4-4 4 4" /><path d="M5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6" /></>,
  find: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  unlock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 7.7-1.5" /></>,
  group: <><rect x="3.5" y="3.5" width="17" height="17" rx="2" strokeDasharray="3 2.2" /><rect x="7" y="7" width="5" height="5" rx="1" /><rect x="12" y="12" width="5" height="5" rx="1" /></>,
  ungroup: <><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /><path d="M14 4h6v6M4 14v6h6" strokeDasharray="2 2" /></>,
  front: <><rect x="8" y="8" width="11" height="11" rx="1.5" fill="currentColor" fillOpacity=".18" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></>,
  back: <><rect x="5" y="5" width="11" height="11" rx="1.5" /><path d="M19 9v9a1 1 0 0 1-1 1H9" /></>,
  forward: <><path d="M12 19V7m-4.5 4.5L12 7l4.5 4.5" /><path d="M5 4h14" /></>,
  backward: <><path d="M12 5v12m-4.5-4.5L12 17l4.5-4.5" /><path d="M5 20h14" /></>,
  alignLeft: <path d="M4.5 3.5v17M8 7h11v4H8zM8 14h7v4H8z" />,
  alignHCenter: <path d="M12 3.5v17M6 7h12v4H6zM8.5 14h7v4h-7z" />,
  alignRight: <path d="M19.5 3.5v17M5 7h11v4H5zM9 14h7v4H9z" />,
  alignTop: <path d="M3.5 4.5h17M7 8v11h4V8zM14 8v7h4V8z" />,
  alignVCenter: <path d="M3.5 12h17M7 6v12h4V6zM14 8.5v7h4v-7z" />,
  alignBottom: <path d="M3.5 19.5h17M7 5v11h4V5zM14 9v7h4V9z" />,
  distributeH: <path d="M4 4v16M20 4v16M9.5 8h5v8h-5z" />,
  distributeV: <path d="M4 4h16M4 20h16M8 9.5h8v5H8z" />,
  duplicate: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>,
  trash: <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l.8 12.2a1.5 1.5 0 0 0 1.5 1.3h6.4a1.5 1.5 0 0 0 1.5-1.3l.8-12.2M10 10.5v6M14 10.5v6" />,
  open: <path d="M13.5 4.5H19.5V10.5M19.5 4.5 11 13M10 5.5H6A1.5 1.5 0 0 0 4.5 7v11A1.5 1.5 0 0 0 6 19.5h11a1.5 1.5 0 0 0 1.5-1.5v-4" />,
  peek: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M13.5 4.5v15" /></>,
  curve: <path d="M5 19c0-8 14-6 14-14" />,
  straight: <path d="M5 19 19 5" />,
  orthogonal: <path d="M5 19v-7h14V5" />,
  dashed: <path d="M4 12h3.5m3 0h3m3 0H20" />,
  dotted: <path d="M4.5 12h.01M8.5 12h.01M12.5 12h.01M16.5 12h.01M20 12h.01" strokeWidth={2.4} />,
  templates: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><path d="M17 13.5v7M13.5 17h7" /></>,
  library: <><path d="M5 4.5v15M9 4.5v15" /><path d="m13 5 3.8-1 4 14.5-3.8 1Z" /></>,
  sketch: <path d="M4 17c2-1 2.6-4 4.4-4.2 1.9-.2 1.3 3.6 3.3 3.6s2.2-6.4 4.3-6.6c1.5-.1 1.4 2.2 4 1.7" />,
  arrowStart: <><path d="M5 12h14" /><path d="m9 8-4 4 4 4" /></>,
  arrowEnd: <><path d="M5 12h14" /><path d="m15 8 4 4-4 4" /></>,
  undo: <><path d="M9 14 4.5 9.5 9 5" /><path d="M4.5 9.5h10a5 5 0 0 1 0 10H11" /></>,
  redo: <><path d="m15 14 4.5-4.5L15 5" /><path d="M19.5 9.5h-10a5 5 0 0 0 0 10H13" /></>,
  more: <><circle cx="6" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="18" cy="12" r="1" fill="currentColor" /></>,
}

export function CanvasIcon({ name, size = 18, ...props }: SVGProps<SVGSVGElement> & { name: CanvasIconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" {...props}>{PATHS[name]}</svg>
}

/** `Icon size` adapter for command lists that take a component (⌘K). */
export function CanvasGlyph({ size = 18 }: { size?: number }) { return <CanvasIcon name="canvas" size={size} /> }
