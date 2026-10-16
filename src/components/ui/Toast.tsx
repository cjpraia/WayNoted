import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../../i18n'
import { dismissToast, useToasts, type ToastItem } from './toastQueue'
import './feedback.css'

function ToastView({ item }: { item: ToastItem }) {
  const { t } = useI18n()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = () => { stop(); timer.current = setTimeout(() => dismissToast(item.id), item.duration) }
  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  useEffect(() => { start(); return stop }, [item.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return <div className={`np-toast${item.tone === 'error' ? ' is-error' : ''}`} role={item.tone === 'error' ? 'alert' : undefined} onMouseEnter={stop} onMouseLeave={start}>
    <span className="np-toast-text">{item.message}</span>
    {item.onAction && <button type="button" className="np-toast-action" onClick={() => { dismissToast(item.id); item.onAction?.() }}>{item.actionLabel ?? t('Desfazer', 'Undo')}</button>}
    {item.onSecondary && <button type="button" className="np-toast-action" onClick={() => { dismissToast(item.id); item.onSecondary?.() }}>{item.secondaryLabel}</button>}
    <button type="button" className="np-toast-close" aria-label={t('Fechar aviso', 'Close notice')} onClick={() => dismissToast(item.id)}><X size={14} /></button>
  </div>
}

export function ToastHost() {
  const { t } = useI18n()
  const items = useToasts()
  // A região viva fica sempre montada: leitores de tela só anunciam o que entra numa região que já existia.
  return <div className="np-toasts" aria-live="polite" aria-relevant="additions text" role="region" aria-label={t('Avisos', 'Notices')}>{items.map(item => <ToastView key={item.id} item={item} />)}</div>
}
