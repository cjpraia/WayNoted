// Grava (com debounce) o ponto de retomada — página e bloco do cursor — para o cartão "Continuar" do Meu dia.
import { actions, getState } from '../store.ts'
import { nextResume } from './resume.ts'

let timer: ReturnType<typeof setTimeout> | undefined
export function trackResume(pageId: string, blockId: string | undefined) {
  clearTimeout(timer)
  timer = setTimeout(() => {
    try {
      const state = getState()
      const current = state.settings.onboarding?.resume
      const next = nextResume(current, pageId, blockId, Date.now())
      if (next !== current) actions.updateSettings({ onboarding: { ...state.settings.onboarding, resume: next } })
    } catch { /* retomada é só uma conveniência */ }
  }, 1500)
}
