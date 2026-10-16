// Fonte única dos atalhos de teclado do aplicativo. Alimenta Configurações → Atalhos e a lista do ⌘K
// (src/components/shortcuts/ShortcutList.tsx). tests/shortcuts.test.mts varre App.tsx e main.cjs e
// falha se uma tecla registrada lá não estiver aqui — ao criar um atalho novo, acrescente-o a esta tabela
// e a docs/KEYBOARD-SHORTCUTS.md. Símbolos: ⌘ Command/Ctrl, ⇧ Shift, ⌥ Option/Alt, ⌃ Control.
import { translate, type Locale } from './localization.ts'

export type ShortcutArea = 'navigation' | 'windows' | 'daily' | 'view' | 'editor' | 'database' | 'capture' | 'search' | 'preview' | 'board'
export type ShortcutScope = 'menu' | 'window' | 'editor' | 'global'

export interface ShortcutDef {
  id: string
  area: ShortcutArea
  /** [pt-BR, en-US] */
  label: [string, string]
  /** Combinações equivalentes (cada uma vira uma tecla na lista), ex.: ['⌘K', '⌘P']. */
  keys: string[]
  scope: ShortcutScope
  /** Pode ser regravado em Configurações → Atalhos (tem um tratador que consulta os atalhos efetivos). */
  rebind?: boolean
}

export const SHORTCUT_AREAS: { id: ShortcutArea; label: [string, string] }[] = [
  { id: 'navigation', label: ['Navegação e abas', 'Navigation and tabs'] },
  { id: 'windows', label: ['Janelas e arquivo', 'Windows and file'] },
  { id: 'daily', label: ['Fluxo diário', 'Daily flow'] },
  { id: 'view', label: ['Visualização', 'View'] },
  { id: 'editor', label: ['Editor de páginas', 'Page editor'] },
  { id: 'database', label: ['Bancos de dados', 'Databases'] },
  { id: 'capture', label: ['Captura rápida', 'Quick capture'] },
  { id: 'search', label: ['Busca ⌘K', 'Search ⌘K'] },
  { id: 'preview', label: ['Prévias, comentários e listas', 'Previews, comments and lists'] },
  { id: 'board', label: ['Lousa', 'Whiteboard'] },
]

/** Atalho de “Inserir consulta” no editor (antes ⌘⌥Q, que é a citação do BlockNote). */
export const QUERY_SHORTCUT = '⌘⌥K'

const s = (id: string, area: ShortcutArea, scope: ShortcutScope, pt: string, en: string, ...keys: string[]): ShortcutDef => ({ id, area, scope, label: [pt, en], keys })

