import PRODUCT from '../../../shared/product.json' with { type: 'json' }
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { actions, api, useStore } from '../../store'
import { useI18n } from '../../i18n'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { showUndoToast } from '../ui/toastQueue'
import {
  comboFromEvent, defaultKeys, effectiveKeys, findConflict, groupShortcuts, isCustomized, menuAccelerators, sanitizeOverrides, shortcutLabel, validateCombo, withOverride,
  type ComboConflict, type ShortcutDef, type ShortcutOverrides,
} from '../../shortcuts'
import './ShortcutList.css'

type Filter = 'all' | 'custom' | 'rebind'
interface Recording { id: string; slot: number; pending?: { combo: string; conflict: ComboConflict } }

/**
 * Lista de atalhos agrupada por área, com busca; usada em Configurações (`editable`, com gravação de
 * atalhos novos) e, somente leitura, no ⌘K. Os atalhos efetivos incluem as personalizações.
 */
export function ShortcutList({ compact = false, autoFocus = false, editable = false }: { compact?: boolean; autoFocus?: boolean; editable?: boolean }) {
  const { t, locale } = useI18n()
  const { settings } = useStore()
  const overrides = useMemo(() => sanitizeOverrides(settings.shortcutOverrides), [settings.shortcutOverrides])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [recording, setRecording] = useState<Recording | null>(null)
  const [message, setMessage] = useState('')
  const [announce, setAnnounce] = useState('')
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const groups = useMemo(() => groupShortcuts(query, locale)
    .map(group => ({ ...group, items: group.items.filter(def => filter === 'all' || (filter === 'rebind' ? def.rebind : isCustomized(def.id, overrides))) }))
    .filter(group => group.items.length), [query, locale, filter, overrides])
  const customCount = Object.keys(overrides).length

  // Durante a gravação o menu nativo para de registrar aceleradores (senão ⌘K abriria a busca em vez de ser gravado).
  useEffect(() => {
    if (!recording) return
    void Promise.resolve(api.setShortcutAccelerators?.(menuAccelerators(overrides), true)).catch(() => {})
    return () => { void Promise.resolve(api.setShortcutAccelerators?.(menuAccelerators(), false)).catch(() => {}) }
  }, [recording?.id, recording?.slot]) // eslint-disable-line react-hooks/exhaustive-deps

  const focusButton = (id: string, slot: number) => requestAnimationFrame(() => buttons.current.get(`${id}:${slot}`)?.focus())
  const stop = (id: string, slot: number, text?: string) => { setRecording(null); if (text) setAnnounce(text); focusButton(id, slot) }
  const commit = (def: ShortcutDef, slot: number, combo: string | null) => {
    actions.updateSettings({ shortcutOverrides: withOverride(overrides, def.id, slot, combo) })
    const label = shortcutLabel(def, locale)
    const now = combo ?? defaultKeys(def.id)[slot]
    setMessage('')
    stop(def.id, slot, t('Atalho de {name}: {key}.', 'Shortcut for {name}: {key}.', { name: label, key: now }))
  }
  const describe = (conflict: ComboConflict) => conflict.kind === 'reserved'
    ? t(`Reservado pelo sistema ({what}); o ${PRODUCT.name} pode não receber esta tecla.`, `Reserved by the system ({what}); ${PRODUCT.name} may not receive this key.`, { what: conflict.with })
    : conflict.kind === 'context'
      ? t('Também usado em outro contexto: {what}. Vale onde ambos estiverem ativos.', 'Also used in another context: {what}. It applies wherever both are active.', { what: conflict.with })
      : conflict.kind === 'editor'
        ? t('Já é um atalho do editor: {what}.', 'This is already an editor shortcut: {what}.', { what: conflict.with })
        : t('Já usado por: {what}.', 'Already used by: {what}.', { what: conflict.with })

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, def: ShortcutDef, slot: number) => {
    if (!recording || recording.id !== def.id || recording.slot !== slot) return
    // Nada do que é digitado durante a gravação pode acionar outro atalho.
    event.preventDefault(); event.stopPropagation()
    if (event.key === 'Escape') { setMessage(''); stop(def.id, slot, t('Gravação cancelada.', 'Recording cancelled.')); return }
    const combo = comboFromEvent(event.nativeEvent)
    if (!combo) return // só modificadores: espera a tecla
    const invalid = validateCombo(combo)
    if (invalid) {
      const text = invalid === 'needs-modifier' ? t('Use ⌘ ou ⌃ junto com a tecla.', 'Use ⌘ or ⌃ together with the key.') : t('Esta tecla não pode ser usada.', 'This key cannot be used.')
      setMessage(text); setAnnounce(text); return
    }
    const conflict = findConflict(def.id, slot, combo, locale, overrides)
    if (conflict?.level === 'block') { const text = `${combo}: ${describe(conflict)}`; setMessage(text); setAnnounce(text); return }
    if (conflict) { const text = `${combo}: ${describe(conflict)}`; setRecording({ id: def.id, slot, pending: { combo, conflict } }); setMessage(text); setAnnounce(text); return }
    commit(def, slot, combo)
  }

  const restoreAll = () => {
    const previous = settings.shortcutOverrides
    actions.updateSettings({ shortcutOverrides: {} })
    showUndoToast(t('Atalhos restaurados ao padrão.', 'Shortcuts restored to defaults.'), () => actions.updateSettings({ shortcutOverrides: previous ?? {} }), t('Desfazer', 'Undo'))
  }

  return (
    <div className={`sc-list${compact ? ' is-compact' : ''}`}>
      <div className="sc-toolbar">
        <input className="sc-search" type="search" autoFocus={autoFocus} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Buscar atalho…', 'Search shortcuts…')} aria-label={t('Buscar atalho', 'Search shortcuts')} />
        {editable && <Select value={filter} onChange={event => setFilter(event.target.value as Filter)} aria-label={t('Mostrar', 'Show')}>
          <option value="all">{t('Todos', 'All')}</option>
          <option value="rebind">{t('Personalizáveis', 'Customizable')}</option>
          <option value="custom">{t('Alterados', 'Changed')}</option>
        </Select>}
        {editable && <Button variant="ghost" disabled={!customCount} onClick={restoreAll}>{t('Restaurar todos', 'Restore all')}</Button>}
      </div>
      {editable && <p className="sc-help">{t('Selecione um atalho e pressione a nova combinação (Esc cancela). Precisa de ⌘ ou ⌃. Os atalhos sem botão são fixos (editor, tabela, lousa e sistema).', 'Select a shortcut and press the new combination (Esc cancels). It needs ⌘ or ⌃. Shortcuts without a button are fixed (editor, table, whiteboard and system).')}</p>}
      <div className="sc-sr" role="status" aria-live="polite">{announce}</div>
      {groups.length === 0 && <p className="sc-empty">{t('Nenhum atalho encontrado.', 'No shortcuts found.')}</p>}
      {groups.map(group => (
        <section key={group.area} className="sc-group">
          <h3 className="sc-area">{group.label}</h3>
          <dl>
            {group.items.map(def => {
              const keys = effectiveKeys(def.id, overrides)
              const custom = isCustomized(def.id, overrides)
              const label = shortcutLabel(def, locale)
              const active = recording?.id === def.id
              return (
                <div key={def.id} className={`sc-row${custom ? ' is-custom' : ''}`}>
                  <dt>{label}{custom && <span className="sc-badge">{t('alterado', 'changed')}</span>}</dt>
                  <dd className="sc-keys">
                    {keys.map((key, slot) => editable && def.rebind
                      ? <button key={slot} type="button" className={`sc-key${active && recording!.slot === slot ? ' is-recording' : ''}`} ref={el => { if (el) buttons.current.set(`${def.id}:${slot}`, el); else buttons.current.delete(`${def.id}:${slot}`) }}
                          aria-label={active && recording!.slot === slot ? t('Gravando o atalho de {name}. Pressione a combinação ou Esc para cancelar.', 'Recording the shortcut for {name}. Press the combination or Esc to cancel.', { name: label }) : t('Alterar o atalho de {name}: atual {key}', 'Change the shortcut for {name}: currently {key}', { name: label, key })}
                          onClick={() => { setMessage(''); setRecording({ id: def.id, slot }); setAnnounce(t('Gravando o atalho de {name}. Pressione a combinação ou Esc para cancelar.', 'Recording the shortcut for {name}. Press the combination or Esc to cancel.', { name: label })) }}
                          onKeyDown={event => onKeyDown(event, def, slot)}
                          onBlur={() => setRecording(current => current && current.id === def.id && current.slot === slot && !current.pending ? null : current)}>
                          {active && recording!.slot === slot ? t('Pressione o atalho…', 'Press the shortcut…') : key}
                        </button>
                      : <kbd key={slot}>{key}</kbd>)}
                    {editable && def.rebind && custom && <Button variant="ghost" className="sc-reset" aria-label={t('Restaurar o padrão de {name}', 'Restore the default for {name}', { name: label })} onClick={() => commit(def, keys.findIndex((key, slot) => key !== defaultKeys(def.id)[slot]), null)}>{t('Restaurar', 'Restore')}</Button>}
                  </dd>
                  {active && message && <div className="sc-message" role="alert">
                    {message}
                    {recording!.pending && <span className="sc-confirm">
                      <Button variant="primary" onClick={() => commit(def, recording!.slot, recording!.pending!.combo)}>{t('Usar mesmo assim', 'Use anyway')}</Button>
                      <Button variant="ghost" onClick={() => { setMessage(''); stop(def.id, recording!.slot) }}>{t('Cancelar', 'Cancel')}</Button>
                    </span>}
                  </div>}
                </div>
              )
            })}
          </dl>
        </section>
      ))}
    </div>
  )
}

export type { ShortcutOverrides }
