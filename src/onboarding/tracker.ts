// Barramento local mínimo: a store registra o tratador; quem sabe do evento só chama `trackStep` (sem ciclo de imports).
import type { StepId } from './model.ts'
let handler: ((id: StepId) => void) | null = null
export function setStepTracker(next: ((id: StepId) => void) | null) { handler = next }
export function trackStep(id: StepId) { try { handler?.(id) } catch { /* marcar passo nunca pode quebrar a ação do usuário */ } }
