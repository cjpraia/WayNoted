// Peças da visualização vinculada dentro do DatabaseView (docs/USAGE.md):
// título da fonte com ↗, indicador "Vinculado a <fonte>" com menu (abrir, trocar, desvincular),
// estado de fonte indisponível e o painel "Nova visualização / Visualizações em <fonte>".
import { useEffect, useRef, useState } from 'react'
import { actions, getState, selectors, useStore } from '../../store'
import type { View, ViewType } from '../../types'
import { t } from '../../i18n'
import { DbPopover, Menu, MenuItem, MenuLabel, MenuSep, type DbAnchor } from './ui/Popover'
import { PanelHeader } from '../ui/PanelHeader'
import { Icon } from '../ui/icons'
import { PageIcon } from '../page/PageIcon'
import { EmptyState } from '../ui/illustrations/Illustration'
import { Button } from '../ui/Button'
import { ViewTypeIcon } from './icons'
import { LinkSourcePicker } from './LinkSourcePicker'
import { linkedTipSeen, markLinkedTipSeen, resolveLinkedRoot } from './linkedSource'

/** Fonte viva de uma visualização vinculada (ou undefined se foi para a lixeira/excluída). */
export function linkedSourceOf(dbId: string): { id: string; title: string; icon: string | null; live: boolean } | undefined {
  const pages = getState().pages
  const own = pages[dbId]?.database?.linkedSourceId
  if (!own) return undefined
  const id = resolveLinkedRoot(pages, dbId)
  const page = pages[id]
  return { id, title: page?.title || t('Sem título', 'Untitled'), icon: page?.icon ?? null, live: !!page?.database && selectors.isLive(id) }
}

/** Título de uma visualização vinculada embutida: ↗ + nome (desta visão ou da fonte); clicar abre a fonte. */
export function LinkedTitle({ dbId, readOnly }: { dbId: string; readOnly: boolean }) {
  useStore()
  const db = selectors.page(dbId)
  const source = linkedSourceOf(dbId)
  if (!db || !source) return null
  const name = db.title || source.title
  return (
    <div className="lvc-title-row">
      <button type="button" className="dbv-embedded-title lvc-title" disabled={!source.live} title={t('Abrir {name}', 'Open {name}', { name: source.title })}
        aria-label={t('Abrir a fonte {name}', 'Open source {name}', { name: source.title })} onClick={() => actions.openPage(source.id)}>
        <Icon name="arrow-up-right" size={18} className="lvc-arrow" />
        {source.icon && <PageIcon value={source.icon} />}
        <span>{name}</span>
      </button>
      <LinkedBadge dbId={dbId} readOnly={readOnly} compact={name === source.title} />
    </div>
  )
}

