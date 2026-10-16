import PRODUCT from '../../shared/product.json' with { type: 'json' }
// Shows the unlock screen before the workspace UI exists. While locked nothing from the
// workspace is loaded into the renderer; locking reloads the window (main process), so the
// previous UI and its memory are discarded.
import { useEffect, useState, type ReactNode } from 'react'
import { securityApi, type VaultStatus } from './api'
import { setCachePersistence } from '../search/cache'
import { UnlockScreen } from '../components/modals/UnlockScreen'

let lastPing = 0
function pingActivity() {
  const now = Date.now()
  if (now - lastPing < 20000) return
  lastPing = now
  void securityApi()?.vaultActivity().catch(() => {})
}

export function VaultGate({ children }: { children: ReactNode }) {
  const api = securityApi()
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!api) return
    let active = true
    api.vaultStatus().then(value => { if (active) setStatus(value) }).catch(cause => { if (active) setError(String(cause?.message ?? cause)) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    // While the workspace UI is not mounted there is nothing to save: answer the main
    // process' flush requests (lock, close, enable/disable) right away.
    if (!status?.enabled || !status.locked) return
    return (window as unknown as { api?: { onBeforeClose?(handler: () => Promise<void>): () => void } }).api?.onBeforeClose?.(async () => {})
  }, [status?.enabled, status?.locked])
  useEffect(() => {
    // The search cache lives in Chromium's IndexedDB, which is not encrypted by the app.
    if (status) setCachePersistence(!status.enabled)
    if (!status?.enabled || status.locked) return
    const events = ['keydown', 'pointerdown', 'wheel', 'pointermove'] as const
    events.forEach(name => window.addEventListener(name, pingActivity, { passive: true, capture: true }))
    return () => events.forEach(name => window.removeEventListener(name, pingActivity, { capture: true }))
  }, [status?.enabled, status?.locked])
  if (!api) return <>{children}</>
  if (error) return <div className="app-state" role="alert"><h1>{PRODUCT.name}</h1><p>{error}</p></div>
  if (!status) return <div className="app-state" role="status" aria-busy="true" />
  if (status.enabled && status.locked) return <UnlockScreen status={status} onUnlocked={setStatus} />
  return <>{children}</>
}