export const SHORTCUTS: ShortcutDef[] = [
  // Navegação e abas
  s('search', 'navigation', 'window', 'Buscar e executar comandos', 'Search and run commands', '⌘K', '⌘P'),
  s('new-page', 'navigation', 'window', 'Nova página', 'New page', '⌘N'),
  s('new-tab', 'navigation', 'window', 'Nova aba', 'New tab', '⌘T'),
  s('reopen-tab', 'navigation', 'window', 'Reabrir a última aba fechada', 'Reopen last closed tab', '⌘⇧T'),
  s('close-tab', 'navigation', 'window', 'Fechar aba', 'Close tab', '⌘W'),
  s('tab-next', 'navigation', 'window', 'Próxima / anterior aba', 'Next / previous tab', '⌃Tab', '⌃⇧Tab'),
  s('back-forward', 'navigation', 'window', 'Voltar / avançar no histórico', 'Back / forward in history', '⌘[', '⌘]'),
  s('sidebar', 'navigation', 'window', 'Mostrar/ocultar a barra lateral (com a prévia aberta, fecha a prévia)', 'Toggle sidebar (closes the preview when one is open)', '⌘\\'),
  s('settings', 'navigation', 'window', 'Configurações', 'Settings', '⌘,'),
  s('graph', 'navigation', 'window', 'Grafo de páginas (de novo volta)', 'Page graph (again to go back)', '⌘G'),
  s('productivity', 'navigation', 'window', 'Painel de produtividade (de novo volta)', 'Productivity dashboard (again to go back)', '⌘⇧P'),
  s('ask', 'navigation', 'window', 'Perguntar às suas notas (painel de IA)', 'Ask your notes (AI panel)', '⌘J'),
  // Janelas e arquivo
  s('new-window', 'windows', 'menu', 'Nova janela', 'New window', '⌘⇧N'),
  s('close-window', 'windows', 'menu', 'Fechar a janela', 'Close window', '⌘⇧W'),
  s('export', 'windows', 'menu', 'Exportar…', 'Export…', '⌘⇧E'),
  s('reload', 'windows', 'menu', 'Recarregar a janela (grava antes)', 'Reload window (saves first)', '⌘R'),
  s('zoom', 'windows', 'menu', 'Zoom: aumentar / diminuir / tamanho real', 'Zoom: in / out / actual size', '⌘+', '⌘−', '⌘0'),
  s('fullscreen', 'windows', 'menu', 'Tela cheia', 'Full screen', '⌃⌘F'),
  s('minimize', 'windows', 'menu', 'Minimizar / ocultar / encerrar', 'Minimize / hide / quit', '⌘M', '⌘H', '⌘Q'),
  // Fluxo diário
  s('daily-today', 'daily', 'menu', 'Ir para a nota de hoje', 'Go to today’s note', '⌘⇧D'),
  s('calendar-panel', 'daily', 'menu', 'Mostrar/ocultar o painel de calendário', 'Toggle calendar panel', '⌘⇧C'),
  // Visualização
  s('focus', 'view', 'menu', 'Modo foco (Esc sai)', 'Focus mode (Esc exits)', '⌘⇧F'),
  // Editor
  s('slash', 'editor', 'editor', 'Menu de blocos', 'Block menu', '/'),
  s('mention', 'editor', 'editor', 'Mencionar página ou data', 'Mention a page or date', '@'),
  s('find', 'editor', 'editor', 'Encontrar e substituir na página', 'Find and replace in page', '⌘F'),
  s('paste-plain', 'editor', 'menu', 'Colar como texto simples', 'Paste as plain text', '⌘⇧V'),
  s('undo', 'editor', 'editor', 'Desfazer / refazer', 'Undo / redo', '⌘Z', '⌘⇧Z', '⌘Y'),
  s('comment', 'editor', 'editor', 'Comentar a seleção', 'Comment on selection', '⌘⇧M'),
  s('query', 'editor', 'editor', 'Inserir bloco de consulta viva', 'Insert live query block', QUERY_SHORTCUT),
  s('quote', 'editor', 'editor', 'Converter em citação', 'Turn into quote', '⌘⌥Q'),
  s('format', 'editor', 'editor', 'Negrito / itálico / sublinhado / código', 'Bold / italic / underline / code', '⌘B', '⌘I', '⌘U', '⌘E'),
  s('heading', 'editor', 'editor', 'Parágrafo / título 1–3', 'Paragraph / heading 1–3', '⌘⌥0', '⌘⌥1', '⌘⌥2', '⌘⌥3'),
  s('lists', 'editor', 'editor', 'Conversões de lista (⌘⇧6 a ⌘⇧9)', 'List conversions (⌘⇧6 to ⌘⇧9)', '⌘⇧6', '⌘⇧7', '⌘⇧8', '⌘⇧9'),
  s('code-block', 'editor', 'editor', 'Bloco de código', 'Code block', '⌘⌥C'),
  s('indent', 'editor', 'editor', 'Indentar / desindentar o bloco', 'Indent / outdent block', 'Tab', '⇧Tab'),
  s('block-duplicate', 'editor', 'editor', 'Duplicar o bloco do cursor (menu do bloco)', 'Duplicate the block at the cursor (block menu)', '⌘D'),
  // Bancos de dados: tabela (célula ativa) e cartões do quadro/galeria/lista (docs/KEYBOARD-SHORTCUTS.md)
  s('db-cell-move', 'database', 'window', 'Tabela: mover a célula ativa (atravessa grupos)', 'Table: move the active cell (crosses groups)', '↑', '↓', '←', '→'),
  s('db-cell-edges', 'database', 'window', 'Tabela: primeira/última coluna e primeira/última linha', 'Table: first/last column and first/last row', 'Home', 'End', '⌘↑', '⌘↓'),
  s('db-cell-tab', 'database', 'window', 'Tabela: próxima / anterior célula', 'Table: next / previous cell', 'Tab', '⇧Tab'),
  s('db-cell-edit', 'database', 'window', 'Tabela: editar a célula (caixa de seleção alterna)', 'Table: edit the cell (checkbox toggles)', 'Enter', 'F2'),
  s('db-cell-type', 'database', 'window', 'Tabela: digitar substitui o conteúdo (texto, número, URL, e-mail, telefone)', 'Table: typing replaces the content (text, number, URL, email, phone)', 'qualquer caractere'),
  s('db-cell-clear', 'database', 'window', 'Tabela: limpar o valor da célula (desfazer com ⌘Z)', 'Table: clear the cell value (undo with ⌘Z)', 'Backspace', 'Delete'),
  s('db-cell-clipboard', 'database', 'window', 'Tabela: copiar / colar o valor (colar TSV preenche a partir da célula ativa)', 'Table: copy / paste the value (pasting TSV fills from the active cell)', '⌘C', '⌘V'),
  s('db-cell-select', 'database', 'window', 'Tabela: estender a seleção de linhas', 'Table: extend the row selection', '⇧↑', '⇧↓'),
  s('db-cell-open', 'database', 'window', 'Tabela: abrir a linha como página', 'Table: open the row as a page', '⌘Enter'),
  s('db-cell-esc', 'database', 'window', 'Tabela: Esc sai da edição (a célula continua ativa) e limpa a seleção de linhas', 'Table: Esc leaves editing (the cell stays active) and clears the row selection', 'Esc'),
  s('db-undo', 'database', 'window', 'Desfazer / refazer a última ação de banco (fora de campos de texto)', 'Undo / redo the last database action (outside text fields)', '⌘Z', '⌘⇧Z'),
  s('db-card-move', 'database', 'window', 'Quadro, galeria e lista: mover o foco entre cartões', 'Board, gallery and list: move focus between cards', '↑', '↓', '←', '→'),
  s('db-card-open', 'database', 'window', 'Cartão focado: abrir a página / selecionar', 'Focused card: open the page / select', 'Enter', 'Espaço'),
  s('db-card-rename', 'database', 'window', 'Cartão focado: renomear o título no próprio cartão (ou ✎ ao passar o ponteiro)', 'Focused card: rename the title in place (or ✎ on hover)', 'F2'),
  s('db-card-edit', 'database', 'window', 'Cartão: editar um valor de propriedade', 'Card: edit a property value', 'duplo clique'),
  // Captura rápida
  s('capture-toggle', 'capture', 'global', 'Abrir/fechar a nota rápida (global, configurável)', 'Open/close quick note (global, configurable)', '⌥⌘N'),
  s('capture-selection', 'capture', 'global', 'Capturar a seleção/área de transferência (global, configurável)', 'Capture selection/clipboard (global, configurable)', '⌥⇧⌘N'),
  s('capture-save', 'capture', 'window', 'Salvar a nota rápida', 'Save quick note', '⌘Enter'),
  // Busca
  s('search-nav', 'search', 'window', 'Navegar pelos resultados', 'Move through results', '↑', '↓'),
  s('search-open', 'search', 'window', 'Abrir resultado / em nova aba', 'Open result / in new tab', 'Enter', '⌘Enter'),
  s('search-close', 'search', 'window', 'Fechar a busca', 'Close search', 'Esc'),
  // Prévias, comentários, listas
  s('peek-full', 'preview', 'window', 'Prévia de linha: abrir em página inteira', 'Row preview: open full page', '⌘Enter'),
  s('peek-resize', 'preview', 'window', 'Prévia lateral: redimensionar/fechar (na borda)', 'Side preview: resize/close (on the edge)', '←', '→', 'Home', 'End'),
  s('comment-send', 'preview', 'window', 'Enviar o comentário', 'Send comment', '⌘Enter'),
  s('tree-open', 'preview', 'window', 'Barra lateral: abrir página / em nova aba', 'Sidebar: open page / in new tab', 'Enter', '⌘Enter'),
  s('query-suggest', 'preview', 'window', 'Sugestões no texto da consulta', 'Suggestions in query text', '⌃Espaço'),
  s('tab-menu', 'preview', 'window', 'Menu da aba (fixar, agrupar, duplicar…)', 'Tab menu (pin, group, duplicate…)', '⇧F10'),
  // Lousa (docs/USAGE.md) — teclas de uma letra valem com a lousa em foco.
  s('board-tools', 'board', 'window', 'Selecionar / laço (seleção à mão livre) / mão', 'Select / lasso (freehand select) / hand', 'V', 'Q', 'H'),
  s('board-shapes-1', 'board', 'window', 'Nota / texto / seção (moldura)', 'Note / text / section (frame)', 'N', 'T', 'F'),
  s('board-shapes-2', 'board', 'window', 'Retângulo / elipse / losango', 'Rectangle / ellipse / diamond', 'R', 'O', 'D'),
  s('board-lines', 'board', 'window', 'Linha / seta (conector)', 'Line / arrow (connector)', 'L', 'A'),
  s('board-draw', 'board', 'window', 'Caneta / borracha / imagem', 'Pen / eraser / image', 'P', 'E', 'I'),
  s('board-digits', 'board', 'window', 'Ferramentas por número (1 selecionar, 2 retângulo, 3 losango, 4 elipse, 5 seta, 6 linha, 7 caneta, 8 texto, 9 imagem, 0 borracha)', 'Tools by number (1 select, 2 rectangle, 3 diamond, 4 ellipse, 5 arrow, 6 line, 7 pen, 8 text, 9 image, 0 eraser)', '1–9', '0'),
  s('board-pan', 'board', 'window', 'Mover a visão', 'Pan', 'Espaço + arrastar'),
  s('board-zoom', 'board', 'window', 'Zoom ao redor do cursor (roda / pinça)', 'Zoom around the cursor (wheel / pinch)', '⌘ + roda'),
  s('board-zoom-keys', 'board', 'window', 'Aumentar / diminuir / 100%', 'Zoom in / out / 100%', '+', '−', '⇧0'),
  s('board-fit', 'board', 'window', 'Ajustar à tela / à seleção', 'Zoom to fit / selection', '⇧1', '⇧2'),
  s('board-resize', 'board', 'window', 'Redimensionar mantendo proporção / a partir do centro', 'Resize keeping ratio / from centre', '⇧ + arrastar', '⌥ + arrastar'),
  s('board-nudge', 'board', 'window', 'Mover 1 px / 10 px', 'Nudge 1 px / 10 px', '←↑→↓', '⇧ + setas'),
  s('board-duplicate', 'board', 'window', 'Duplicar (ou ⌥-arrastar)', 'Duplicate (or ⌥-drag)', '⌘D'),
  s('board-group', 'board', 'window', 'Agrupar / desagrupar', 'Group / ungroup', '⌘G', '⌘⇧G'),
  s('board-lock', 'board', 'window', 'Travar / destravar objeto', 'Lock / unlock object', '⌘L'),
  s('board-order', 'board', 'window', 'Avançar / recuar (⇧ frente / fundo)', 'Forward / backward (⇧ front / back)', '⌘]', '⌘['),
  s('board-present', 'board', 'window', 'Percorrer seções (apresentação)', 'Step through sections (present)', '⌥←', '⌥→'),
  s('board-find', 'board', 'window', 'Buscar objetos', 'Find objects', '⌘F'),
  s('board-edit', 'board', 'window', 'Editar texto / cartão', 'Edit text / card', 'Enter', 'duplo clique'),
]

