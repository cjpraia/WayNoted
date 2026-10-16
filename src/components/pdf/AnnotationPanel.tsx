// Painel lateral "Anotações": lista por página, filtro por cor, busca, copiar como Markdown e inserir na página.
import { Copy, ListPlus, Search } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '../ui/Button'
import { ANN_COLORS, annotationLabel, colorLabel, filterAnnotations, groupByPage, oneLine, textualAnnotations, type AnnColor, type Annotation, type Translate } from './annotations'

export interface AnnotationPanelProps {
  t: Translate
  annotations: Annotation[]
  selectedId: string | null
  color: AnnColor | null
  onColor(color: AnnColor | null): void
  query: string
  onQuery(query: string): void
  onJump(annotation: Annotation): void
  onCopy(): void
  onInsert(): void
  canInsert: boolean
  formatDate(value: number): string
}

export function AnnotationPanel(p: AnnotationPanelProps) {
  const { t } = p
  const visible = useMemo(() => filterAnnotations(p.annotations, { color: p.color, query: p.query }), [p.annotations, p.color, p.query])
  const groups = useMemo(() => groupByPage(visible), [visible])
  const hasText = textualAnnotations(p.annotations).length > 0
  return (
    <aside className="pdf-panel" aria-label={t('Anotações', 'Annotations')}>
      <header className="pdf-panel-head">
        <h3>{t('Anotações', 'Annotations')}</h3>
        <span className="pdf-panel-count">{p.annotations.length}</span>
      </header>
      <label className="pdf-search">
        <Search size={14} strokeWidth={1.75} aria-hidden="true" />
        <input type="search" value={p.query} placeholder={t('Buscar nas anotações', 'Search annotations')} aria-label={t('Buscar nas anotações', 'Search annotations')} onChange={(event) => p.onQuery(event.target.value)} />
      </label>
      <div className="pdf-filter" role="group" aria-label={t('Filtrar por cor', 'Filter by color')}>
        {ANN_COLORS.map((c) => (
          <button key={c} type="button" className="pdf-swatch" data-color={c} aria-pressed={p.color === c} aria-label={colorLabel(c, t)} title={colorLabel(c, t)} onClick={() => p.onColor(p.color === c ? null : c)} />
        ))}
      </div>
      {groups.length === 0 ? (
        <p className="pdf-empty" role="status">{p.annotations.length ? t('Nenhuma anotação com esse filtro.', 'No annotations match this filter.') : t('Nenhuma anotação ainda. Ligue o modo Anotar e selecione um trecho do texto.', 'No annotations yet. Turn on Annotate and select some text.')}</p>
      ) : (
        <div className="pdf-list">
          {groups.map((group) => (
            <section key={group.page} aria-label={`${t('Página', 'Page')} ${group.page}`}>
              <h4>{t('Página', 'Page')} {group.page}</h4>
              <ul>
                {group.items.map((a) => (
                  <li key={a.id}>
                    <button type="button" className="pdf-item" data-color={a.color} aria-current={p.selectedId === a.id ? 'true' : undefined} onClick={() => p.onJump(a)}>
                      <span className="pdf-item-bar" aria-hidden="true" />
                      <span className="pdf-item-body">
                        <span className="pdf-item-meta">{annotationLabel(a, t)} · {colorLabel(a.color, t)} · {p.formatDate(a.updated)}</span>
                        {a.quote && <span className="pdf-item-quote">{oneLine(a.quote)}</span>}
                        {a.text && <span className="pdf-item-text">{oneLine(a.text)}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <footer className="pdf-panel-foot">
        <Button onClick={p.onCopy} disabled={!hasText}><Copy size={14} strokeWidth={1.75} /> {t('Copiar destaques como Markdown', 'Copy highlights as Markdown')}</Button>
        <Button onClick={p.onInsert} disabled={!hasText || !p.canInsert}><ListPlus size={14} strokeWidth={1.75} /> {t('Inserir destaques na página', 'Insert highlights into the page')}</Button>
      </footer>
    </aside>
  )
}
