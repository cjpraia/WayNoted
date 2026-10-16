// Diff legível de alterações feitas por agentes (A1): "antes / depois" por bloco, mostrado no diálogo
// "Aprovar alteração de agente". Puro e sem dependências: texto linha a linha com contexto curto.
const MAX_LINES = 1500
const MAX_OPS = 400
const LINE_LIMIT = 300

const inline = value => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(inline).join('')
  if (!value || typeof value !== 'object') return ''
  if (value.type === 'tableContent') return (value.rows ?? []).map(row => (row.cells ?? []).map(inline).join(' | ')).join(' / ')
  if (typeof value.text === 'string') return value.text
  if (value.type === 'dateMention') return '@' + String(value.props?.date ?? '').slice(0, 10)
  return value.content ? inline(value.content) : ''
}
const PREFIX = { heading: '#', bulletListItem: '•', numberedListItem: '1.', toggleListItem: '▸', quote: '>', codeBlock: '</>' }

/** Uma linha por bloco (filhos recuados). Blocos sem texto viram `[tipo]`. */
function blockLines(blocks, depth = 0, out = []) {
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== 'object' || out.length > MAX_LINES) continue
    let text = ''
    if (block.type === 'canvas') text = '[Lousa · ' + (Array.isArray(block.props?.objects) ? block.props.objects.length : block.props?.objects ?? '?') + ' objetos]'
    else if (block.type === 'checkListItem') text = (block.props?.checked ? '[x] ' : '[ ] ') + inline(block.content)
    else {
      const body = inline(block.content)
      text = PREFIX[block.type] ? PREFIX[block.type] + ' ' + body : body || (block.type && block.type !== 'paragraph' ? '[' + block.type + ']' : '')
    }
    out.push('  '.repeat(depth) + text.replace(/\s+/g, ' ').trimEnd().slice(0, LINE_LIMIT))
    blockLines(block.children, depth + 1, out)
  }
  return out
}

/** LCS por programação dinâmica (limitada); devolve operações same/add/del. */
function diffLines(before, after) {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let endB = before.length, endA = after.length
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) { endB--; endA-- }
  const a = before.slice(start, endB), b = after.slice(start, endA)
  const ops = before.slice(0, start).map(text => ({ t: 'same', text }))
  if (a.length * b.length > 1_500_000) {
    for (const text of a) ops.push({ t: 'del', text })
    for (const text of b) ops.push({ t: 'add', text })
  } else {
    const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    let i = 0, j = 0
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { ops.push({ t: 'same', text: a[i] }); i++; j++ }
      else if (table[i + 1][j] >= table[i][j + 1]) ops.push({ t: 'del', text: a[i++] })
      else ops.push({ t: 'add', text: b[j++] })
    }
    while (i < a.length) ops.push({ t: 'del', text: a[i++] })
    while (j < b.length) ops.push({ t: 'add', text: b[j++] })
  }
  for (const text of before.slice(endB)) ops.push({ t: 'same', text })
  return ops
}

/** Remove trechos longos sem mudança, mantendo 2 linhas de contexto: { t: 'gap', count }. */
function withContext(ops, context = 2) {
  const keep = new Array(ops.length).fill(false)
  ops.forEach((op, index) => { if (op.t !== 'same') for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k++) keep[k] = true })
  const out = []
  let gap = 0
  ops.forEach((op, index) => {
    if (keep[index]) { if (gap) out.push({ t: 'gap', count: gap }); gap = 0; out.push(op) } else gap++
  })
  if (gap && out.length) out.push({ t: 'gap', count: gap })
  return out
}

/** Diff de duas listas de blocos. */
function diffBlocks(before, after) {
  const ops = diffLines(blockLines(before), blockLines(after))
  const added = ops.filter(op => op.t === 'add').length, removed = ops.filter(op => op.t === 'del').length
  const shown = withContext(ops)
  return { added, removed, ops: shown.slice(0, MAX_OPS), truncated: shown.length > MAX_OPS }
}

/** Diff de valores simples (propriedades de linha, título...): um par antes → depois por chave. */
function diffValues(before, after) {
  const show = value => value === undefined || value === null || value === '' ? '—' : typeof value === 'string' ? value : JSON.stringify(value)
  const ops = []
  for (const key of Object.keys(after)) {
    const left = show(before?.[key]), right = show(after[key])
    if (left === right) continue
    ops.push({ t: 'del', text: key + ': ' + left.slice(0, LINE_LIMIT) }, { t: 'add', text: key + ': ' + right.slice(0, LINE_LIMIT) })
  }
  return { added: ops.filter(op => op.t === 'add').length, removed: ops.filter(op => op.t === 'del').length, ops: ops.slice(0, MAX_OPS), truncated: ops.length > MAX_OPS }
}

module.exports = { blockLines, diffBlocks, diffValues, diffLines }
