// Select estilizado e acessível (substitui o <select> nativo): campo nos tokens, lista em popover, teclado completo.
// Aceita <option>/<optgroup> como filhos e chama onChange com { target: { value } }, então a troca é só renomear a tag.
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from './icons/Icon'
import { firstEnabled, lastEnabled, moveIndex, parseOptions, placeList, typeahead } from './selectModel'

export interface SelectChange { target: { value: string }; currentTarget: { value: string } }
export interface SelectProps {
  value: string | number | string[] | null | undefined
  /** Chamado ao abrir a lista (por exemplo, para carregar as opções só nesse momento). */
  onOpen?: () => void
  onChange?: (event: SelectChange) => void
  onValueChange?: (value: string) => void
  /** Seleção múltipla (como `<select multiple>`): `value` é uma lista, a lista fica aberta ao escolher e `onValuesChange` recebe a lista nova. */
  multiple?: boolean
  onValuesChange?: (values: string[]) => void
  autoFocus?: boolean
  children?: ReactNode
  disabled?: boolean
  className?: string
  style?: CSSProperties
  id?: string
  name?: string
  title?: string
  placeholder?: ReactNode
  'aria-label'?: string
  'aria-labelledby'?: string
  /** `block` ocupa a largura do contêiner; o padrão tem a largura do conteúdo (mín. 120 px). */
  block?: boolean
}

export function Select({ value, onOpen, onChange, onValueChange, multiple, onValuesChange, autoFocus, children, disabled, className, style, id, name, title, placeholder, block, ...aria }: SelectProps) {
  const options = useMemo(() => parseOptions(children), [children])
  const chosen = useMemo(() => (Array.isArray(value) ? value : []), [value])
  const current = Array.isArray(value) ? '' : String(value ?? '')
  const selected = multiple ? options.findIndex((o) => chosen.includes(o.value)) : options.findIndex((o) => o.value === current)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [box, setBox] = useState<ReturnType<typeof placeList> | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const buffer = useRef({ text: '', at: 0 })
  const uid = useId()
  const listId = `${uid}-list`

  const close = useCallback((refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus() }, [])
  const commit = useCallback((index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    if (multiple) {
      onValuesChange?.(chosen.includes(option.value) ? chosen.filter((v) => v !== option.value) : options.map((o) => o.value).filter((v) => v === option.value || chosen.includes(v)))
      return
    }
    if (option.value !== current) { onChange?.({ target: { value: option.value }, currentTarget: { value: option.value } }); onValueChange?.(option.value) }
    close()
  }, [options, current, chosen, multiple, onChange, onValueChange, onValuesChange, close])

  const openList = useCallback((at?: number) => {
    if (disabled) return
    setActive(at ?? (selected >= 0 && !options[selected]?.disabled ? selected : firstEnabled(options)))
    setOpen(true); onOpen?.()
  }, [disabled, selected, options, onOpen])

  // Posição: abaixo do campo, ou acima quando falta espaço (position: fixed, dentro do mesmo contêiner para não "sair" do popover pai).
  useLayoutEffect(() => {
    if (!open || !trigger.current) return
    const r = trigger.current.getBoundingClientRect()
    const wanted = Math.min(options.length, 12) * 28 + 8 + options.filter((o, i) => o.group && o.group !== options[i - 1]?.group).length * 24
    setBox(placeList(r, { width: window.innerWidth, height: window.innerHeight }, wanted))
  }, [open, options])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (list.current?.contains(target) || trigger.current?.contains(target)) return
      close(false)
    }
    const onScroll = (event: Event) => { if (!list.current?.contains(event.target as Node)) close(false) }
    document.addEventListener('mousedown', onDown, true)
    const onResize = () => close(false)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('mousedown', onDown, true); window.removeEventListener('resize', onResize); window.removeEventListener('scroll', onScroll, true) }
  }, [open, close])

  useEffect(() => { if (open && active >= 0) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [open, active, box])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    const key = event.key
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') { event.preventDefault(); openList() }
      else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const now = Date.now(); const b = buffer.current; b.text = now - b.at > 700 ? key : b.text + key; b.at = now
        const i = typeahead(options, selected, b.text); if (i !== selected) commit(i)
      }
      return
    }
    if (key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    else if (key === 'Tab') close(false)
    else if (key === 'ArrowDown') { event.preventDefault(); setActive((i) => moveIndex(options, i, 1)) }
    else if (key === 'ArrowUp') { event.preventDefault(); setActive((i) => moveIndex(options, i, -1)) }
    else if (key === 'Home') { event.preventDefault(); setActive(firstEnabled(options)) }
    else if (key === 'End') { event.preventDefault(); setActive(lastEnabled(options)) }
    else if (key === 'Enter' || (key === ' ' && !buffer.current.text.trim())) { event.preventDefault(); commit(active) }
    else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now(); const b = buffer.current; b.text = now - b.at > 700 ? key : b.text + key; b.at = now
      setActive((i) => typeahead(options, i, b.text))
    }
  }

  const multiLabel = multiple ? options.filter((o) => chosen.includes(o.value)).map((o) => o.text).join(', ') : ''
  const hasValue = multiple ? multiLabel !== '' : selected >= 0
  const label = multiple ? (multiLabel || placeholder) : selected >= 0 ? options[selected].label : placeholder
  let lastGroup: string | undefined
  return (
    <>
      <button ref={trigger} type="button" id={id} name={name} title={title} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${uid}-o${active}` : undefined} disabled={disabled} autoFocus={autoFocus}
        className={`np-select${block ? ' np-select--block' : ''}${className ? ` ${className}` : ''}`} style={style}
        onClick={() => (open ? close(false) : openList())} onKeyDown={onKeyDown} {...aria}>
        <span className={`np-select-value${!hasValue ? ' is-placeholder' : ''}`}>{label ?? ' '}</span>
        <Icon name="chevron-down" size={14} className="np-select-caret" />
      </button>
      {open && (
        <ul ref={list} id={listId} role="listbox" aria-multiselectable={multiple || undefined} tabIndex={-1} className={`np-select-list${box?.up ? ' is-up' : ''}`} aria-label={aria['aria-label']}
          style={{ left: box?.left ?? 0, top: box?.top ?? 0, minWidth: box?.minWidth, maxHeight: box?.maxHeight, visibility: box ? 'visible' : 'hidden' }}
          onMouseDown={(event) => event.preventDefault()}>
          {options.map((option, index) => {
            const heading = option.group && option.group !== lastGroup ? <li role="presentation" className="np-select-group">{option.group}</li> : null
            lastGroup = option.group
            return <Fragment key={index}>{heading}
              <li id={`${uid}-o${index}`} data-index={index} role="option" aria-selected={multiple ? chosen.includes(option.value) : index === selected} aria-disabled={option.disabled || undefined}
                className={`np-select-option${index === active ? ' is-active' : ''}${(multiple ? chosen.includes(option.value) : index === selected) ? ' is-selected' : ''}${option.disabled ? ' is-disabled' : ''}`}
                onMouseMove={() => { if (!option.disabled && active !== index) setActive(index) }} onClick={() => commit(index)}>
                <span className="np-select-option-label">{option.label}</span>
                {(multiple ? chosen.includes(option.value) : index === selected) && <Icon name="check" size={14} className="np-select-check" />}
              </li></Fragment>
          })}
        </ul>
      )}
    </>
  )
}
