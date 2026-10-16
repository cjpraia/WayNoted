// Parte pura de "começar bem" (Paradoxo do usuário ativo, Zeigarnik, Goal-Gradient, Peak-End). Sem store e sem React: testável.
// Estado em `settings.onboarding`; passos se marcam sozinhos por eventos locais (sem rede). docs/USAGE.md.
import type { OnboardingSettings } from '../types.ts'

export type StepId = 'page' | 'slash' | 'search' | 'database' | 'daily' | 'capture'
export interface StepDef { id: StepId; pt: string; en: string; keys: string }
export const STEPS: readonly StepDef[] = [
  { id: 'page', pt: 'Crie uma página', en: 'Create a page', keys: '⌘N' },
  { id: 'slash', pt: 'Use o menu /', en: 'Use the / menu', keys: '/' },
  { id: 'search', pt: 'Abra a busca', en: 'Open search', keys: '⌘K' },
  { id: 'database', pt: 'Crie um banco', en: 'Create a database', keys: '' },
  { id: 'daily', pt: 'Experimente a nota de hoje', en: 'Try today’s note', keys: '⌘⇧D' },
  { id: 'capture', pt: 'Capture algo', en: 'Capture something', keys: '⌥⌘N' },
]

export const isStepId = (value: unknown): value is StepId => STEPS.some(step => step.id === value)

export function markStep(state: OnboardingSettings | undefined, id: StepId, now = Date.now()): OnboardingSettings {
  if (state?.done?.[id]) return state
  return { ...state, done: { ...state?.done, [id]: now } }
}

export function onboardingProgress(state: OnboardingSettings | undefined): { done: number; total: number; complete: boolean } {
  const done = STEPS.filter(step => state?.done?.[step.id]).length
  return { done, total: STEPS.length, complete: done === STEPS.length }
}

/** O cartão fica visível até concluir ou dispensar. */
export const checklistVisible = (state: OnboardingSettings | undefined) => !state?.dismissed && !onboardingProgress(state).complete

export function dismissChecklist(state: OnboardingSettings | undefined): OnboardingSettings { return { ...state, dismissed: true } }
export function reopenChecklist(state: OnboardingSettings | undefined): OnboardingSettings { return { ...state, dismissed: false } }

// ---------- "Você sabia?" ----------
export interface Tip { id: string; pt: string; en: string }
export const TIPS: readonly Tip[] = [
  { id: 'peek', pt: 'Segure ⌘ ao clicar numa página para abri-la em outra aba.', en: 'Hold ⌘ while clicking a page to open it in a new tab.' },
  { id: 'daily', pt: 'Escreva “@amanhã” num item de checklist para agendá-lo.', en: 'Type “@tomorrow” in a checklist item to schedule it.' },
  { id: 'palette', pt: 'O ⌘K também executa comandos, não só busca páginas.', en: '⌘K also runs commands, not just page search.' },
  { id: 'slash', pt: 'Digite / numa linha vazia para ver todos os tipos de bloco.', en: 'Type / on an empty line to see every block type.' },
]

/** No máximo 1 por sessão, só se ligado e ainda não visto; escolhe a primeira não vista. */
export function pickTip(state: OnboardingSettings | undefined, shownThisSession: boolean): Tip | null {
  if (shownThisSession || state?.tipsOff) return null
  const seen = new Set(state?.tipsSeen ?? [])
  return TIPS.find(tip => !seen.has(tip.id)) ?? null
}
export function seeTip(state: OnboardingSettings | undefined, id: string): OnboardingSettings {
  return { ...state, tipsSeen: [...new Set([...(state?.tipsSeen ?? []), id])] }
}

// ---------- Dicas de estado vazio ----------
export type EmptyKind = 'page' | 'database'
export function emptyHint(kind: EmptyKind): { pt: string; en: string; keys: string } {
  return kind === 'database'
    ? { pt: 'Nova linha', en: 'New row', keys: 'N' }
    : { pt: 'Pressione / para blocos', en: 'Press / for blocks', keys: '/' }
}
