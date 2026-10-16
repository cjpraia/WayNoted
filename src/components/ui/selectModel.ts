// Lógica pura do Select (opções, navegação por teclado e busca por digitação), sem DOM.
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'

export interface SelectOption { value: string; label: ReactNode; text: string; disabled?: boolean; group?: string }

const textOf = (node: ReactNode): string => {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

/** Lê `<option>`/`<optgroup>` (inclusive dentro de fragmentos e arrays) e devolve a lista plana. */
export function parseOptions(children: ReactNode, group?: string, out: SelectOption[] = []): SelectOption[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const el = child as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; label?: string }>
    if (el.type === 'option') {
      const text = textOf(el.props.children)
      out.push({ value: el.props.value == null ? text : String(el.props.value), label: el.props.children, text, disabled: el.props.disabled, group })
    } else if (el.type === 'optgroup') parseOptions(el.props.children, String(el.props.label ?? ''), out)
    else if (el.props?.children) parseOptions(el.props.children, group, out)
  })
  return out
}

/** Próximo índice habilitado a partir de `from` na direção `step` (sem dar a volta). */
export function moveIndex(options: SelectOption[], from: number, step: 1 | -1): number {
  for (let i = from + step; i >= 0 && i < options.length; i += step) if (!options[i].disabled) return i
  return from
}
export const firstEnabled = (options: SelectOption[]) => options.findIndex((o) => !o.disabled)
export const lastEnabled = (options: SelectOption[]) => { for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) return i; return -1 }

/** Busca por digitação: prefixo acumulado (≤ 700 ms entre teclas); letra repetida percorre as que começam com ela. */
export function typeahead(options: SelectOption[], current: number, buffer: string): number {
  const query = buffer.toLowerCase()
  if (!query) return current
  const same = [...query].every((c) => c === query[0])
  const prefix = same ? query[0] : query
  const start = same ? current + 1 : current
  for (let k = 0; k < options.length; k++) {
    const i = (start + k + options.length) % options.length
    if (!options[i].disabled && options[i].text.toLowerCase().startsWith(prefix)) return i
  }
  return current
}

/** Posição do popover: abaixo do campo, ou acima quando falta espaço; sempre dentro da janela. */
export function placeList(trigger: { left: number; top: number; bottom: number; width: number }, viewport: { width: number; height: number }, wanted: number, margin = 8) {
  const below = viewport.height - trigger.bottom - margin
  const above = trigger.top - margin
  const up = below < Math.min(wanted, 160) && above > below
  const maxHeight = Math.max(96, Math.min(280, up ? above : below))
  const height = Math.min(wanted, maxHeight)
  const minWidth = trigger.width
  const left = Math.max(margin, Math.min(trigger.left, viewport.width - margin - Math.max(minWidth, 160)))
  return { left, top: up ? trigger.top - 4 - height : trigger.bottom + 4, minWidth, maxHeight, up }
}
