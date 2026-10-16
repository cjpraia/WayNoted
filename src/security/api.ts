// Bridge to the Electron security IPC (electron/vault-ipc.cjs). Absent in the browser preview.
import type { Meta } from '../types'

export interface ProtectedRoot { rootId: string; pages: string[]; hideTitle: boolean; includeChildren: boolean; unlocked: boolean; pending: boolean; hasHint: boolean; createdAt: number }
export interface VaultStatus {
  workspaceId: string
  enabled: boolean
  locked: boolean
  migrating: boolean
  settings: { autoLockMinutes: number; lockOnSleep: boolean; touchId: boolean; locale: 'pt-BR' | 'en-US' }
  createdAt: number | null
  passwordChangedAt: number | null
  recoveryCreatedAt: number | null
  /** Optional password hint (plaintext metadata in vault.json, readable before unlocking). */
  hint: string | null
  algorithm: string
  kdf: string | null
  touchIdAvailable: boolean
  biometricKind?: 'windowsHello' | 'touchId'
  pages: { settings: { relockMinutes: number } | null; roots: ProtectedRoot[] } | null
}
export interface SecurityApi {
  vaultStatus(): Promise<VaultStatus>
  vaultActivity(): Promise<void>
  vaultUnlock(password: string): Promise<VaultStatus>
  vaultUnlockTouchID(): Promise<VaultStatus>
  vaultUnlockRecovery(recoveryKey: string, newPassword: string): Promise<VaultStatus>
  vaultEnable(password: string, options: { acknowledged: boolean; hint?: string }): Promise<{ recoveryKey: string; status: VaultStatus }>
  vaultDisable(password: string): Promise<VaultStatus>
  vaultChangePassword(oldPassword: string, newPassword: string, options?: { hint?: string | null }): Promise<VaultStatus>
  vaultRegenerateRecovery(password: string): Promise<{ recoveryKey: string }>
  vaultSetOptions(patch: { autoLockMinutes?: number; lockOnSleep?: boolean }): Promise<VaultStatus>
  vaultSetTouchID(enabled: boolean): Promise<VaultStatus>
  vaultLock(): Promise<boolean>
  pageLockInfo(): Promise<{ settings: { relockMinutes: number }; roots: ProtectedRoot[] }>
  pageProtect(pageId: string, password: string, options: { includeChildren: boolean; hideTitle: boolean; hint?: string }): Promise<Meta>
  pageLockHint(pageId: string): Promise<string | null>
  pageProtectChildren(pageId: string, pageIds?: string[]): Promise<{ meta: Meta; added: number }>
  pageUnlock(pageId: string, password: string): Promise<Meta>
  pageRelock(rootId: string): Promise<boolean>
  pageActivity(rootId: string): Promise<void>
  pageUnprotect(pageId: string, password: string): Promise<Meta>
  pageChangePassword(pageId: string, oldPassword: string, newPassword: string, options?: { hint?: string | null }): Promise<void>
  pageSetOptions(patch: { relockMinutes?: number }): Promise<{ relockMinutes: number }>
  pageSetHideTitle(pageId: string, hideTitle: boolean): Promise<Meta>
}

export function securityApi(): SecurityApi | null {
  const api = (window as unknown as { api?: Partial<SecurityApi> }).api
  return api?.vaultStatus ? api as SecurityApi : null
}

/** IPC errors arrive as "Error invoking remote method 'x': Error: CODE: pt / en". */
export function securityMessage(error: unknown, locale: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const text = raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  const match = /^[A-Z_]+: (.*?) \/ (.*)$/s.exec(text)
  return match ? (locale === 'en-US' ? match[2] : match[1]) : text
}
export function errorCode(error: unknown): string | null {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  return /(?:^|: )(VAULT_LOCKED|PAGE_LOCKED|WRONG_PASSWORD|WRONG_RECOVERY|TOO_MANY_ATTEMPTS|WEAK_PASSWORD|VAULT_BUSY|PARENT_LOCKED|HINT_HAS_PASSWORD|HINT_TOO_LONG)\b/.exec(raw)?.[1] ?? null
}
