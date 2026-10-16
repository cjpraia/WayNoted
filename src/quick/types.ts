import type { Locale } from '../localization'
import type { ThemeSetting } from '../types'

export interface QuickDestination { id: string; title: string; icon: string | null; database: boolean; path: string }
export interface QuickDestinationInfo { id: string; title: string; database: boolean; tags?: { id: string; name: string; options: string[] } | null; date?: { id: string; name: string } | null }
export interface QuickPrefill { text?: string; title?: string; sourceUrl?: string | null }
export interface QuickDraft { title?: string; body?: string; destination?: QuickDestination | null; tags?: string[]; date?: string; sourceUrl?: string | null }
export interface QuickInit { locale: Locale; theme: ThemeSetting; workspaceName: string; draft: QuickDraft; prefill: QuickPrefill | null; workspaceId: string; /** Espaço com senha bloqueado: só o rascunho (na memória) fica disponível. */ locked?: boolean }

/** Ponte da janela rápida (electron/quick-preload.cjs). */
export interface QuickApi {
  platform?: string
  init(): Promise<QuickInit>
  search(query: string): Promise<QuickDestination[]>
  destination(id: string): Promise<QuickDestinationInfo | null>
  /** `locked`: o espaço está bloqueado e o rascunho ficou só na memória do app (não foi a disco). */
  saveDraft(draft: QuickDraft): Promise<{ locked: boolean } | void>
  save(input: { title: string; blocks: unknown[]; destinationId: string | null; tags: string[]; date: string | null; /** Data completa (hora/repetição) vinda de "@amanhã às 9h". */ dateValue?: import('../types').DateValue; sourceUrl: string | null }): Promise<{ pageId: string; parentId: string; workspaceId: string }>
  close(): Promise<void>
  open(pageId: string): Promise<void>
  /** Ditado local (reconhecimento no próprio computador); a janela rápida só inicia, para, cancela e abre o painel de permissão. */
  dictationStart(input: { locale: Locale }): Promise<{ sessionId: number }>
  dictationStop(): Promise<void>
  dictationCancel(): Promise<void>
  onDictationEvent(handler: (event: import('../types').DictationEvent) => void): () => void
  openPrivacySettings(pane: 'microphone' | 'speech' | 'dictation'): Promise<void>
  onShow(handler: (payload: { prefill: QuickPrefill | null; workspaceId: string }) => void): () => void
}

/** Preferências de captura expostas à janela principal (electron/preload.cjs). */
export interface QuickCaptureSettings {
  shortcut: string
  captureShortcut: string
  showTray: boolean
  /** C3a: lista as tarefas de hoje/atrasadas no menu do ícone (padrão: ligado). */
  trayTasks: boolean
  /** C3a: mostra o número de tarefas ao lado do ícone (padrão: desligado). */
  trayCount: boolean
  openAtLogin: boolean
  loginItemSupported: boolean
  status: { shortcut?: 'ok' | 'busy' | 'off'; captureShortcut?: 'ok' | 'busy' | 'off' }
}
export interface QuickCaptureBridge {
  quickCaptureSettings?(): Promise<QuickCaptureSettings>
  /** Abre a janela de nota rápida (Home → Captura rápida). */
  showQuickCapture?(): Promise<boolean>
  /** Existe rascunho de captura pendente? (sem o texto) */
  quickDraftInfo?(): Promise<boolean>
  updateQuickCaptureSettings?(patch: Partial<Pick<QuickCaptureSettings, 'shortcut' | 'captureShortcut' | 'showTray' | 'trayTasks' | 'trayCount' | 'openAtLogin'>>): Promise<QuickCaptureSettings>
}

declare global {
  interface Window { quickApi?: QuickApi }
}
