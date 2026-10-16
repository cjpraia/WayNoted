import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { PasteChoice } from './pasteUrl'

interface Props {
  url: string
  left: number
  top: number
  videoEnabled: boolean
  /** Opções pertinentes ao host (pasteChoicesFor); sem ela vale o menu clássico por `videoEnabled`. */
  choices?: PasteChoice[]
  isCurrent: () => boolean
  onChoose: (choice: PasteChoice) => boolean
  onDismiss: (reason: 'escape' | 'blur' | 'stale') => void
  onResume: () => void
  t: (pt: string, en: string) => string
}


/** Links de vídeo e links comuns têm menus diferentes, como no app de referência. */
const choicesFor = (video: boolean): PasteChoice[] => video
  ? ['mention', 'video', 'bookmark', 'url']
  : ['mention', 'url', 'bookmark', 'embed']

export function PasteUrlMenu({ url, left, top, videoEnabled, choices: given, isCurrent, onChoose, onDismiss, onResume, t }: Props) {
  const [selected, setSelected] = useState(0)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const choices = given ?? choicesFor(videoEnabled)

  useEffect(() => {
    setSelected(0)
    menu.current?.focus()
  }, [url])

  const choose = (index: number) => {
    if (!isCurrent()) { onDismiss('stale'); return }
    if (onChoose(choices[index])) onResume()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return
    // A changed document makes the captured paste stale. Leave focus/keyboard
    // handling to the editor or any dialog that has since gained focus.
    if (!isCurrent()) { onDismiss('stale'); return }
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') { onDismiss('escape'); onResume(); return }
    if (event.key === 'Enter') { choose(selected); return }
    const step = event.key === 'ArrowDown' ? 1 : -1
    setSelected((selected + step + choices.length) % choices.length)
  }

  return <div ref={menu} tabIndex={-1} className="pg-paste-url-menu" role="menu"
    aria-label={t('Colar link como', 'Paste link as')} aria-activedescendant={`${id}-${choices[selected]}`}
    style={{ position: 'fixed', left, top }} onKeyDown={onKeyDown}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onDismiss('blur') }}>
    <strong>{t('Colar como', 'Paste as')}</strong>
    {choices.map((choice, index) => <button key={choice} id={`${id}-${choice}`} type="button" role="menuitem"
      data-selected={index === selected || undefined}
      onMouseEnter={() => setSelected(index)} onClick={() => choose(index)}>
      {choice === 'mention' ? t('Menção', 'Mention') : choice === 'video' ? t('Incorporar vídeo', 'Embed video') : choice === 'bookmark' ? t('Marcador', 'Bookmark') : choice === 'embed' ? t('Incorporar', 'Embed') : 'URL'}
    </button>)}
  </div>
}
