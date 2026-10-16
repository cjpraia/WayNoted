const MAX_HTML = 80_000
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">`
/** Used only with iframe sandbox="allow-scripts" (no allow-same-origin). */
export function localHtmlDocument(html: string): string { return `${CSP}${html.slice(0, MAX_HTML)}` }
