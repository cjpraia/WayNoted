// Interruptor único do app (30 × 18). Linha inteira clicável com rótulo à esquerda e dica opcional.
import type { ReactNode } from 'react'

export function Toggle({ label, hint, checked, onChange, disabled, title }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange(value: boolean): void; disabled?: boolean; title?: string }) {
  return (
    <label className="np-switch-row" title={title}>
      <span className="np-switch-text"><span>{label}</span>{hint && <span className="np-switch-hint">{hint}</span>}</span>
      <input type="checkbox" role="switch" className="np-switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}