/**
 * Comandos que o usuário pode regravar: tratados pelo `keydown` do App (src/App.tsx) ou pelo menu
 * nativo (electron/main.cjs, via `np:setShortcutAccelerators`). Os demais (teclas do editor do BlockNote,
 * tabela, quadro, lousa, papéis do sistema) continuam fixos e aparecem na lista só para consulta.
 */
export const REBINDABLE_IDS: readonly string[] = [
  'search', 'new-page', 'new-tab', 'reopen-tab', 'close-tab', 'tab-next', 'back-forward', 'sidebar', 'settings', 'graph', 'productivity', 'ask',
  'new-window', 'close-window', 'export', 'reload', 'daily-today', 'calendar-panel', 'focus',
]
for (const def of SHORTCUTS) if (REBINDABLE_IDS.includes(def.id)) def.rebind = true

/** Atalhos que o menu nativo registra (id → fallback no Electron). Os demais rebindáveis são só do `keydown`. */
export const MENU_SHORTCUT_IDS: readonly string[] = ['new-page', 'new-window', 'new-tab', 'daily-today', 'reopen-tab', 'close-tab', 'search', 'export', 'close-window', 'focus', 'calendar-panel', 'reload']

// ---------- Atalhos personalizados ----------

/** id → teclas efetivas (mesmo tamanho de `keys`). Persistido em `settings.shortcutOverrides`. */
export type ShortcutOverrides = Record<string, string[]>

