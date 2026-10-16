// Conversão entre teclas pressionadas, accelerators do Electron e símbolos do macOS.

const SYMBOLS: Record<string, string> = { Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Command: '⌘', Cmd: '⌘', CommandOrControl: '⌘', CmdOrCtrl: '⌘', Super: '⌘', Meta: '⌘' }
const KEY_SYMBOLS: Record<string, string> = { Space: 'Espaço', Return: '↩', Enter: '↩', Up: '↑', Down: '↓', Left: '←', Right: '→', Backspace: '⌫', Delete: '⌦', Tab: '⇥', Escape: '⎋', Plus: '+' }
const ORDER = ['Control', 'Alt', 'Shift', 'Command']

/** 'Alt+Command+N' → '⌥⌘N' (ordem do macOS: ⌃⌥⇧⌘). */
export function acceleratorLabel(accelerator: string, spaceLabel = 'Espaço', platform = typeof window === 'undefined' ? 'darwin' : window.api?.platform ?? window.quickApi?.platform ?? 'darwin'): string {
  if (platform === 'win32') {
    const parts = accelerator.split('+'), key = parts.pop() ?? ''
    const labels: Record<string, string> = { Control: 'Ctrl', Ctrl: 'Ctrl', CommandOrControl: 'Ctrl', CmdOrCtrl: 'Ctrl', Alt: 'Alt', Option: 'Alt', Shift: 'Shift', Command: 'Win', Cmd: 'Win', Meta: 'Win', Super: 'Win' }
    const mods = parts.map(part => labels[part] ?? part).sort((a, b) => ['Ctrl', 'Alt', 'Shift', 'Win'].indexOf(a) - ['Ctrl', 'Alt', 'Shift', 'Win'].indexOf(b))
    return [...mods, key === 'Space' ? spaceLabel : key === 'Return' ? 'Enter' : key.toUpperCase()].join('+')
  }
  if (!accelerator) return ''
  const parts = accelerator.split('+'), key = parts.pop() ?? ''
  const mods = parts.map(part => ({ part, rank: ORDER.indexOf(part === 'Ctrl' ? 'Control' : part === 'Option' ? 'Alt' : ['Cmd', 'CommandOrControl', 'CmdOrCtrl', 'Super', 'Meta'].includes(part) ? 'Command' : part) }))
    .sort((a, b) => a.rank - b.rank).map(({ part }) => SYMBOLS[part] ?? part)
  return mods.join('') + (key === 'Space' ? spaceLabel : KEY_SYMBOLS[key] ?? key.toUpperCase())
}

/** KeyboardEvent → accelerator do Electron, ou null enquanto só modificadores estão pressionados. */
export function eventToAccelerator(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): string | null {
  const code = event.code
  let key: string | null = null
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5)
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code
  else key = ({ Space: 'Space', Enter: 'Return', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`' } as Record<string, string>)[code] ?? null
  if (!key) return null
  const mods = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Command'].filter(Boolean) as string[]
  if (!mods.length || (mods.length === 1 && mods[0] === 'Shift')) return null
  return [...mods, key].join('+')
}
