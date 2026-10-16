// Barramento do diálogo de perguntas {{pergunta:…}}: o código de aplicação pede, o <TemplatePromptHost/> mostra.
import type { TemplateQuestion } from './variables.ts'

export interface PromptRequest { questions: TemplateQuestion[]; title?: string; resolve: (answers: Record<string, string> | null) => void }
let listener: ((request: PromptRequest | null) => void) | null = null

export function subscribeTemplatePrompt(fn: (request: PromptRequest | null) => void): () => void {
  listener = fn
  return () => { if (listener === fn) listener = null }
}

/** Pergunta ao usuário. `null` = cancelou (nada deve ser aplicado). Sem diálogo montado, usa os padrões. */
export function askTemplateQuestions(questions: TemplateQuestion[], title?: string): Promise<Record<string, string> | null> {
  const defaults = () => Object.fromEntries(questions.map(q => [q.label, q.default]))
  if (!questions.length) return Promise.resolve({})
  if (!listener) return Promise.resolve(defaults())
  return new Promise(resolve => listener!({ questions, title, resolve }))
}
