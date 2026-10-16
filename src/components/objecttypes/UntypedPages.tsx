// Seção "Sem tipo (N)" da coleção de um tipo: páginas e linhas de banco que ainda não têm nenhum tipo, com busca,
// "Aplicar este tipo" por linha e seleção múltipla para aplicar em lote. Recolhida por padrão; paginada.
// Usa o mesmo fluxo de aplicar (confirmação, campos da página, modelo, aviso com Desfazer). docs/USAGE.md
import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { actions, useStore } from '../../store'
import { useI18n } from '../../i18n'
import type { Page } from '../../types'
import { PageIcon } from '../page/PageIcon'
import { dailyDatabaseId } from '../../daily/dailyNotes'
import { fold, type ObjectType } from '../../objecttypes/model'
import { untypedPages } from '../../objecttypes/adjust'
import { applyTypeFlow } from './TypePicker'
import './objecttypes.css'
import { Button } from '../ui/Button'

export const UNTYPED_PAGE = 50

export function UntypedPages({ type, pathOf }: { type: ObjectType; pathOf: (page: Page) => string }) {
  const { t } = useI18n()
  const { pages, settings } = useStore()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(UNTYPED_PAGE)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const types = settings.objectTypes ?? []
  const all = useMemo(() => {
    const daily = dailyDatabaseId()
    return untypedPages(pages, types, { excludeDatabaseIds: new Set(daily ? [daily] : []) })
  }, [pages, types])
  const allIds = useMemo(() => new Set(all.map((page) => page.id)), [all])
  const q = fold(query)
  const list = useMemo(() => (q ? all.filter((page) => fold(page.title).includes(q)) : all), [all, q])
  const shown = list.slice(0, limit)
  if (!all.length && !open) return null
  const ids = [...picked].filter((id) => allIds.has(id))
  const toggle = (id: string) => setPicked((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const apply = (target: string[]) => { setPicked(new Set()); void applyTypeFlow(target, type.id).catch(actions.reportSaveError) }
  const allShownPicked = shown.length > 0 && shown.every((page) => picked.has(page.id))
  return <section className="ot-untyped" data-ot="untyped" aria-label={t('Páginas sem tipo', 'Pages without a type')}>
    <button type="button" className="ot-untyped-head" aria-expanded={open} aria-controls="ot-untyped-body" onClick={() => setOpen(!open)}>
      <ChevronRight size={14} aria-hidden className={open ? 'is-open' : ''} />
      <span>{t('Sem tipo ({n})', 'No type ({n})', { n: all.length })}</span>
      <small>{t('páginas que ainda não têm tipo', 'pages that don’t have a type yet')}</small>
    </button>
    {open && <div id="ot-untyped-body" className="ot-untyped-body">
      <div className="ot-untyped-bar">
        <input className="ot-untyped-search" type="search" placeholder={t('Buscar página sem tipo…', 'Search pages without a type…')} aria-label={t('Buscar página sem tipo', 'Search pages without a type')} value={query} onChange={(e) => { setQuery(e.target.value); setLimit(UNTYPED_PAGE) }} />
        {shown.length > 0 && <label className="ot-untyped-all"><input type="checkbox" checked={allShownPicked} onChange={() => setPicked(allShownPicked ? new Set() : new Set(shown.map((page) => page.id)))} /> {t('Selecionar todas', 'Select all')}</label>}
        {ids.length > 0 && <Button variant="primary" onClick={() => apply(ids)}>{t('Aplicar {name} a {n} página(s)', 'Apply {name} to {n} page(s)', { name: type.name, n: ids.length })}</Button>}
      </div>
      <ul className="ot-untyped-list">
        {shown.map((page) => <li key={page.id} className="ot-untyped-row">
          <input type="checkbox" aria-label={t('Selecionar {name}', 'Select {name}', { name: page.title || t('Sem título', 'Untitled') })} checked={picked.has(page.id)} onChange={() => toggle(page.id)} />
          <button type="button" className="ot-untyped-title" onClick={() => actions.openPage(page.id)} title={pathOf(page)}>
            <PageIcon value={page.icon} fallback="page" style={{ width: 16, height: 16 }} />
            <span>{page.title || t('Sem título', 'Untitled')}</span>
            <small>{pathOf(page)}</small>
          </button>
          <Button aria-label={t('Aplicar {type} a {name}', 'Apply {type} to {name}', { type: type.name, name: page.title || t('Sem título', 'Untitled') })} onClick={() => apply([page.id])}>{t('Aplicar este tipo', 'Apply this type')}</Button>
        </li>)}
      </ul>
      {!list.length && <p className="ot-collection-note">{q ? t('Nenhuma página sem tipo com esse nome.', 'No untyped page with that name.') : t('Todas as páginas já têm tipo.', 'Every page already has a type.')}</p>}
      {list.length > shown.length && <Button className="ot-untyped-more" onClick={() => setLimit(limit + UNTYPED_PAGE)}>{t('Carregar mais {n}', 'Load {n} more', { n: Math.min(UNTYPED_PAGE, list.length - shown.length) })} <small>({shown.length}/{list.length})</small></Button>}
    </div>}
  </section>
}
