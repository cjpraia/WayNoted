let loader: Promise<typeof import('mermaid').default> | null = null

export function loadLocalMermaid(): Promise<typeof import('mermaid').default> {
  loader ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: 10_000,
      flowchart: { htmlLabels: false },
    })
    return mermaid
  })
  return loader
}

export function checkLocalMermaidSource(source: string): void {
  if (!source.trim()) throw new Error('Empty Mermaid diagram')
  if (source.length > 10_000) throw new Error('Mermaid diagram exceeds 10,000 characters')
  // Diagrams are local. Even when rendered in a sandbox, external resources
  // must not be requested while Mermaid prepares the SVG in the app document.
  if (/https?:\/\/|data:|@import\b|url\s*\(/i.test(source)) throw new Error('External resources are unavailable in local diagrams')
}

export async function renderLocalMermaid(source: string, id: string): Promise<{ svg: string; diagramType: string }> {
  checkLocalMermaidSource(source)
  const mermaid = await loadLocalMermaid()
  const parsed = await mermaid.parse(source)
  if (!parsed) throw new Error('Invalid Mermaid diagram')
  const rendered = await mermaid.render(`workspace-mermaid-${id.replace(/[^a-z0-9_-]/gi, '-')}`, source)
  return { svg: rendered.svg, diagramType: rendered.diagramType }
}

export function isolatedMermaidDocument(svg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;padding:8px;box-sizing:border-box;overflow:auto;background:transparent}svg{max-width:100%;height:auto;display:block;margin:auto}</style></head><body>${svg}</body></html>`
}
