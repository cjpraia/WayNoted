// Editor de select / status / multiSelect: busca, criação, chips escolhidos e menu de cada opção.
import { useEffect, useMemo, useRef, useState } from 'react'
import { MoreHorizontal, X } from 'lucide-react'
import type { Property, PropValue, SelectOption } from '../../../types'
import { OptionChip, optionColorProps } from '../OptionChip'
import { dependentOptions } from '../dependentOptions'
import { groupLabel, OptionMenu, STATUS_GROUPS } from '../OptionMenu'
import { DbPopover, type DbAnchor } from '../ui/Popover'
import { createOption } from '../schemaOps'
import type { EditorCloseReason } from './PropertyEditor'
import { actions, selectors, useStore } from '../../../store'
import { isStringArray } from '../derived'
import { t } from '../../../i18n'

export function OptionsEditor(props: {
  dbId: string
  property: Property
  value: PropValue
  anchor: DbAnchor
  onChange: (value: PropValue) => void
  onClose: (reason: EditorCloseReason) => void
  rowId?: string
}) {
  const { dbId, property, value } = props
  useStore()
  // Visão vinculada: as opções são da fonte e podem ser criadas aqui, salvo se a fonte estiver bloqueada.
  const linkedSource = selectors.page(dbId)?.database?.linkedSourceId
  const schemaLocked = !!(selectors.page(dbId)?.locked || (linkedSource && selectors.page(linkedSource)?.locked))
  const multi = property.type === 'multiSelect'
  const isStatus = property.type === 'status'
  const allOptions = property.options ?? []
  // Linha editada: informada pelo chamador ou deduzida da célula da tabela (data-cell="linha:prop").
  const rowId = props.rowId ?? (props.anchor instanceof Element ? props.anchor.closest('[data-cell]')?.getAttribute('data-cell')?.split(':')[0] : undefined)
  const rawSelected: string[] = multi ? (isStringArray(value) ? value : []) : typeof value === 'string' && value ? [value] : []
  const dependent = dependentOptions(property, selectors.page(dbId)?.database, rowId ? selectors.page(rowId) : undefined, rawSelected)
  const options = dependent.options
  const selected: string[] = multi ? (isStringArray(value) ? value : []) : typeof value === 'string' && value ? [value] : []
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)
  const [menuFor, setMenuFor] = useState<{ option: SelectOption; el: Element } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    const matches = options.filter((o) => o.name.toLowerCase().includes(q))
    return isStatus ? matches.sort((a, b) => STATUS_GROUPS.indexOf(a.group ?? 'todo') - STATUS_GROUPS.indexOf(b.group ?? 'todo')) : matches
  }, [options, q, isStatus])
  const exact = allOptions.some((o) => o.name.toLowerCase() === q)
  const canCreate = !schemaLocked && q !== '' && !exact
  const count = filtered.length + (canCreate ? 1 : 0)

  useEffect(() => setHi(0), [q])
  useEffect(() => inputRef.current?.focus(), [])

  const choose = (id: string) => {
    if (multi) {
      props.onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
      setQuery('')
      inputRef.current?.focus()
    } else {
      props.onChange(id)
      props.onClose('enter')
    }
  }

  const create = () => {
    const o = createOption(dbId, property.id, query)
    // Seleção dependente: a opção nova fica ligada aos valores atuais da propriedade-mãe.
    if (o && property.dependsOn && dependent.parentIds.length) {
      const config = property.dependsOn
      actions.updateSchema(dbId, (schema) => ({ ...schema, properties: schema.properties.map((p) => p.id === property.id ? { ...p, dependsOn: { ...config, links: { ...config.links, [o.id]: dependent.parentIds } } } : p) }))
    }
    if (o) choose(o.id)
    setQuery('')
  }

  const remove = (id: string) => {
    props.onChange(multi ? selected.filter((x) => x !== id) : null)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((h) => (count ? (h + 1) % count : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((h) => (count ? (h - 1 + count) % count : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (hi < filtered.length) choose(filtered[hi].id)
      else if (canCreate) create()
      else props.onClose('enter')
    } else if (e.key === 'Backspace' && query === '' && selected.length) {
      remove(selected[selected.length - 1])
    } else if (e.key === 'Tab') {
      e.preventDefault()
      props.onClose(e.shiftKey ? 'shiftTab' : 'tab')
    }
  }

  return (
    <DbPopover anchor={props.anchor} placement="cover" onClose={() => props.onClose('outside')} className="ed-opts-pop" label={property.name}>
      <div className="ed-opts">
        <div className="ed-opts-top" onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), inputRef.current?.focus())}>
          {selected.map((id) => {
            const o = allOptions.find((x) => x.id === id)
            if (!o) return null
            const colors = optionColorProps(o.color, o.customColor)
            const mismatch = dependent.mismatched.includes(id)
            return (
              <span key={id} className={`db-chip ${colors.className}${isStatus ? ' db-chip-status' : ''} ed-token${mismatch ? ' ed-token--mismatch' : ''}`} style={colors.style} title={mismatch ? t('Não combina com {parent}', 'Does not match {parent}', { parent: dependent.parent?.name ?? '' }) : undefined}>
                {isStatus && <span className="db-chip-dot" />}
                <span className="db-chip-label">{o.name}</span>
                <button type="button" className="ed-token-x" aria-label={t('Remover {name}', 'Remove {name}', { name: o.name })} onClick={() => remove(id)}>
                  <X size={12} />
                </button>
              </span>
            )
          })}
          <input
            ref={inputRef}
            className="ed-opts-search"
            value={query}
            placeholder={selected.length ? '' : schemaLocked ? t('Buscar opção…', 'Search options…') : t('Buscar ou criar opção…', 'Search or create an option…')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="ed-opts-body">
          <div className="dbv-menu-section">{schemaLocked ? t('Selecione uma opção', 'Select an option') : options.length ? t('Selecione uma opção ou crie uma', 'Select or create an option') : t('Digite para criar uma opção', 'Type to create an option')}</div>
          {dependent.parent && <div className="ed-opts-dependent">{dependent.parentIds.length ? t('Opções para {parent}: {values}', 'Options for {parent}: {values}', { parent: dependent.parent.name, values: dependent.parentIds.map((id) => dependent.parent?.options?.find((option) => option.id === id)?.name ?? '').join(', ') }) : t('Escolha “{parent}” para ver só as opções ligadas.', 'Choose “{parent}” to see only linked options.', { parent: dependent.parent.name })}</div>}
          {filtered.map((o, i) => (
            <div key={o.id}>
            {isStatus && (i === 0 || (filtered[i - 1].group ?? 'todo') !== (o.group ?? 'todo')) && <div className="dbv-menu-section">{groupLabel(o.group ?? 'todo')}</div>}
            <div
              className={`ed-opt-row${i === hi ? ' ed-opt-row--hi' : ''}`}
              onMouseEnter={() => setHi(i)}
              onClick={() => choose(o.id)}
            >
              <span className="ed-opt-chip">
                <OptionChip name={o.name} color={o.color} custom={o.customColor} dot={isStatus} />
              </span>
              <button
                type="button"
                className="dbv-icon-btn ed-opt-more"
                aria-label={t('Editar {name}', 'Edit {name}', { name: o.name })}
                disabled={schemaLocked}
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuFor({ option: o, el: e.currentTarget })
                }}
              >
                <MoreHorizontal size={14} />
              </button>
            </div>
            </div>
          ))}
          {canCreate && (
            <div
              className={`ed-opt-row${hi === filtered.length ? ' ed-opt-row--hi' : ''}`}
              onMouseEnter={() => setHi(filtered.length)}
              onClick={create}
            >
              <span className="ed-opt-create">{t('Criar', 'Create')}</span>
              <span className="ed-opt-chip">
                <OptionChip name={query.trim()} color="default" dot={isStatus} />
              </span>
            </div>
          )}
        </div>
      </div>
      {menuFor && !schemaLocked && (
        <OptionMenu
          dbId={dbId}
          propId={property.id}
          option={options.find((o) => o.id === menuFor.option.id) ?? menuFor.option}
          isStatus={isStatus}
          anchor={menuFor.el}
          onClose={() => {
            setMenuFor(null)
            inputRef.current?.focus()
          }}
        />
      )}
    </DbPopover>
  )
}
