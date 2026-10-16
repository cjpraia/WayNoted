/**
 * Abas por janela. `settings.openTabs` / `activeTabId` descrevem a sessão da janela PRINCIPAL do espaço
 * (a primeira aberta enquanto não havia outra) e são o que o app restaura ao reabrir. Janelas
 * secundárias (Nova janela, Mover aba para nova janela) começam sem abas gravadas e nunca as gravam:
 * o processo principal as remove do meta que elas carregam e devolve o valor do disco no que elas gravam.
 */
const TAB_KEYS = ['openTabs', 'activeTabId']

/** Cópia do meta sem as abas (o que uma janela secundária recebe ao carregar). */
export function stripWindowTabs(meta) {
  if (!meta || typeof meta !== 'object' || !meta.settings || typeof meta.settings !== 'object') return meta
  const settings = { ...meta.settings }
  for (const key of TAB_KEYS) delete settings[key]
  return { ...meta, settings }
}

/** Faz o meta proposto por uma janela secundária carregar as abas da base (nunca as altera no disco). */
export function shieldWindowTabs(proposed, base) {
  if (!proposed || typeof proposed !== 'object' || !proposed.settings || typeof proposed.settings !== 'object') return proposed
  const settings = { ...proposed.settings }
  for (const key of TAB_KEYS) {
    if (base?.settings && base.settings[key] !== undefined) settings[key] = base.settings[key]
    else delete settings[key]
  }
  return { ...proposed, settings }
}
