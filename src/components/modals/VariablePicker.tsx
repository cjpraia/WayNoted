// Botão "Inserir variável": lista descritiva das {{variáveis}} com a prévia do resultado de hoje. docs/USAGE.md
import { useEffect, useMemo, useRef, useState } from 'react'
import { Braces } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Button } from '../ui/Button'
import { TEMPLATE_VARIABLES, previewVariable, variableName, variableToken } from '../../templates/variables'
import '../../templates/templates.css'

export type VariableScope = 'page' | 'row' | 'daily'

/** Variáveis que fazem sentido no contexto: `prop` só em modelo de linha; agenda/tarefas só na nota diária. */
export function variablesFor(scope: VariableScope) {
  return TEMPLATE_VARIABLES.filter(info => info.scope === 'all' || (info.scope === 'row' ? scope === 'row' : scope === 'daily'))
}

export function VariablePicker({ onPick, scope = 'page', label }: { onPick: (token: string) => void; scope?: VariableScope; label?: string }) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
  const list = useMemo(() => variablesFor(scope), [scope])
  // Painel fixo na janela (os painéis de configuração cortam conteúdo absoluto): abre abaixo, ou acima se faltar espaço.
  useEffect(() => {
    if (!open || !root.current) { setPlace(null); return }
    const rect = root.current.getBoundingClientRect()
    const width = Math.min(380, window.innerWidth * 0.8)
    const below = window.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    const useBelow = below >= 240 || below >= above
    const maxHeight = Math.max(160, Math.min(360, useBelow ? below : above))
    setPlace({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: useBelow ? rect.bottom + 4 : Math.max(8, rect.top - 4 - maxHeight), maxHeight })
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key, true) }
  }, [open])
  return <div className="tpl-picker" ref={root}>
    <Button aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}><Braces size={14} /> {label ?? t('Inserir variável', 'Insert variable')}</Button>
    {open && <div className="tpl-picker-panel" style={place ? { top: place.top, left: place.left, maxHeight: place.maxHeight } : { visibility: 'hidden' }} role="dialog" aria-label={t('Variáveis do modelo', 'Template variables')}>
      <header>{t('Prévia com a data e a hora de agora.', 'Preview using the current date and time.')}</header>
      {list.map(info => <button key={info.id} type="button" className="tpl-var" data-variable={info.id} onClick={() => { onPick(variableToken(info, locale)); setOpen(false) }}>
        <span className="tpl-var-head"><span className="tpl-var-name">{variableName(info, locale)}</span><span className="tpl-var-token">{variableToken(info, locale)}</span></span>
        <span className="tpl-var-desc">{info.desc[locale]}</span>
        <span className="tpl-var-preview">{t('Resultado', 'Result')}: <b>{previewVariable(info, locale)}</b></span>
      </button>)}
    </div>}
  </div>
}
