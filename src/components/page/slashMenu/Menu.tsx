import { useEffect, useMemo, useRef } from 'react'
import { SuggestionMenu as SuggestionMenuExtension } from '@blocknote/core/extensions'
import { useComponentsContext, useExtension, type DefaultReactSuggestionItem, type SuggestionMenuProps } from '@blocknote/react'
import { useI18n } from '../../../i18n'
import { EMPTY_SLASH_GROUP } from './plan'

export function LocalSlashMenu(props: SuggestionMenuProps<DefaultReactSuggestionItem>) {
  const Components = useComponentsContext()!
  const extension = useExtension(SuggestionMenuExtension)
  const { t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = scrollRef.current
    const selected = container?.querySelector<HTMLElement>(`#bn-suggestion-menu-item-${props.selectedIndex}`)
    if (!container || !selected) return
    const viewport = container.getBoundingClientRect(), row = selected.getBoundingClientRect()
    if (row.bottom > viewport.bottom) container.scrollTop += row.bottom - viewport.bottom + 8
    else if (row.top < viewport.top) container.scrollTop -= viewport.top - row.top + 8
  }, [props.selectedIndex, props.items])
  const empty = props.items.length === 1 && props.items[0].group === EMPTY_SLASH_GROUP ? props.items[0] : null
  const items = useMemo(() => {
    if (empty) return []
    const rendered = []
    let group: string | undefined
    for (let index = 0; index < props.items.length; index++) {
      const item = props.items[index]
      if (item.group !== group) {
        group = item.group
        rendered.push(<Components.SuggestionMenu.Label key={`label-${group}`} className="bn-suggestion-menu-label">{group}</Components.SuggestionMenu.Label>)
      }
      rendered.push(<Components.SuggestionMenu.Item className="bn-suggestion-menu-item" id={`bn-suggestion-menu-item-${index}`} item={item} isSelected={index === props.selectedIndex} key={`item-${index}-${item.title}`} onClick={() => props.onItemClick?.(item)} />)
    }
    return rendered
  }, [props.items, props.selectedIndex, props.onItemClick, Components, empty])
  const filtered = props.items.some((item) => item.group === 'Results' || item.group === 'Resultados')
  return <Components.SuggestionMenu.Root id="bn-suggestion-menu" className={`bn-suggestion-menu pg-slash-menu${filtered ? ' pg-slash-menu--filtered' : ''}`}>
    <div ref={scrollRef} className="pg-slash-menu-scroll">{items.length ? items : <Components.SuggestionMenu.EmptyItem className="bn-suggestion-menu-item pg-slash-menu-empty">{empty?.title ?? t('Nenhum resultado', 'No results')}</Components.SuggestionMenu.EmptyItem>}{(props.loadingState === 'loading' || props.loadingState === 'loading-initial') && <Components.SuggestionMenu.Loader className="bn-suggestion-menu-loader" />}</div>
    <button type="button" className="pg-slash-menu-footer" onMouseDown={(event) => event.preventDefault()} onClick={() => extension.closeMenu()} aria-label={t('Fechar menu', 'Close menu')}>
      <span>{t('Fechar menu', 'Close menu')}</span><kbd>esc</kbd>
    </button>
  </Components.SuggestionMenu.Root>
}
