// Ações do Meu dia: planejar amanhã, prioridades da próxima semana, dispensar/reabrir primeiros passos.
import { actions, api, getState } from '../store.ts'
import { blocksToText } from '../components/page/util.ts'
import { ensureDailyNote, openRelativeDay } from '../daily/dailyNotes.ts'
import { cleanPriorities, mondayOf, nextMonday } from './day.ts'
import { dismissChecklist, reopenChecklist, seeTip } from './model.ts'

export const planTomorrow = () => openRelativeDay(1)

/** Cria as prioridades como tarefas na nota de segunda-feira da próxima semana. Devolve o id da nota. */
export async function planNextWeek(priorities: readonly string[], today: string): Promise<string | null> {
  const items = cleanPriorities(priorities)
  if (!items.length) return null
  const noteId = await ensureDailyNote(nextMonday(today))
  const current = (await api.loadDoc(noteId)) ?? []
  const added = items.map(text => ({ id: crypto.randomUUID(), type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text, styles: {} }], children: [] }))
  const next = [...current, ...added]
  await api.saveDoc(noteId, next as unknown[])
  actions.updatePage(noteId, { text: blocksToText(next), bodyText: blocksToText(next) }, false)
  actions.updateSettings({ onboarding: { ...getState().settings.onboarding, weekReviewed: mondayOf(today) } })
  return noteId
}

export const skipWeekReview = (today: string) => actions.updateSettings({ onboarding: { ...getState().settings.onboarding, weekReviewed: mondayOf(today) } })
export const dismissOnboarding = () => actions.updateSettings({ onboarding: dismissChecklist(getState().settings.onboarding) })
export const reopenOnboarding = () => actions.updateSettings({ onboarding: reopenChecklist(getState().settings.onboarding) })
export const dismissTip = (id: string) => actions.updateSettings({ onboarding: seeTip(getState().settings.onboarding, id) })
export const setTipsOff = (off: boolean) => actions.updateSettings({ onboarding: { ...getState().settings.onboarding, tipsOff: off } })
