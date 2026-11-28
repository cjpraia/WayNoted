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

interface ListBounds { left: number; right: number; top: number; bottom: number }

/** Mantém a lista dentro da janela, inclusive quando está em um diálogo modal. */
export function placeList(
  trigger: { left: number; top: number; bottom: number; width: number },
  viewport: { width: number; height: number },
  wanted: number,
  bounds?: ListBounds,
) {
  const margin = 8
  const gap = 4
  const start = Math.max(0, bounds?.left ?? 0) + margin
  const end = Math.min(viewport.width, bounds?.right ?? viewport.width) - margin
  const top = Math.max(0, bounds?.top ?? 0) + margin
  const bottom = Math.min(viewport.height, bounds?.bottom ?? viewport.height) - margin
  const below = Math.max(0, bottom - trigger.bottom - gap)
  const above = Math.max(0, trigger.top - top - gap)
  const up = below < Math.min(wanted, 160) && above > below
  const maxHeight = Math.min(280, up ? above : below)
  const availableWidth = Math.max(0, end - start)
  const minWidth = Math.min(availableWidth, trigger.width)
  const alignedWidth = Math.min(availableWidth, Math.max(minWidth, 160))
  const left = Math.max(start, Math.min(trigger.left, end - alignedWidth))
  return {
    left,
    top: up ? trigger.top - gap - Math.min(wanted, maxHeight) : trigger.bottom + gap,
    minWidth,
    maxWidth: Math.max(0, end - left),
    maxHeight,
    up,
  }
}
