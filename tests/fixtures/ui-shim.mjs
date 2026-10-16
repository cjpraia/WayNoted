// Testes que compilam componentes com carregadores próprios não resolvem os imports de `components/ui/*`.
// Estas versões simples (<select>/<button> nativos) mantêm o comportamento antigo nesses testes; o comportamento real
// de Select, Button e DialogActions é coberto em tests/ui-select-ui.test.mjs e tests/ui-controls-ui.test.mjs.
import { createElement } from 'react'
export function Select({ children, onOpen, block, onValueChange, onValuesChange, ...rest }) {
  if (rest.multiple && onValuesChange) rest = { ...rest, onChange: (event) => onValuesChange([...event.target.selectedOptions].map((option) => option.value)) }
  return createElement('select', rest, children)
}
export function Button({ variant, children, type = 'button', ...rest }) { return createElement('button', { type, ...rest }, children) }
export function IconButton({ label, children, type = 'button', ...rest }) { return createElement('button', { type, 'aria-label': label, title: label, ...rest }, children) }
export function Illustration() { return null }
export function EmptyState({ title, children, action }) { return createElement('div', null, title, children, action) }
export function DialogActions({ confirmLabel, onConfirm, onCancel }) { return createElement('div', null, createElement('button', { onClick: onCancel }, 'Cancelar'), createElement('button', { onClick: onConfirm }, confirmLabel)) }
const SHIM = new URL('./ui-shim.mjs', import.meta.url).href
export const shimUi = (source) => source.replace(/import \{([^}]*)\} from '[^']*\/ui\/(?:Select|Button|DialogActions|illustrations\/Illustration)'/g, (_m, names) => `import {${names}} from ${JSON.stringify(SHIM)}`)