/** Indicador discreto "Vinculado a <fonte>" com o menu Abrir fonte · Trocar fonte · Desvincular. */
/** `compact`: o título ao lado já mostra o nome da fonte; o indicador diz só "Vinculado" (sem repetir). */
export function LinkedBadge({ dbId, readOnly, compact }: { dbId: string; readOnly: boolean; compact?: boolean }) {
  useStore()
  const [menuEl, setMenuEl] = useState<HTMLButtonElement | null>(null)
  const [pickerEl, setPickerEl] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  const badgeRef = useRef<HTMLButtonElement>(null)
  const source = linkedSourceOf(dbId)
  if (!source) return null
  const closeMenu = () => { setMenuEl(null); badgeRef.current?.focus() }
  return (
    <>
      <button ref={badgeRef} type="button" aria-label={source.live ? t('Vinculado a {name}: opções da fonte', 'Linked to {name}: source options', { name: source.title }) : t('Fonte indisponível: opções', 'Source unavailable: options')} className={`lvc-badge${source.live ? '' : ' lvc-badge--missing'}`} aria-haspopup="menu" aria-expanded={!!menuEl}
        title={source.live ? t('Vinculado a {name}', 'Linked to {name}', { name: source.title }) : t('Fonte indisponível', 'Source unavailable')}
        onClick={(event) => setMenuEl(menuEl ? null : event.currentTarget)}>
        <Icon name="link-view" size={14} />
        <span>{!source.live ? t('Fonte indisponível', 'Source unavailable') : compact ? t('Vinculado', 'Linked') : t('Vinculado a {name}', 'Linked to {name}', { name: source.title })}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {menuEl && (
        <DbPopover anchor={menuEl} ignore={menuEl} placement="bottom-start" onClose={closeMenu} label={t('Fonte vinculada', 'Linked source')}>
          <AutoFocusMenu width={300}>
            <MenuItem icon={<Icon name="arrow-up-right" size={16} />} label={t('Abrir fonte', 'Open source')} disabled={!source.live} onClick={() => { setMenuEl(null); actions.openPage(source.id) }} />
            <MenuItem icon={<Icon name="data-source" size={16} />} label={t('Trocar fonte…', 'Change source…')} disabled={readOnly} onClick={() => { setMenuEl(null); setPickerEl(badgeRef.current) }} />
            <MenuSep />
            <MenuItem icon={<Icon name="copy" size={16} />} label={busy ? t('Convertendo…', 'Converting…') : t('Converter em banco independente', 'Convert to independent database')} disabled={readOnly || busy || !source.live}
              onClick={() => {
                setMenuEl(null); setBusy(true)
                void actions.convertLinkedToIndependent(dbId).catch(actions.reportSaveError).finally(() => setBusy(false))
              }} />
            <div className="lvc-menu-note">{t('Copia as linhas de “{name}” para cá; a fonte não muda. ⌘Z desfaz.', 'Copies the rows of “{name}” here; the source is unchanged. ⌘Z undoes.', { name: source.title })}</div>
          </AutoFocusMenu>
        </DbPopover>
      )}
      {pickerEl && (
        <LinkSourcePicker anchor={pickerEl} placement="bottom-start" title={t('Trocar fonte de dados', 'Change data source')} exclude={[dbId]} currentId={source.id}
          onPick={(id) => { setPickerEl(null); actions.relinkDatabase(dbId, id) }} onClose={() => setPickerEl(null)} />
      )}
    </>
  )
}

/** Menu que já nasce com o foco no primeiro item (↑/↓ pelo `menuKeyNav` do Menu). */
function AutoFocusMenu({ children, width }: { children: React.ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.querySelector<HTMLElement>('.dbv-menu-item:not(:disabled)')?.focus() }, [])
  return <div ref={ref}><Menu width={width}>{children}</Menu></div>
}

/** Fonte na lixeira ou excluída: explica e oferece trocar (nada é apagado). */
export function MissingSource({ dbId, readOnly }: { dbId: string; readOnly: boolean }) {
  const [el, setEl] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  return <>
    <EmptyState className="dbv-empty-hint" illustration="link-source" size={72} title={t('Fonte indisponível', 'Source unavailable')}
      action={readOnly ? undefined : <Button ref={setEl} variant="primary" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{t('Trocar fonte de dados', 'Change data source')}</Button>}>
      {t('O banco de origem desta visualização está na lixeira ou foi excluído. Restaure-o ou escolha outra fonte.', 'The source database of this view is in the trash or was deleted. Restore it or choose another source.')}
    </EmptyState>
    {open && el && <LinkSourcePicker anchor={el} placement="bottom-start" title={t('Trocar fonte de dados', 'Change data source')} exclude={[dbId]}
      onPick={(id) => { setOpen(false); actions.relinkDatabase(dbId, id) }} onClose={() => setOpen(false)} />}
  </>
}

