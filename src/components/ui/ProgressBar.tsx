import './feedback.css'

/** Barra de progresso. `value` 0..1; sem `value` fica indeterminada. Com `onCancel` mostra "Cancelar" (operações > 1 s). */
export function ProgressBar({ value, label, onCancel, cancelLabel = 'Cancelar' }: { value?: number | null; label: string; onCancel?: () => void; cancelLabel?: string }) {
  const known = typeof value === 'number' && Number.isFinite(value)
  const pct = known ? Math.max(0, Math.min(1, value!)) * 100 : 0
  return <div className="np-progress">
    <div className="np-progress-head"><span>{label}{known ? ` · ${Math.round(pct)}%` : ''}</span>{onCancel && <button type="button" className="np-progress-cancel" onClick={onCancel}>{cancelLabel}</button>}</div>
    <div className={`np-progress-track${known ? '' : ' is-indeterminate'}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? Math.round(pct) : undefined}><div className="np-progress-fill" style={known ? { width: `${pct}%` } : undefined} /></div>
  </div>
}
