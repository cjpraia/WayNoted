// Texto de apresentação dos resultados: onde a consulta foi encontrada.
import type { SearchSegment, SegmentContext } from './extract.ts'

type T = (pt: string, en: string, vars?: Record<string, string | number>) => string

function contextName(context: SegmentContext, t: T): string {
  switch (context.type) {
    case 'toggle': return t('Toggle', 'Toggle')
    case 'toggleHeading': return t('Título recolhível', 'Toggle heading')
    case 'callout': return t('Destaque', 'Callout')
    case 'column': return t('Coluna', 'Column')
    case 'quote': return t('Citação', 'Quote')
    case 'synced': return t('Bloco sincronizado', 'Synced block')
    case 'heading': return t('Seção', 'Section')
    default: return ''
  }
}

/** Caminho de contêineres: "Toggle › Detalhes › Coluna". */
export function contextPath(path: SegmentContext[] | undefined, t: T): string {
  return (path ?? []).flatMap(context => [contextName(context, t), context.label].filter(Boolean)).join(' › ')
}

/** "em Toggle › Detalhes", "no PDF contrato.pdf, pág. 3", "em Status"… ou '' para o corpo simples. */
export function locationLabel(segment: SearchSegment | undefined, t: T): string {
  if (!segment) return ''
  const where = contextPath(segment.path, t)
  const inside = where ? ` · ${t('em {path}', 'in {path}', { path: where })}` : ''
  switch (segment.kind) {
    case 'pdf': return t('no PDF {file}, pág. {page}', 'in PDF {file}, p. {page}', { file: segment.file ?? '', page: segment.pdfPage ?? 1 }) + inside
    case 'image': return t('no texto da imagem {file}', 'in image text {file}', { file: segment.file ?? '' }) + inside
    case 'caption': return t('na legenda de {file}', 'in caption of {file}', { file: segment.file || t('mídia', 'media') }) + inside
    case 'file': return t('no anexo {file}', 'in attachment {file}', { file: segment.file ?? '' }) + inside
    case 'comment': return t('em comentário', 'in comment')
    case 'property': return t('em {name}', 'in {name}', { name: segment.propertyName ?? t('propriedade', 'property') })
    default: return where ? t('em {path}', 'in {path}', { path: where }) : ''
  }
}
