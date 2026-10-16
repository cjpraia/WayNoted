import { useEffect, useRef, useState } from 'react'
import { actions, api, getState } from '../../store'
import type { Settings } from '../../types'
import { copyText } from '../../clipboard'
import { t } from '../../i18n'
import { Popover } from './Popover'

export function TabMenu({ tab, anchor, onClose }: { tab: NonNullable<Settings['openTabs']>[number]; anchor: HTMLElement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [notice, setNotice] = useState('')
  const tabs = getState().settings.openTabs ?? []
  const index = tabs.findIndex(item => item.id === tab.id)
  const run = (work: () => void | Promise<void>) => {
    void Promise.resolve().then(work).then(onClose).catch(error => {
      setNotice(error instanceof Error ? error.message : String(error))
    })
  }
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus() }, [])
  const item = (label: string, work: () => void | Promise<void>, disabled = false) => <button type="button" role="menuitem" className="shell-tab-menu-item" disabled={disabled} onClick={() => run(work)}>{label}</button>
  return <Popover anchor={anchor} onClose={onClose} width={288} className="shell-tab-menu">
    <div ref={ref} role="menu" aria-label={t('Ações da aba', 'Tab actions')} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const items = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      const at = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }}>
      {item(t('Copiar link', 'Copy link'), () => copyText(tab.route.type === 'page' ? `workspace://page/${tab.route.id}${tab.route.blockId ? `#block=${tab.route.blockId}` : tab.route.viewId ? `#view=${tab.route.viewId}` : ''}` : "workspace://home"))}
      {item(t('Atualizar aba', 'Refresh tab'), async () => {
        await actions.flushAll()
        actions.activateTab(tab.id)
        if (tab.route.type === 'page') await actions.reloadDocument(tab.route.id)
      })}
      <div className="shell-tab-menu-sep" role="separator" />
      {item(t('Duplicar aba', 'Duplicate tab'), () => actions.openInNewTab({ ...tab.route }))}
      {item(tab.pinned ? t('Desafixar aba', 'Unpin tab') : t('Fixar aba', 'Pin tab'), () => actions.pinTab(tab.id))}
      {item(t('Adicionar aba a novo grupo', 'Add tab to new group'), () => actions.groupTab(tab.id, { id: crypto.randomUUID(), name: t('Grupo {n}', 'Group {n}', { n: new Set(tabs.flatMap(item => item.group ? [item.group.id] : [])).size + 1 }) }))}
      {[...new Map(tabs.flatMap(item => item.group ? [[item.group.id, item.group] as const] : [])).values()].filter(group => group.id !== tab.group?.id).map(group => <div key={group.id}>{item(t('Adicionar a {name}', 'Add to {name}', { name: group.name }), () => actions.groupTab(tab.id, group))}</div>)}
      {tab.group && item(t('Remover do grupo', 'Remove from group'), () => actions.groupTab(tab.id))}
      {item(t('Mover aba para nova janela', 'Move tab to new window'), async () => {
        await actions.flushAll()
        await api.openWindow!(tab.route)
        actions.closeTab(tab.id)
      }, !api.openWindow)}
      {item(t('Reabrir última aba fechada', 'Reopen last closed tab'), () => actions.reopenTab(), !actions.canReopenTab())}
      <div className="shell-tab-menu-sep" role="separator" />
      {item(t('Fechar aba', 'Close tab'), () => actions.closeTab(tab.id))}
      {item(t('Fechar outras abas', 'Close other tabs'), () => actions.closeTabs(tab.id, 'other'), !tabs.some(item => item.id !== tab.id && !item.pinned))}
      {item(t('Fechar abas à esquerda', 'Close tabs to the left'), () => actions.closeTabs(tab.id, 'left'), !tabs.slice(0, index).some(item => !item.pinned))}
      {item(t('Fechar abas à direita', 'Close tabs to the right'), () => actions.closeTabs(tab.id, 'right'), !tabs.slice(index + 1).some(item => !item.pinned))}
      {notice && <p role="alert" className="shell-tab-menu-error">{notice}</p>}
    </div>
  </Popover>
}
