// Faz a caixa de edição inline herdar a tipografia, o espaçamento e a altura mínima da célula ancorada,
// para o texto não "pular" quando a edição abre.
export function applyAnchorTypography(el: HTMLElement, anchor: Element) {
  const cs = getComputedStyle(anchor)
  const rect = anchor.getBoundingClientRect()
  const fontSize = parseFloat(cs.fontSize) || 14
  const lh = cs.lineHeight === 'normal' ? fontSize * 1.4 : parseFloat(cs.lineHeight) || fontSize * 1.4
  const padTop = parseFloat(cs.paddingTop) || 0, padBottom = parseFloat(cs.paddingBottom) || 0
  let top = padTop
  // Célula de uma linha com conteúdo centralizado: o texto fica no meio da altura da célula.
  if (cs.alignItems === 'center' && rect.height <= lh + padTop + padBottom + 16) top = Math.max(padTop, (rect.height - lh) / 2)
  Object.assign(el.style, {
    fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: `${lh}px`, color: cs.color,
    paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, paddingTop: `${top}px`, paddingBottom: `${Math.max(padBottom, top)}px`,
    minHeight: `${rect.height}px`,
  })
}
