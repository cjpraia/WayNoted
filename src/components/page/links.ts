import PRODUCT from '../../../shared/product.json' with { type: 'json' }
import COMPAT from '../../../shared/compatibility.ts'
const schemes = [PRODUCT.protocol, COMPAT.previousProtocol, ...PRODUCT.protocolAliases].join("|")
export const localPageLink = new RegExp(`^(?:${schemes}):\\/\\/page\\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:#block=([a-z0-9_-]{1,128}))?$`, "i")
/** Nota diária por data (src/daily): abre ou cria a nota do dia. */
export const dailyNoteLink = new RegExp(`^(?:${schemes}):\\/\\/daily\\/(\\d{4}-\\d{2}-\\d{2})$`, "")
const protocols = new Set(['http:', 'https:', 'ftp:', 'ftps:', 'mailto:', 'tel:', 'callto:', 'sms:', 'cid:', 'xmpp:'])

/** Shared by visible and conversion editors so local links survive HTML round trips.
 * BlockNote 0.55 documents isAllowedUri but does not export it from its public entrypoint.
 * Parse URLs here instead of relying on an unavailable internal module.
 */
export function isEditorLink(href: string): boolean {
  if (localPageLink.test(href) || dailyNoteLink.test(href)) return true
  if (!href) return true
  try { return protocols.has(new URL(href, "https://workspace.invalid").protocol) }
  catch { return false }
}
export const editorLinks = { isValidLink: isEditorLink }