let overridesSource: () => ShortcutOverrides | undefined = () => undefined
/** O App liga a fonte (as settings) para que dicas e comandos reflitam o atalho novo sem depender de importar a store aqui. */
export function setShortcutOverridesSource(source: () => ShortcutOverrides | undefined) { overridesSource = source }

export const defaultKeys = (id: string): string[] => [...(SHORTCUTS.find(item => item.id === id)?.keys ?? [])]

/** Teclas efetivas: o padrão com os espaços personalizados por cima (valor vazio = padrão). */
export function effectiveKeys(id: string, overrides: ShortcutOverrides | undefined = overridesSource()): string[] {
  const base = defaultKeys(id)
  const custom = overrides?.[id]
  if (!custom || !SHORTCUTS.find(item => item.id === id)?.rebind) return [...base]
  return base.map((key, index) => typeof custom[index] === 'string' && custom[index] ? custom[index] : key)
}

/** Remove ids/valores inválidos (settings antigas, arquivo editado à mão). Nunca lança. */
export function sanitizeOverrides(value: unknown): ShortcutOverrides {
  const out: ShortcutOverrides = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [id, keys] of Object.entries(value as Record<string, unknown>)) {
    const def = SHORTCUTS.find(item => item.id === id)
    if (!def?.rebind || !Array.isArray(keys)) continue
    const clean = def.keys.map((fallback, index) => {
      const key = keys[index]
      return typeof key === 'string' && parseCombo(key) && !validateCombo(key) ? key : fallback
    })
    if (clean.some((key, index) => key !== def.keys[index])) out[id] = clean
  }
  return out
}

