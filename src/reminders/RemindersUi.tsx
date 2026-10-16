import PRODUCT from '../../shared/product.json' with { type: 'json' }
// Lembretes do macOS (C3b): seção em Configurações → Calendário, botão na linha da tarefa e o sincronizador em segundo plano.
// Opt-in: nada é sincronizado nem pedido ao macOS antes de ligar a opção.
import { useEffect, useState } from 'react'
import { BellRing, ExternalLink, RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import { useI18n } from '../i18n'
import { Button } from '../components/ui/Button'
import { Toggle } from '../components/ui/Toggle'
import { startTaskIndex, useTaskIndexVersion } from '../tasks/taskIndex'
import type { TaskItem } from '../tasks/taskCore'
import { disableReminders, enableReminders, isTaskMirrored, lastRemindersRun, remindersAvailable, remindersSettings, runRemindersSync, setTaskMirrored, updateRemindersSettings } from './remindersSync'
import './reminders.css'

const ACTION_LABEL: Record<string, [string, string]> = { created: ['Criado', 'Created'], pushed: ['Enviado', 'Sent'], pulled: ['Recebido', 'Received'], conflict: ['Conflito', 'Conflict'], unlinked: ['Desvinculado', 'Unlinked'], error: ['Erro', 'Error'] }

function permissionText(authorization: string, t: (pt: string, en: string) => string): string {
  if (authorization === 'denied') return t(`O acesso aos Lembretes foi negado. Ative o ${PRODUCT.name} em Ajustes do Sistema → Privacidade e Segurança → Lembretes.`, `Reminders access was denied. Enable ${PRODUCT.name} in System Settings → Privacy & Security → Reminders.`)
  if (authorization === 'restricted') return t('O acesso aos Lembretes está restrito neste Mac.', 'Reminders access is restricted on this Mac.')
  if (authorization === 'writeOnly') return t(`O ${PRODUCT.name} precisa de acesso total aos Lembretes para ler a conclusão.`, `${PRODUCT.name} needs full Reminders access to read completion.`)
  return t('Não foi possível obter acesso aos Lembretes.', 'Could not get Reminders access.')
}

export function RemindersSettingsSection() {
  const { t, locale } = useI18n()
  useStore()
  const settings = remindersSettings()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [denied, setDenied] = useState(false)
  if (!remindersAvailable()) return null
  const run = async (task: () => Promise<void>) => { setBusy(true); setMessage(''); try { await task() } catch (cause) { setMessage((cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) } finally { setBusy(false) } }
  const toggle = (on: boolean) => void run(async () => {
    setDenied(false)
    if (!on) { disableReminders(); return }
    const result = await enableReminders(settings.listName)
    if (result.authorization !== 'fullAccess') { setDenied(true); setMessage(permissionText(result.authorization, t)); return }
    await runRemindersSync()
  })
  const last = lastRemindersRun()
  const time = (at: number) => new Date(at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
  const mirrored = Object.keys(settings.links ?? {}).length
  return <>
    <h3 className="st-h">{t('Lembretes do macOS', 'macOS Reminders')}</h3>
    <p className="st-p">{t(`Espelha as tarefas que você escolher numa lista chamada “${PRODUCT.name}” do app Lembretes, com ida e volta: concluir, mudar o prazo ou o título num lado atualiza o outro. Se os dois lados mudarem a mesma coisa, vale a alteração mais recente e o conflito fica no registro. Tudo acontece neste Mac; o macOS só pergunta pela permissão quando você ligar a opção.`, `Mirrors the tasks you choose into a Reminders list named “${PRODUCT.name}”, both ways: completing, changing the due date or the title on one side updates the other. If both sides change the same thing, the most recent change wins and the conflict is logged. Everything happens on this Mac; macOS asks for permission only when you turn this on.`)}</p>
    <div className="st-row st-row-col">
      <Toggle label={t('Espelhar tarefas no app Lembretes', 'Mirror tasks to the Reminders app')} checked={settings.enabled} disabled={busy} onChange={toggle} />
      {denied && <Button onClick={() => void window.api?.openPrivacySettings?.('reminders')}><ExternalLink size={14} aria-hidden /> {t('Abrir Ajustes do Sistema', 'Open System Settings')}</Button>}
      {message && <p className="rm-error" role="alert">{message}</p>}
    </div>
    {settings.enabled && <>
      <div className="st-row st-row-col">
        <Toggle label={t('Incluir tarefas de hoje e atrasadas', 'Include tasks due today and overdue')} hint={t('Além das que você escolher com o ícone de sino na linha da tarefa.', 'In addition to the ones you pick with the bell icon on the task row.')} checked={!!settings.autoToday} onChange={value => updateRemindersSettings({ autoToday: value })} />
      </div>
      <div className="st-row st-row-col">
        <span className="st-label">{t('Lista no app Lembretes', 'Reminders list')}: <strong>{settings.listName}</strong></span>
        <span className="st-hint">{t('{count} tarefa(s) espelhada(s).', '{count} task(s) mirrored.', { count: mirrored })} {settings.lastSyncAt ? t('Última alteração sincronizada: {time}.', 'Last synced change: {time}.', { time: time(settings.lastSyncAt) }) : ''} {last ? t('Última verificação: {time}.', 'Last check: {time}.', { time: time(last.at) }) : ''}</span>
        {settings.lastError && <span className="rm-error" role="alert">{settings.lastError}</span>}
        <div><Button disabled={busy} onClick={() => void run(async () => { const result = await runRemindersSync(); if (result === null) setMessage(t(`Aguarde: o ${PRODUCT.name} ainda está lendo as páginas, ou a permissão mudou.`, `Please wait: ${PRODUCT.name} is still reading pages, or the permission changed.`)) })}><RefreshCw size={14} aria-hidden /> {t('Sincronizar agora', 'Sync now')}</Button></div>
        <span className="st-hint">{t('Remover uma tarefa do espelho (ou apagar o lembrete no app Lembretes) não apaga o outro lado. Edições de título feitas no Lembretes só voltam para itens de texto simples.', 'Removing a task from the mirror (or deleting the reminder in Reminders) does not delete the other side. Title edits made in Reminders only come back for plain-text items.')}</span>
      </div>
      <details className="st-row st-row-col rm-log">
        <summary>{t('Registro de sincronização ({count})', 'Sync log ({count})', { count: settings.log?.length ?? 0 })}</summary>
        {settings.log?.length ? <ul>{settings.log.map((entry, index) => <li key={index} className={`rm-log-${entry.action}`}>
          <time>{time(entry.at)}</time> <strong>{t(ACTION_LABEL[entry.action]?.[0] ?? entry.action, ACTION_LABEL[entry.action]?.[1] ?? entry.action)}</strong> {entry.title && <span>“{entry.title}”</span>} <span className="rm-detail">{entry.detail}</span>
        </li>)}</ul> : <p className="st-hint">{t('Nada registrado ainda.', 'Nothing logged yet.')}</p>}
      </details>
    </>}
  </>
}

/** Ícone de sino na linha da tarefa: espelha (ou deixa de espelhar) esta tarefa no app Lembretes. */
export function TaskReminderButton({ item }: { item: TaskItem }) {
  const { t } = useI18n()
  useStore()
  const settings = remindersSettings()
  if (!settings.enabled || !remindersAvailable() || item.done) return null
  const on = isTaskMirrored(item.key, settings, new Map([[item.key, item]]))
  const label = on ? t('Espelhada no app Lembretes — parar de espelhar', 'Mirrored in Reminders — stop mirroring') : t('Espelhar no app Lembretes', 'Mirror in Reminders')
  return <button type="button" className={`tk-sched tk-remind${on ? ' is-on' : ''}`} aria-pressed={on} aria-label={`${label}: ${item.title || t('Sem título', 'Untitled')}`} title={label} onClick={() => setTaskMirrored(item.key, !on)}>
    <BellRing size={14} aria-hidden />
  </button>
}

/** Montado uma vez em App: sincroniza ao abrir, ao voltar para a janela, a cada 2 minutos e depois de mudanças. */
export function RemindersSyncHost() {
  const state = useStore()
  useTaskIndexVersion()
  const enabled = !!state.settings.remindersSync?.enabled
  useEffect(() => { if (enabled) startTaskIndex() }, [enabled])
  useEffect(() => {
    if (!enabled || !state.ready) return
    const timer = window.setTimeout(() => void runRemindersSync().catch(() => {}), 3000)
    return () => window.clearTimeout(timer)
  }, [enabled, state.ready, state.pages, state.settings.remindersSync?.chosen, state.settings.remindersSync?.autoToday])
  useEffect(() => {
    if (!enabled) return
    const tick = () => void runRemindersSync().catch(() => {})
    const interval = window.setInterval(tick, 2 * 60_000)
    window.addEventListener('focus', tick)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', tick) }
  }, [enabled])
  return null
}
