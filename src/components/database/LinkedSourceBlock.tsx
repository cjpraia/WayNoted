// Bloco "Visualização vinculada" ainda sem fonte (docs/USAGE.md): chip da visão,
// ilustração, título e "Vincular uma fonte de dados", que abre o seletor ancorado ao botão.
// Vincular troca as props do bloco (pageId da nova visualização) — o ⌘Z do editor desfaz.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { actions, getState, useStore } from '../../store'
import { t } from '../../i18n'
import { EmptyState } from '../ui/illustrations/Illustration'
import { Button } from '../ui/Button'
import { ViewTypeIcon } from './icons'
import { LinkSourcePicker } from './LinkSourcePicker'
import { consumeLinkPickerAutoOpen, freshLinkedView, linkedSchema } from './linkedSource'

export type LinkBlockEditor = { isEditable: boolean; updateBlock: (id: string, update: { props: Record<string, string> }) => unknown }

export function LinkedSourceBlock({ blockId, editor }: { blockId: string; editor: LinkBlockEditor }) {
  useStore()
  const rootRef = useRef<HTMLDivElement>(null)
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  const [ownerId, setOwnerId] = useState<string | undefined>()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  useLayoutEffect(() => { setOwnerId(rootRef.current?.closest<HTMLElement>('.pg-root[data-page-id]')?.dataset.pageId) })
  useEffect(() => { if (consumeLinkPickerAutoOpen(blockId)) setOpen(true) }, [blockId])
  const editable = editor.isEditable && !!ownerId && !getState().pages[ownerId]?.locked

  const link = (sourceId: string) => {
    if (!ownerId) return
    try {
      const view = freshLinkedView(t('Tabela', 'Table'))
      const childId = actions.createPage(ownerId, { blockOwnerId: ownerId, database: linkedSchema(sourceId, view) })
      setOpen(false)
      editor.updateBlock(blockId, { props: { pageId: childId, ownership: 'owned', display: 'inline' } })
      void actions.flushMeta().catch(actions.reportSaveError)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const createNew = () => {
    if (!ownerId) return
    try { link(actions.createDatabase(ownerId, 'table', { title: t('Nova fonte de dados', 'New data source') })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  return (
    <div className="lsb" contentEditable={false} ref={rootRef} data-linked-pending="">
      <div className="lsb-chip"><ViewTypeIcon type="table" size={14} /><span>{t('Tabela', 'Table')}</span></div>
      <EmptyState className="lsb-empty" illustration="link-source" size={72} title={t('Visualização vinculada', 'Linked view')}
        action={editable ? <Button ref={setAnchorEl} variant="primary" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{t('Vincular uma fonte de dados', 'Link a data source')}</Button> : undefined}>
        {t('Mostre aqui um banco que já existe. As linhas e propriedades continuam na fonte.', 'Show an existing database here. Rows and properties stay in the source.')}
      </EmptyState>
      {error && <p className="lsb-error" role="alert">{error}</p>}
      {open && editable && anchorEl && (
        <LinkSourcePicker anchor={pickerAnchor(rootRef.current, anchorEl)} ignore={anchorEl} placement={pickerPlacement(rootRef.current)} title={t('Vincular fonte de dados', 'Link a data source')} onPick={link} onCreateNew={createNew} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}

/** Lei de Jakob (como no Export Bundle): o seletor abre à direita do bloco; sem espaço (≤ 720 px), logo abaixo do botão. */
const PICKER_ROOM = 396
function pickerPlacement(block: HTMLElement | null): 'right-start' | 'bottom-start' {
  if (!block || typeof window === 'undefined') return 'bottom-start'
  return window.innerWidth - block.getBoundingClientRect().right >= PICKER_ROOM ? 'right-start' : 'bottom-start'
}
function pickerAnchor(block: HTMLElement | null, button: HTMLElement): HTMLElement {
  return block && pickerPlacement(block) === 'right-start' ? block : button
}
