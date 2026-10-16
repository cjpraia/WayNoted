// Peças comuns às visualizações: ícone da linha, título inline, menu de contexto da linha,
// criação de linhas e utilitários de reordenação.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { ArrowUpRight, Copy, Pencil, Trash2 } from 'lucide-react'
import { actions, getState, selectors } from '../../../../store'
import type { DatabaseSchema, Page, Property, PropValue, View } from '../../../../types'
import { defaultsForNewRow, getValue, isEmptyValue } from '../../lib'
import { PropDisplay } from '../../PropDisplay'
import { PropertyEditor, type EditorCloseReason } from '../../editors/PropertyEditor'
import { isComputedProperty } from '../../derived'
import { MenuItem, MenuSeparator, Popover } from './Popover'
import { PageIcon } from '../../../page/PageIcon'
import { t } from '../../../../i18n'
import './shared.css'

// ---------- Ícone e título ----------

export function RowIcon({ page, size = 16 }: { page: Page; size?: number }) {
  if (page.icon) {
    return (
      <PageIcon value={page.icon} className="vw-row-icon vw-row-emoji" style={{ fontSize: size - 1, width: size + 2, height: size + 2 }} />
    )
  }
  return (
    <PageIcon value={null} fallback={page.database ? 'database' : 'page'} className="vw-row-icon" style={{ width: size + 2, height: size + 2 }} />
  )
}

export function RowTitle({ page }: { page: Page }) {
  return page.title ? <span className="vw-title">{page.title}</span> : <span className="vw-title vw-untitled">{t('Sem título', 'Untitled')}</span>
}

/** ✎ ao lado do título (aparece com o ponteiro ou o foco no cartão): renomeia ali mesmo, sem abrir a página. */
export function RenameButton({ page, readOnly, onRename }: { page: Page; readOnly: boolean; onRename: (id: string) => void }) {
  if (readOnly || page.locked) return null
  return (
    <button
      type="button"
      className="vw-rename"
      tabIndex={-1}
      aria-label={t('Renomear', 'Rename')}
      title={t('Renomear (F2)', 'Rename (F2)')}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onRename(page.id) }}
    >
      <Pencil size={12} />
    </button>
  )
}

// ---------- Edição rápida de propriedades no cartão (duplo clique) ----------

const OPEN_DELAY_MS = 220

/**
 * Duplo clique no valor de uma propriedade do cartão abre o editor inline (texto, número, seleção, data…).
 * O clique simples continua abrindo a página, com um pequeno atraso só nos valores editáveis para que o
 * duplo clique possa cancelá-lo. O editor é um nó irmão (fora do cartão), então seus cliques não abrem a página.
 */
export function useCardPropEditor(dbId: string, readOnly: boolean, onOpenRow: (id: string) => void) {
  const [edit, setEdit] = useState<{ rowId: string; propId: string; anchor: Element } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const editable = (row: Page, prop: Property) => !readOnly && !row.locked && !isComputedProperty(prop) && prop.type !== 'checkbox' && prop.type !== 'title'

  const propHandlers = (row: Page, prop: Property) => editable(row, prop) ? {
    'data-prop-id': prop.id,
    onClick: (e: ReactMouseEvent) => {
      if ((e.target as HTMLElement).closest('a, button, input')) return
      e.stopPropagation()
      clearTimeout(timer.current)
      timer.current = setTimeout(() => onOpenRow(row.id), OPEN_DELAY_MS)
    },
    onDoubleClick: (e: ReactMouseEvent) => {
      e.stopPropagation()
      clearTimeout(timer.current)
      setEdit({ rowId: row.id, propId: prop.id, anchor: e.currentTarget })
    },
  } : { 'data-prop-id': prop.id }

  const row = edit ? getState().pages[edit.rowId] : undefined
  const prop = edit ? selectors.database(dbId)?.properties.find((p) => p.id === edit.propId) : undefined
  const close = (reason: EditorCloseReason) => {
    const id = edit?.rowId
    setEdit(null)
    if (id && (reason === 'enter' || reason === 'escape')) setTimeout(() => document.querySelector<HTMLElement>(`[data-row-id="${id.replace(/["\\]/g, '\\$&')}"]`)?.focus({ preventScroll: true }), 0)
  }
  const node = edit && row && prop ? (
    <PropertyEditor
      key={`${edit.rowId}:${edit.propId}`}
      dbId={dbId}
      rowId={row.id}
      property={prop}
      value={getValue(row, prop)}
      anchor={edit.anchor}
      onChange={(v) => actions.setProp(row.id, prop.id, v)}
      onClose={close}
    />
  ) : null
  return { propHandlers, editorNode: node }
}

/** Campo para digitar o título de uma linha recém-criada. Grava ao sair (Enter, Esc ou blur). */
export function InlineTitleInput({ page, onDone, className = '' }: { page: Page; onDone: () => void; className?: string }) {
  const [value, setValue] = useState(page.title)
  const done = useRef(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [])

  const commit = () => {
    if (done.current) return
    done.current = true
    if (value !== page.title) actions.updatePage(page.id, { title: value.trim() })
    onDone()
  }
  // Enter/Esc devolvem o foco ao cartão (as setas continuam de onde estavam); sair por clique não rouba o foco.
  const commitAndReturn = () => {
    const card = ref.current?.closest<HTMLElement>('[data-row-id]')
    commit()
    if (card) setTimeout(() => card.isConnected && card.focus({ preventScroll: true }), 0)
  }

  return (
    <input
      ref={ref}
      className={`vw-inline-input ${className}`}
      value={value}
      placeholder={t('Digite um nome…', 'Enter a name…')}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          commitAndReturn()
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    />
  )
}

