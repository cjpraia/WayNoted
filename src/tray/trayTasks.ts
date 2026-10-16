// Liga o índice de tarefas ao menu da barra de menus (C3a). O renderer só ENVIA um retrato (somente leitura);
// concluir pelo menu volta como evento e passa pela mesma rota da Caixa de tarefas (`completeTask`), com as guardas
// de página bloqueada/protegida/removida. O retrato novo sai em até ~300 ms após qualquer mudança de tarefa.
import { api, getState, subscribe } from '../store.ts'
import { t } from '../i18n.ts'
import { currentBuckets, currentTasks, subscribeTasks } from '../tasks/taskIndex.ts'
import { completeTask } from '../tasks/taskActions.ts'
import { localDay } from '../templates/dates.ts'
import { showUndoToast } from '../components/ui/toastQueue.ts'
import { buildTraySnapshot, type TraySnapshot } from './snapshot.ts'

interface TrayBridge {
  traySetTasks?: (snapshot: TraySnapshot) => Promise<unknown>
  trayTaskResult?: (result: { id: string; ok: boolean; message?: string }) => Promise<unknown>
  onTrayCompleteTask?: (handler: (id: string) => void) => () => void
}
const bridge = () => api as unknown as TrayBridge
const DEBOUNCE_MS = 250

export function startTrayTasks(): () => void {
  const trayApi = bridge()
  if (typeof trayApi.traySetTasks !== 'function') return () => {}
  let timer: ReturnType<typeof setTimeout> | null = null
  let last = ''
  const send = (force = false) => {
    timer = null
    const state = getState()
    if (!state.ready) return
    const snapshot = buildTraySnapshot(currentBuckets(localDay()), state.pages)
    const json = JSON.stringify(snapshot)
    if (!force && json === last) return
    last = json
    void Promise.resolve(trayApi.traySetTasks?.(snapshot)).catch(() => { last = '' })
  }
  const schedule = () => { if (!timer) timer = setTimeout(() => send(), DEBOUNCE_MS) }
  const stopTasks = subscribeTasks(schedule)
  const stopStore = subscribe(schedule)
  const midnight = setInterval(schedule, 60_000) // virada do dia: "hoje" e "atrasadas" mudam sem nenhuma edição
  const stopComplete = trayApi.onTrayCompleteTask?.(id => {
    const item = currentTasks().find(task => task.key === id)
    const fail = (message: string) => { void Promise.resolve(trayApi.trayTaskResult?.({ id, ok: false, message })).catch(() => {}) }
    if (!item) { fail(t('A tarefa não está mais na lista.', 'The task is no longer on the list.')); send(true); return }
    void completeTask(item, true)
      .then(result => { if (result === 'checked') showUndoToast(t('Concluída: {title}', 'Completed: {title}', { title: item.title || t('Sem título', 'Untitled') }), () => void completeTask(item, false).catch(() => {}), t('Desfazer', 'Undo')) })
      .catch(cause => fail(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => send(true))
  })
  schedule()
  return () => { if (timer) clearTimeout(timer); clearInterval(midnight); stopTasks(); stopStore(); stopComplete?.() }
}
