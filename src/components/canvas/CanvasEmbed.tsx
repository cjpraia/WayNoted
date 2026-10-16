// Prévia somente leitura de um quadro dentro de uma página (bloco de página com display "inline").
import { useEffect, useState } from 'react'
import { actions, api, useStore } from '../../store'
import { useI18n } from '../../i18n'
import { readCanvasDocument } from '../../canvas/model'
import { canvasSvg } from './canvasActions'
import { CanvasIcon } from './icons'
import './canvas.css'

export function CanvasEmbed({ pageId }: { pageId: string }) {
  const { t } = useI18n()
  const { pages, docRevision, settings } = useStore()
  const page = pages[pageId]
  const [svg, setSvg] = useState<string | null>(null)
  const dark = document.documentElement.dataset.theme === 'dark'
  useEffect(() => {
    let alive = true
    void api.loadDoc(pageId).then(blocks => {
      if (!alive) return
      const { data } = readCanvasDocument(blocks)
      setSvg(data.objects.length ? canvasSvg(data.objects, dark ? 'dark' : 'light').replace(/ width="\d+" height="\d+"/, ' preserveAspectRatio="xMidYMid meet"') : '')
    }).catch(() => { if (alive) setSvg('') })
    return () => { alive = false }
  }, [pageId, docRevision, dark, page?.updatedAt, settings.locale])
  const open = () => actions.openPage(pageId)
  return <div className="cv-embed" contentEditable={false} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); open() } }}>
    <div className="cv-embed-head"><CanvasIcon name="canvas" size={16} /><span>{page?.title || t('Lousa sem título', 'Untitled whiteboard')}</span>
      <button type="button" onClick={e => { e.stopPropagation(); actions.openPeek(pageId, 'side') }}>{t('Prévia', 'Peek')}</button>
      <button type="button" onClick={e => { e.stopPropagation(); open() }}>{t('Abrir lousa', 'Open whiteboard')}</button></div>
    {/* SVG gerado localmente por canvasToSvg: todo texto é escapado. */}
    <div className="cv-embed-body" role="link" tabIndex={0} aria-label={t('Abrir lousa', 'Open whiteboard')} onClick={open}
      {...(svg ? { dangerouslySetInnerHTML: { __html: svg } } : {})}>{svg ? undefined : svg === null ? t('Carregando…', 'Loading…') : t('Lousa vazia — clique para desenhar', 'Empty whiteboard — click to start')}</div>
  </div>
}