// ---------- Valores das propriedades ----------

/** Propriedades visíveis com valor não vazio numa linha (sem título e sem as excluídas). */
export function shownProps(row: Page, visibleProps: Property[], exclude: string[] = []): { prop: Property; value: PropValue }[] {
  const out: { prop: Property; value: PropValue }[] = []
  for (const prop of visibleProps) {
    if (prop.type === 'title' || exclude.includes(prop.id)) continue
    const value = getValue(row, prop)
    if ((isEmptyValue(value) && prop.type !== 'button') || (prop.type === 'checkbox' && value !== true)) continue
    out.push({ prop, value })
  }
  return out
}

export function PropValueView({ prop, value, rowId }: { prop: Property; value: PropValue; rowId?: string }) {
  if (prop.type === 'checkbox') {
    return (
      <span className="vw-check">
        <PropDisplay property={prop} value={value} rowId={rowId} />
        <span className="vw-check-label">{prop.name}</span>
      </span>
    )
  }
  return <PropDisplay property={prop} value={value} rowId={rowId} />
}

// ---------- Menu de contexto da linha ----------

export function useRowMenu(readOnly: boolean, onOpenRow: (id: string) => void, extraItems?: (rowId: string, close: () => void) => ReactNode) {
  const [menu, setMenu] = useState<{ rowId: string; at: { x: number; y: number } } | null>(null)

  const openMenu = useCallback((e: ReactMouseEvent, rowId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ rowId, at: { x: e.clientX, y: e.clientY } })
  }, [])

  const close = useCallback(() => setMenu(null), [])

  const node = menu ? (
    <Popover anchor={menu.at} onClose={close} width={220}>
      <MenuItem
        icon={<ArrowUpRight size={16} />}
        label={t('Abrir', 'Open')}
        onClick={() => {
          close()
          onOpenRow(menu.rowId)
        }}
      />
      {!readOnly && (
        <>
          <MenuItem
            icon={<Copy size={16} />}
            label={t('Duplicar', 'Duplicate')}
            onClick={() => {
              close()
              void actions.duplicatePage(menu.rowId)
            }}
          />
          {extraItems?.(menu.rowId, close)}
          <MenuSeparator />
          <MenuItem
            icon={<Trash2 size={16} />}
            label={t('Excluir', 'Delete')}
            danger
            onClick={() => {
              close()
              actions.trashPage(menu.rowId)
            }}
          />
        </>
      )}
    </Popover>
  ) : null

  return { openMenu, menuNode: node, menuRowId: menu?.rowId ?? null }
}

// ---------- Criação de linhas ----------

export function useRowCreation(db: Page, schema: DatabaseSchema, view: View, creationDefaults?: Record<string, PropValue>) {
  const [editingId, setEditingId] = useState<string | null>(null)

  const create = useCallback(
    (props: Record<string, PropValue> = {}, index?: number) => {
      const id = actions.createRow(db.id, defaultsForNewRow(schema, view, props, creationDefaults))
      if (index !== undefined) actions.movePage(id, selectors.page(id)?.parentId ?? db.id, index)
      setEditingId(id)
      return id
    },
    [db.id, schema, view, creationDefaults],
  )

  const stopEditing = useCallback(() => setEditingId(null), [])
  /** Renomear o título de uma linha existente no próprio cartão (✎ ou F2). */
  const rename = useCallback((id: string) => setEditingId(id), [])
  return { editingId, create, stopEditing, rename }
}

/**
 * Índice (entre todas as linhas do banco, sem `rowId`) para inserir `rowId` antes de `beforeId`,
 * ou logo depois de `afterId` quando `beforeId` é null. Sem nenhum dos dois, devolve undefined (fim).
 */
export function insertionIndex(dbId: string, rowId: string, beforeId: string | null, afterId: string | null): number | undefined {
  const siblings = selectors.rows(dbId).filter((p) => p.id !== rowId)
  if (beforeId) {
    const i = siblings.findIndex((p) => p.id === beforeId)
    if (i >= 0) return i
  }
  if (afterId) {
    const i = siblings.findIndex((p) => p.id === afterId)
    if (i >= 0) return i + 1
  }
  return undefined
}

/** Índice de inserção vertical: compara o ponteiro com o meio de cada item (exceto o arrastado). */
export function indexFromY(items: HTMLElement[], y: number): number {
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect()
    if (y < r.top + r.height / 2) return i
  }
  return items.length
}

// ---------- Capas ----------

export function isImageCover(cover: string): boolean {
  return /^(data:|https?:|blob:|file:)/i.test(cover)
}

export function coverCss(cover: string, position = 50): CSSProperties {
  if (isImageCover(cover)) {
    return {
      backgroundImage: `url("${cover.replace(/"/g, '%22')}")`,
      backgroundSize: 'cover',
      backgroundPosition: `center ${position}%`,
      backgroundRepeat: 'no-repeat',
    }
  }
  return { background: cover }
}
