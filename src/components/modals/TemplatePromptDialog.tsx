// Diálogo simples das perguntas {{pergunta:Texto|padrão}} ao aplicar um modelo. docs/USAGE.md
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { useModalFocus } from '../../a11y/useModalFocus'
import { DialogActions } from '../ui/DialogActions'
import { subscribeTemplatePrompt, type PromptRequest } from '../../templates/promptBus'
import type { TemplateQuestion } from '../../templates/variables'
import '../../templates/templates.css'

export function TemplatePromptDialog({ questions, title, onSubmit, onCancel }: { questions: TemplateQuestion[]; title?: string; onSubmit: (answers: Record<string, string>) => void; onCancel: () => void }) {
  const { t } = useI18n()
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(questions.map(q => [q.label, q.default])))
  const first = useRef<HTMLInputElement>(null)
  const form = useRef<HTMLFormElement>(null)
  useModalFocus(form, { initial: () => first.current })
  useEffect(() => { first.current?.select() }, [])
  const submit = () => onSubmit(values)
  return <div className="tpl-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}>
    <form ref={form} className="tpl-dialog" role="dialog" aria-modal="true" aria-label={t('Preencher o modelo', 'Fill in the template')}
      onSubmit={event => { event.preventDefault(); submit() }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onCancel() } }}>
      <h3>{title ?? t('Preencher o modelo', 'Fill in the template')}</h3>
      <p className="tpl-hint">{t('O modelo faz perguntas antes de ser aplicado. Cancelar não cria nem altera nada.', 'This template asks a few questions before it is applied. Cancelling creates and changes nothing.')}</p>
      {questions.map((question, index) => <label key={question.label} className="tpl-field">
        <span>{question.label}</span>
        <input ref={index === 0 ? first : undefined} className="tpl-input" value={values[question.label] ?? ''} onChange={event => setValues({ ...values, [question.label]: event.target.value })}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } }} />
      </label>)}
      <DialogActions confirmLabel={t('Aplicar modelo', 'Apply template')} onConfirm={submit} onCancel={onCancel} />
    </form>
  </div>
}

/** Montado uma vez em App.tsx: mostra o diálogo quando algum modelo faz perguntas. */
export function TemplatePromptHost() {
  const [request, setRequest] = useState<PromptRequest | null>(null)
  useEffect(() => subscribeTemplatePrompt(next => setRequest(next)), [])
  if (!request) return null
  const done = (answers: Record<string, string> | null) => { const current = request; setRequest(null); current.resolve(answers) }
  return <TemplatePromptDialog questions={request.questions} title={request.title} onSubmit={done} onCancel={() => done(null)} />
}
