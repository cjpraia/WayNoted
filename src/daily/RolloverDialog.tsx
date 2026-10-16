// Diálogo "Trazer tarefas atrasadas para hoje": prévia da lista, escolha entre mover/copiar e confirmação.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useStore } from '../store'
import { t, useI18n } from '../i18n'
import { currentTasks, startTaskIndex, useTaskIndexVersion } from '../tasks/taskIndex'
import { rolloverCandidates } from './rollover'
import { formatShortDate, type DailyLocale } from './dailyCore'
import { today as todayDay } from './dailyNotes'
import './daily.css'
import { useModalFocus } from '../a11y/useModalFocus'
import { Button } from '../components/ui/Button'

/** Tarefas abertas de notas diárias anteriores (data herdada). */
export function useRolloverCandidates() {
  useStore(); useTaskIndexVersion()
  useEffect(() => startTaskIndex(), [])
  return rolloverCandidates(currentTasks(), todayDay())
}

export function RolloverDialog({ onClose }: { onClose: () => void }) {
  const { locale } = useI18n()
  const items = useRolloverCandidates()
  const [mode, setMode] = useState<'move' | 'copy'>('move')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<string>('')
  const box = useRef<HTMLDivElement>(null)
  useModalFocus(box, { initial: () => box.current })
  const run = () => {
    setBusy(true); setError('')
    void import('./rollover').then(module => module.rolloverTasks(items, mode)).then(outcome => {
      setResult(mode === 'move' ? t('Tarefas movidas para a nota de hoje: {n}.', 'Tasks moved to today’s note: {n}.', { n: outcome.done }) : t('Tarefas copiadas para a nota de hoje: {n}.', 'Tasks copied to today’s note: {n}.', { n: outcome.done }))
    }).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy(false))
  }
  return createPortal(<div className="dr-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <div className="dr-dialog" role="dialog" aria-modal="true" aria-labelledby="dr-title" ref={box} tabIndex={-1}>
      <header><h2 id="dr-title">{t('Trazer tarefas atrasadas para hoje', 'Bring overdue tasks to today')}</h2><button type="button" onClick={onClose} disabled={busy} aria-label={t('Fechar', 'Close')}><X size={18} /></button></header>
      {result ? <p role="status">{result}</p> : items.length ? <>
        <p>{t('Tarefas em aberto de notas diárias anteriores. Tarefas com data própria não são alteradas.', 'Open tasks from earlier daily notes. Tasks with their own date are not changed.')}</p>
        <ul className="dr-list" aria-label={t('Prévia', 'Preview')}>{items.slice(0, 200).map(item => <li key={item.key}><span>{item.title || t('Sem título', 'Untitled')}</span><small>{formatShortDate(item.due!, locale as DailyLocale)}</small></li>)}</ul>
        {items.length > 200 && <p className="dr-more">{t('e mais {n}…', 'and {n} more…', { n: items.length - 200 })}</p>}
        <div className="dr-modes" role="radiogroup" aria-label={t('Ação', 'Action')}>
          <label><input type="radio" name="dr-mode" checked={mode === 'move'} onChange={() => setMode('move')} /> {t('Mover (remove das notas antigas)', 'Move (remove from the old notes)')}</label>
          <label><input type="radio" name="dr-mode" checked={mode === 'copy'} onChange={() => setMode('copy')} /> {t('Copiar (mantém as originais)', 'Copy (keep the originals)')}</label>
        </div>
      </> : <p>{t('Nenhuma tarefa atrasada nas notas diárias.', 'No overdue tasks in daily notes.')}</p>}
      {error && <p className="dr-error" role="alert">{error}</p>}
      <div className="np-dialog-actions">
        <Button onClick={onClose} disabled={busy}>{result || !items.length ? t('Fechar', 'Close') : t('Cancelar', 'Cancel')}</Button>
        {!result && items.length > 0 && <Button variant="primary" onClick={run} disabled={busy}>{busy ? t('Trazendo…', 'Bringing…') : items.length === 1 ? t('Trazer 1 tarefa', 'Bring 1 task') : t('Trazer {n} tarefas', 'Bring {n} tasks', { n: items.length })}</Button>}
      </div>
    </div>
  </div>, document.body)
}