export const isCustomized = (id: string, overrides: ShortcutOverrides | undefined = overridesSource()) => {
  const keys = effectiveKeys(id, overrides), base = defaultKeys(id)
  return keys.some((key, index) => key !== base[index])
}

export const shortcutLabel = (def: ShortcutDef, locale: Locale) => translate(locale, def.label[0], def.label[1])
export const areaLabel = (area: ShortcutArea, locale: Locale) => { const a = SHORTCUT_AREAS.find(item => item.id === area)!; return translate(locale, a.label[0], a.label[1]) }
export const shortcutKeys = (id: string) => effectiveKeys(id)
/** Dica curta para tooltips/comandos: ‘⌘K’ (ou o atalho personalizado). `slot` escolhe entre teclas alternativas. */
export const shortcutHint = (id: string, slot = 0) => {
  const combo = shortcutKeys(id)[slot] ?? ''
  return shortcutDisplay(combo, id)
}

/** Present canonical stored combinations using the current OS's key names. */
export function shortcutDisplay(combo: string, id = ''): string {
  if (isMacPlatform()) return combo
  if (id === 'fullscreen') return 'F11'
  return combo.replace(/⌃/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+').replace(/⌘/g, 'Ctrl+')
}

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Filtra por rótulo, área ou teclas (sem acento/caixa) e agrupa mantendo a ordem das áreas. */
export function groupShortcuts(query: string, locale: Locale): { area: ShortcutArea; label: string; items: ShortcutDef[] }[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  const match = (def: ShortcutDef) => {
    const hay = fold(`${shortcutLabel(def, locale)} ${areaLabel(def.area, locale)} ${effectiveKeys(def.id).join(' ')}`)
    return words.every(word => hay.includes(word))
  }
  return SHORTCUT_AREAS
    .map(area => ({ area: area.id, label: areaLabel(area.id, locale), items: SHORTCUTS.filter(def => def.area === area.id && !(typeof window !== 'undefined' && window.api?.platform === 'win32' && def.id === 'minimize') && match(def)) }))
    .filter(group => group.items.length)
}

/** Normaliza ‘⌘⇧F’ → ‘mod+shift+f’ (ordem fixa dos modificadores) para o teste de cobertura. */
export function canonicalCombo(combo: string): string {
  const mods = new Set<string>()
  let rest = combo
  const map: Record<string, string> = { '⌘': 'mod', '⇧': 'shift', '⌥': 'alt', '⌃': 'ctrl' }
  while (rest && map[rest[0]]) { mods.add(map[rest[0]]); rest = rest.slice(1) }
  const key = rest.toLowerCase()
  return [...['ctrl', 'mod', 'alt', 'shift'].filter(m => mods.has(m)), key === 'espaço' ? 'space' : key].join('+')
}

// ---------- Gravação, comparação e conflitos ----------

export interface ParsedCombo { mod: boolean; ctrl: boolean; alt: boolean; shift: boolean; key: string }

const KEY_ALIASES: Record<string, string> = { 'espaço': 'space', ' ': 'space', escape: 'esc', return: 'enter', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', '−': '-', plus: '+' }

/** ‘⌘⇧N’ → modificadores + tecla normalizada; null se não houver tecla. */
export function parseCombo(combo: string): ParsedCombo | null {
  combo = combo.replace(/^(?:(?:Ctrl|Control|Alt|Shift|Meta|Cmd)\+)+/, modifiers => modifiers.replace(/(?:Ctrl|Control)\+/g, isMacPlatform() ? '⌃' : '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧').replace(/(?:Meta|Cmd)\+/g, '⌘'))
  const out: ParsedCombo = { mod: false, ctrl: false, alt: false, shift: false, key: '' }
  let rest = combo
  for (; rest; rest = rest.slice(1)) {
    const c = rest[0]
    if (c === '⌘') out.mod = true; else if (c === '⌃') out.ctrl = true; else if (c === '⌥') out.alt = true; else if (c === '⇧') out.shift = true; else break
  }
  const key = rest.toLowerCase()
  if (!key) return null
  out.key = KEY_ALIASES[key] ?? key
  return out
}

const KEY_LABELS: Record<string, string> = { ' ': 'Space', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }

/** Tecla normalizada de um evento (letras e dígitos pelo `code`, para não depender do layout nem do ⌥). */
function eventKey(event: Pick<KeyboardEvent, 'key' | 'code'>): string | null {
  if (/^Key[A-Z]$/.test(event.code ?? '')) return event.code.slice(3).toLowerCase()
  if (/^Digit\d$/.test(event.code ?? '')) return event.code.slice(5)
  const key = event.key
  if (!key || ['Meta', 'Control', 'Alt', 'Shift', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified', 'Process'].includes(key)) return null
  return KEY_ALIASES[key.toLowerCase()] ?? key.toLowerCase()
}

/** Atalho gravado a partir de um evento, no formato da tabela (‘⌃⌥⇧⌘K’); null para modificador sozinho. */
export function comboFromEvent(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, mac = isMacPlatform()): string | null {
  const key = eventKey(event)
  if (!key) return null
  // Fora do macOS, Ctrl faz o papel do ⌘ (como no resto do app); ⌃ só existe no Mac.
  const command = mac ? event.metaKey : event.ctrlKey || event.metaKey
  const control = mac && event.ctrlKey
  const label = KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : /^f\d{1,2}$/.test(key) ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1))
  return `${control ? '⌃' : ''}${event.altKey ? '⌥' : ''}${event.shiftKey ? '⇧' : ''}${command ? '⌘' : ''}${label}`
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')
}

/** O evento aciona esse atalho? ⌘ aceita Ctrl (mesmo comportamento do keydown antigo); ⌃ exige Ctrl sem ⌘. */
export function matchesCombo(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, combo: string): boolean {
  const want = parseCombo(combo)
  if (!isMacPlatform() && 'getModifierState' in event && (event as KeyboardEvent).getModifierState('AltGraph')) return false // AltGr is text input on Windows.
  if (!want) return false
  if (eventKey(event) !== want.key) return false
  if (event.altKey !== want.alt || event.shiftKey !== want.shift) return false
  if (want.ctrl) return event.ctrlKey && !event.metaKey && !want.mod
  if (want.mod) return event.metaKey || event.ctrlKey
  return !event.metaKey && !event.ctrlKey
}

/** Primeiro comando regravável (ou não) cujo atalho efetivo casa com o evento. */
export function findShortcutHit(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, overrides: ShortcutOverrides | undefined = overridesSource()): { id: string; slot: number } | null {
  for (const id of REBINDABLE_IDS) {
    const keys = effectiveKeys(id, overrides)
    for (let slot = 0; slot < keys.length; slot++) if (matchesCombo(event, keys[slot])) return { id, slot }
  }
  return null
}

/** Formato do Electron (‘CmdOrCtrl+Shift+N’) para o menu nativo. */
export function toAccelerator(combo: string): string | null {
  const parsed = parseCombo(combo)
  if (!parsed) return null
  const names: Record<string, string> = { space: 'Space', tab: 'Tab', enter: 'Return', esc: 'Escape', '↑': 'Up', '↓': 'Down', '←': 'Left', '→': 'Right', '+': 'Plus', backspace: 'Backspace', delete: 'Delete' }
  const key = names[parsed.key] ?? (parsed.key.length === 1 ? parsed.key.toUpperCase() : /^f\d{1,2}$/.test(parsed.key) ? parsed.key.toUpperCase() : null)
  if (!key) return null
  return [parsed.mod ? 'CmdOrCtrl' : '', parsed.ctrl ? 'Ctrl' : '', parsed.alt ? 'Alt' : '', parsed.shift ? 'Shift' : '', key].filter(Boolean).join('+')
}

/** Acelerador por id de menu para os atalhos personalizados (ids sem personalização ficam de fora). */
export function menuAccelerators(overrides: ShortcutOverrides | undefined = overridesSource()): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of MENU_SHORTCUT_IDS) {
    if (!isCustomized(id, overrides)) continue
    const accelerator = toAccelerator(effectiveKeys(id, overrides)[0] ?? '')
    if (accelerator) out[id] = accelerator
  }
  return out
}

