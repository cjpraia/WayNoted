// Configurações → Produtividade: registro local, meta opcional, início da semana e apagar histórico.
import { useState } from 'react'
import { actions, productivity, useStore } from '../../store'
import { useI18n } from '../../i18n'
import { cancelBackfill } from '../../activity/session'
import type { ProductivitySettings as Prefs } from '../../types'
import { Select } from '../ui/Select'
import { Button } from '../ui/Button'

export function ProductivitySettings() {
  const { settings } = useStore()
  const { t } = useI18n()
  const prefs = settings.productivity ?? {}
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState('')
  const update = (patch: Prefs) => actions.updateSettings({ productivity: { ...prefs, ...patch } })
  const enabled = prefs.enabled !== false
  const clear = async () => {
    try { cancelBackfill(); await productivity.clear(); setStatus(t('Histórico de atividade apagado.', 'Activity history deleted.')) }
    catch (error) { setStatus(error instanceof Error && error.message.includes('VAULT_LOCKED') ? t('Desbloqueie o espaço para apagar o histórico.', 'Unlock the workspace to delete the history.') : t('Não foi possível apagar o histórico.', 'Could not delete the history.')) }
    finally { setConfirming(false) }
  }
  return <>
    <h2 className="st-h">{t('Produtividade', 'Productivity')}</h2>
    <p className="st-hint st-mb">{t('Tudo fica neste computador; só contadores, nunca o conteúdo. Cada espaço tem o próprio registro, cifrado junto com o espaço quando ele tem senha.', 'Everything stays on this computer; only counters, never your content. Each workspace has its own record, encrypted with the workspace when it has a password.')}</p>
    <div className="st-row st-row-between">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label className="st-label" htmlFor="st-pd-enabled">{t('Registrar atividade', 'Track activity')}</label>
        <span className="st-hint">{t('Conta palavras escritas, edições, páginas criadas e tarefas concluídas por dia. Desligado, nada novo é registrado.', 'Counts words written, edits, pages created and tasks completed per day. When off, nothing new is recorded.')}</span>
      </div>
      <input id="st-pd-enabled" type="checkbox" checked={enabled} onChange={e => { update({ enabled: e.target.checked }); if (!e.target.checked) { cancelBackfill(); productivity.disable() } }} />
    </div>
    <div className="st-row st-row-col">
      <label className="st-label" htmlFor="st-pd-goal">{t('Meta diária de palavras (opcional)', 'Daily word goal (optional)')}</label>
      <input id="st-pd-goal" className="st-input" type="number" min={0} max={100000} step={50} inputMode="numeric" placeholder={t('Sem meta', 'No goal')} value={prefs.dailyGoal || ''}
        onChange={e => { const value = Math.max(0, Math.min(100000, Math.floor(Number(e.target.value) || 0))); update({ dailyGoal: value || undefined }) }} />
      <span className="st-hint">{t('Só um anel de progresso no painel. Sem lembretes nem cobranças.', 'Just a progress ring on the dashboard. No reminders, no nagging.')}</span>
    </div>
    <div className="st-row st-row-col">
      <label className="st-label" htmlFor="st-pd-week">{t('Início da semana', 'Week starts on')}</label>
      <Select id="st-pd-week" value={prefs.weekStart ?? 'auto'} onChange={e => update({ weekStart: e.target.value as Prefs['weekStart'] })}>
        <option value="auto">{t('Conforme o idioma', 'Follow language')}</option>
        <option value="sunday">{t('Domingo', 'Sunday')}</option>
        <option value="monday">{t('Segunda-feira', 'Monday')}</option>
      </Select>
    </div>
    <div className="st-row st-row-col">
      <span className="st-label">{t('Apagar histórico de atividade', 'Delete activity history')}</span>
      <span className="st-hint">{t('Remove todos os contadores deste espaço. Suas páginas não são afetadas.', 'Removes every counter of this workspace. Your pages are not affected.')}</span>
      {confirming ? <div role="alertdialog" className="st-confirm" aria-label={t('Confirmar exclusão do histórico', 'Confirm history deletion')} style={{ marginTop: 'var(--space-2)' }}>
        <Button autoFocus onClick={() => setConfirming(false)}>{t('Cancelar', 'Cancel')}</Button>
        <Button variant="danger" onClick={() => void clear()}>{t('Apagar histórico', 'Delete history')}</Button>
      </div> : <Button style={{ marginTop: 'var(--space-2)', alignSelf: 'flex-start' }} onClick={() => { setConfirming(true); setStatus('') }}>{t('Apagar histórico de atividade…', 'Delete activity history…')}</Button>}
      {status && <span className="st-hint" role="status">{status}</span>}
    </div>
  </>
}