export const VIEW_TYPE_LABELS: { type: ViewType; pt: string; en: string }[] = [
  { type: 'table', pt: 'Tabela', en: 'Table' },
  { type: 'board', pt: 'Quadro', en: 'Board' },
  { type: 'list', pt: 'Lista', en: 'List' },
  { type: 'gallery', pt: 'Galeria', en: 'Gallery' },
  { type: 'calendar', pt: 'Calendário', en: 'Calendar' },
  { type: 'timeline', pt: 'Linha do tempo', en: 'Timeline' },
  { type: 'chart', pt: 'Gráfico', en: 'Chart' },
  { type: 'dashboard', pt: 'Painel', en: 'Dashboard' },
  { type: 'map', pt: 'Mapa', en: 'Map' },
  { type: 'feed', pt: 'Feed', en: 'Feed' },
  { type: 'form', pt: 'Formulário', en: 'Form' },
]
/** Hick: 4 layouts na primeira tela; os outros em "Mais layouts ›". */
const COMMON_TYPES = 4

/**
 * Painel "Nova visualização" (+ das abas). Numa visualização vinculada, inclui "Visualizações em <fonte>"
 * para mostrar aqui uma visão que já existe na fonte (sem duplicar: se já está aqui, só ativa).
 */
export function AddViewPanel({ dbId, anchor, views, onClose }: { dbId: string; anchor: DbAnchor; views: View[]; onClose: () => void }) {
  useStore()
  const [screen, setScreen] = useState<'main' | 'more'>('main')
  const [tip, setTip] = useState(() => !linkedTipSeen())
  const source = linkedSourceOf(dbId)
  const sourceViews = source?.live ? selectors.page(source.id)?.database?.views ?? [] : []
  const adopted = new Set(views.map((view) => view.sourceViewId).filter(Boolean))
  const add = (type: ViewType) => { actions.addView(dbId, type); onClose() }
  const typeItems = (list: typeof VIEW_TYPE_LABELS) => list.map((item) => (
    <MenuItem key={item.type} icon={<ViewTypeIcon type={item.type} size={16} />} label={t('Visualização de {name}', '{name} view', { name: t(item.pt.toLocaleLowerCase('pt-BR'), item.en) })} onClick={() => add(item.type)} />
  ))
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.querySelector<HTMLElement>('.dbv-menu-item')?.focus() }, [screen])
  return (
    <DbPopover anchor={anchor} onClose={onClose} onEscape={screen === 'more' ? () => setScreen('main') : undefined} label={t('Nova visualização', 'New view')} className="lvc-addview">
      <div ref={ref}>
        <PanelHeader title={screen === 'more' ? t('Mais layouts', 'More layouts') : t('Nova visualização', 'New view')} onBack={screen === 'more' ? () => setScreen('main') : undefined} onClose={onClose} />
        {screen === 'main' && source && tip && (
          <div className="lvc-tip" role="note">
            <span>{t('As propriedades são compartilhadas com “{name}”; filtros, ordem, colunas visíveis e layout são só desta visualização.', 'Properties are shared with “{name}”; filters, sort, visible columns and layout belong to this view only.', { name: source.title })}</span>
            <Button variant="ghost" onClick={() => { markLinkedTipSeen(); setTip(false) }}>{t('Entendi', 'Got it')}</Button>
          </div>
        )}
        <Menu width={300}>
          {screen === 'main' ? <>
            {typeItems(VIEW_TYPE_LABELS.slice(0, COMMON_TYPES))}
            <MenuItem icon={<Icon name="chevron-right" size={16} />} label={t('Mais layouts', 'More layouts')} hint={String(VIEW_TYPE_LABELS.length - COMMON_TYPES)} onClick={() => setScreen('more')} />
            {source && sourceViews.length > 0 && <>
              <MenuSep />
              <MenuLabel>{t('Visualizações em {name}', 'Views on {name}', { name: source.title })}</MenuLabel>
              {sourceViews.slice(0, 7).map((view) => (
                <MenuItem key={view.id} icon={<ViewTypeIcon type={view.type} size={16} />} label={view.name || t('Sem nome', 'Untitled')} checked={adopted.has(view.id)}
                  hint={adopted.has(view.id) ? undefined : t('Mostrar', 'Show')}
                  onClick={() => { actions.adoptSourceView(dbId, view.id); onClose() }} />
              ))}
            </>}
          </> : typeItems(VIEW_TYPE_LABELS.slice(COMMON_TYPES))}
        </Menu>
      </div>
    </DbPopover>
  )
}
