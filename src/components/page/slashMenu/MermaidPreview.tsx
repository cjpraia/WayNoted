import { useEffect, useState } from 'react'
import { useI18n } from '../../../i18n'
import { isolatedMermaidDocument, renderLocalMermaid } from './mermaidRuntime'

export function MermaidPreview({ id, source }: { id: string; source: string }) {
  const { t } = useI18n()
  const [document, setDocument] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    setDocument(''); setError('')
    void renderLocalMermaid(source, `${id}-${crypto.randomUUID()}`).then(({ svg }) => {
      if (current) setDocument(isolatedMermaidDocument(svg))
    }).catch((cause) => {
      if (current) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { current = false }
  }, [id, source])
  if (error) return <div role="alert">{t('Diagrama inválido ou recurso externo bloqueado', 'Invalid diagram or blocked external resource')}: {error}</div>
  if (!document) return <div role="status">{t('Renderizando diagrama local…', 'Rendering local diagram…')}</div>
  return <iframe title={t('Diagrama Mermaid local', 'Local Mermaid diagram')} sandbox="" referrerPolicy="no-referrer" srcDoc={document} style={{ width: '100%', minHeight: 280, border: 0 }} />
}
