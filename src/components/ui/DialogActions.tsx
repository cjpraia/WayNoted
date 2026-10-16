// Rodapé de diálogo: "Cancelar" (seguro, recebe o foco inicial) e a ação confirmadora à direita, com rótulo específico.
import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './Button'
import { t } from '../../i18n'

export function DialogActions({ confirmLabel, onConfirm, onCancel, destructive, disabled, busy, children }: { confirmLabel: ReactNode; onConfirm: () => void; onCancel: () => void; destructive?: boolean; disabled?: boolean; busy?: boolean; children?: ReactNode }) {
  const cancel = useRef<HTMLButtonElement>(null)
  // Foco no botão seguro: Enter por engano nunca confirma uma exclusão.
  useEffect(() => { if (destructive) cancel.current?.focus() }, [destructive])
  return (
    <div className="np-dialog-actions">
      {children}
      <Button ref={cancel} onClick={onCancel} disabled={busy}>{t('Cancelar', 'Cancel')}</Button>
      <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} disabled={disabled || busy}>{confirmLabel}</Button>
    </div>
  )
}