/** null = pode usar; caso contrário o motivo (chave estável para a interface). */
export function validateCombo(combo: string): 'empty' | 'needs-modifier' | 'bad-key' | null {
  const parsed = parseCombo(combo)
  if (!parsed) return 'empty'
  if (['esc', 'enter', 'tab', 'backspace', 'delete', 'space'].includes(parsed.key) && !parsed.mod && !parsed.ctrl) return 'needs-modifier'
  // Sem ⌘ ou ⌃, a tecla digitaria um caractere (⌥ gera símbolos; ⇧ gera maiúsculas).
  if (!parsed.mod && !parsed.ctrl && !/^f\d{1,2}$/.test(parsed.key)) return 'needs-modifier'
  if (parsed.key === 'esc') return 'bad-key'
  return null
}

/** Combinações que o macOS (ou o VoiceOver) reserva: o app quase nunca as recebe. */
export const RESERVED_COMBOS: { combo: string; reason: [string, string] }[] = [
  { combo: '⌃Espaço', reason: ['trocar a fonte de entrada do teclado', 'switches the keyboard input source'] },
  { combo: '⌘Space', reason: ['Spotlight', 'Spotlight'] },
  { combo: '⌘⌥Space', reason: ['busca do Finder', 'Finder search'] },
  { combo: '⌃⌘Space', reason: ['seletor de emojis', 'emoji picker'] },
  { combo: '⌘Tab', reason: ['trocar de app', 'app switcher'] },
  { combo: '⇧⌘Tab', reason: ['trocar de app (inverso)', 'app switcher (reverse)'] },
  { combo: '⌘`', reason: ['alternar janelas do app', 'cycle app windows'] },
  { combo: '⌘Q', reason: ['encerrar o app', 'quit the app'] },
  { combo: '⌘H', reason: ['ocultar o app', 'hide the app'] },
  { combo: '⌘M', reason: ['minimizar a janela', 'minimize the window'] },
  { combo: '⌥⌘Esc', reason: ['forçar encerramento', 'force quit'] },
  { combo: '⌃⌘Q', reason: ['bloquear a tela', 'lock screen'] },
  { combo: '⌥⌘D', reason: ['mostrar/ocultar o Dock', 'show/hide the Dock'] },
  { combo: '⇧⌘3', reason: ['captura de tela', 'screenshot'] },
  { combo: '⇧⌘4', reason: ['captura de tela', 'screenshot'] },
  { combo: '⇧⌘5', reason: ['captura de tela', 'screenshot'] },
  { combo: '⌘F5', reason: ['ligar/desligar o VoiceOver', 'toggle VoiceOver'] },
  { combo: '⌃↑', reason: ['Mission Control', 'Mission Control'] },
  { combo: '⌃↓', reason: ['Exposé do app', 'App Exposé'] },
  { combo: '⌃←', reason: ['mudar de Espaço', 'switch Space'] },
  { combo: '⌃→', reason: ['mudar de Espaço', 'switch Space'] },
]

export type ComboConflict =
  | { level: 'block'; kind: 'app' | 'editor'; with: string; id: string }
  | { level: 'warn'; kind: 'context'; with: string; id: string }
  | { level: 'warn'; kind: 'reserved'; with: string }

const APP_AREAS: ShortcutArea[] = ['navigation', 'windows', 'daily', 'view']
const CONTEXT_AREAS: ShortcutArea[] = ['database', 'board', 'preview', 'search']

/**
 * Conflitos de uma combinação candidata para (comando, posição):
 * – bloqueia se já pertence a outro comando do app ou ao editor (o `keydown` do app roubaria a tecla);
 * – avisa se é reservada pelo macOS/VoiceOver (⌃⌥ + qualquer tecla é o prefixo do VoiceOver) ou se só vale em outro contexto (tabela, lousa…).
 */
export function findConflict(id: string, slot: number, combo: string, locale: Locale, overrides: ShortcutOverrides | undefined = overridesSource()): ComboConflict | null {
  const want = canonicalCombo(combo)
  // Voltar ao padrão do próprio comando nunca é conflito.
  if (defaultKeys(id).some(key => canonicalCombo(key) === want)) return null
  let context: ComboConflict | null = null
  for (const def of SHORTCUTS) {
    if (def.scope === 'global' && def.area !== 'capture') continue
    const keys = effectiveKeys(def.id, overrides)
    for (let index = 0; index < keys.length; index++) {
      if (def.id === id && index === slot) continue
      if (canonicalCombo(keys[index]) !== want) continue
      const name = shortcutLabel(def, locale)
      if (def.area === 'editor') return { level: 'block', kind: 'editor', with: name, id: def.id }
      if (APP_AREAS.includes(def.area) || def.area === 'capture') return { level: 'block', kind: 'app', with: name, id: def.id }
      if (CONTEXT_AREAS.includes(def.area) && !context) context = { level: 'warn', kind: 'context', with: name, id: def.id }
    }
  }
  const parsed = parseCombo(combo)
  for (const item of RESERVED_COMBOS) if (canonicalCombo(item.combo) === want) return { level: 'warn', kind: 'reserved', with: translate(locale, item.reason[0], item.reason[1]) }
  if (parsed?.ctrl && parsed.alt) return { level: 'warn', kind: 'reserved', with: translate(locale, 'o prefixo do VoiceOver (⌃⌥)', 'the VoiceOver modifier (⌃⌥)') }
  return context
}

/** Novo mapa de personalizações com `combo` na posição `slot` de `id` (null = volta ao padrão naquela posição). */
export function withOverride(overrides: ShortcutOverrides | undefined, id: string, slot: number, combo: string | null): ShortcutOverrides {
  const base = defaultKeys(id)
  const next = { ...(overrides ?? {}) }
  if (!SHORTCUTS.find(item => item.id === id)?.rebind || slot < 0 || slot >= base.length) return next
  const keys = effectiveKeys(id, overrides)
  keys[slot] = combo ?? base[slot]
  if (keys.every((key, index) => key === base[index])) delete next[id]
  else next[id] = keys
  return next
}
