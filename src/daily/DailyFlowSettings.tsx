// Configurações → Fluxo diário: modelo da nota, banco "Notas diárias", painel de calendário e semana.
import { useState } from 'react'
import { actions, useStore } from '../store'
import { t } from '../i18n'
import { availableTemplates } from '../components/page/templates'
import { dailyDatabaseId, openToday, updateDailySettings } from './dailyNotes'
import { DAILY_VARIABLES } from './dailyCore'
import { toggleCalendarPanel } from './CalendarPanel'
import { RolloverDialog, useRolloverCandidates } from './RolloverDialog'
import { Select } from '../components/ui/Select'
import { Button } from '../components/ui/Button'

export function DailyFlowSettings() {
  const { settings, pages } = useStore()
  const flow = settings.dailyFlow ?? {}
  const [message, setMessage] = useState('')
  const [rollover, setRollover] = useState(false)
  const overdue = useRolloverCandidates()
  const dbId = dailyDatabaseId()
  const db = dbId ? pages[dbId] : undefined
  const templates = availableTemplates()
  return <>
    <h2 className="st-h">{t('Fluxo diário', 'Daily flow')}</h2>
    <p className="st-hint st-mb">{t('Uma nota por dia, calendário lateral e tarefas com data reunidas em um só lugar. Tudo fica neste Mac.', 'One note per day, a side calendar and dated tasks in one place. Everything stays on this Mac.')}</p>

    <div className="st-row st-row-col">
      <label className="st-label" htmlFor="st-daily-template">{t('Modelo da nota diária', 'Daily note template')}</label>
      <Select id="st-daily-template" value={flow.templateId ?? ''} onChange={event => updateDailySettings({ templateId: event.target.value })}>
        <option value="">{t('Padrão do fluxo diário (agenda, tarefas do dia, notas)', 'Daily flow default (agenda, tasks for the day, notes)')}</option>
        {templates.map(template => <option key={template.id} value={template.id}>{template.title}</option>)}
      </Select>
      <span className="st-hint">{t('Variáveis aceitas no texto do modelo: ', 'Variables accepted in the template text: ')}{DAILY_VARIABLES.map(name => `{{${name}}}`).join(' · ')} {t('e também', 'and also')} {'{{hora}} · {{titulo}} · {{mes}} · {{ano}} · {{data+7d}} · {{usuario}} · {{cursor}}'}. {t('{{agenda}} e {{tarefas_do_dia}} sozinhos num parágrafo viram o bloco “Agenda de hoje” e a lista de tarefas do dia. Salve uma página como modelo pessoal (menu ••• da página) para usá-la aqui.', '{{agenda}} and {{tarefas_do_dia}} alone in a paragraph become the “Today’s agenda” block and the day’s task list. Save a page as a personal template (page ••• menu) to use it here.')}</span>
    </div>

    <div className="st-row st-row-col">
      <span className="st-label">{t('Banco “Notas diárias”', '“Daily notes” database')}</span>
      {db ? <span className="st-hint">{t('As notas ficam em “{title}” (propriedade Data; visualizações Tabela e Calendário).', 'Notes live in “{title}” (Date property; Table and Calendar views).', { title: db.title || t('Sem título', 'Untitled') })}</span>
        : <span className="st-hint">{t('Criado na raiz do espaço na primeira nota diária. Ele nunca é criado dentro de uma página protegida por senha.', 'Created at the top level of the workspace with the first daily note. It is never created inside a password-protected page.')}</span>}
      <div className="st-actions">
        <Button onClick={() => { setMessage(''); void openToday().then(() => actions.setSettingsOpen(false)).catch(cause => setMessage(cause instanceof Error ? cause.message : String(cause))) }}>{t('Abrir nota de hoje', 'Open today’s note')} <kbd>⌘⇧D</kbd></Button>
        {db && <Button onClick={() => { actions.setSettingsOpen(false); actions.openPage(db.id) }}>{t('Abrir banco', 'Open database')}</Button>}
      </div>
      {message && <span className="st-hint" role="alert" style={{ color: 'var(--danger)' }}>{message}</span>}
    </div>

    <div className="st-row st-row-col">
      <label className="st-label"><input type="checkbox" checked={!!flow.panelOpen} onChange={event => toggleCalendarPanel(event.target.checked)} /> {t('Mostrar painel de calendário à direita', 'Show calendar panel on the right')}</label>
      <span className="st-hint">{t('Também pelo botão de calendário na barra superior ou ⌘⇧C. A largura é ajustável arrastando a borda. Eventos do Calendário do macOS aparecem só se o acesso já foi autorizado em Configurações → Calendário.', 'Also via the calendar button in the top bar or ⌘⇧C. Drag the edge to resize. macOS Calendar events appear only if access was already granted in Settings → Calendar.')}</span>
    </div>

    <div className="st-row st-row-col">
      <label className="st-label"><input type="checkbox" checked={flow.inheritTaskDate !== false} onChange={event => updateDailySettings({ inheritTaskDate: event.target.checked })} /> {t('Tarefas em notas diárias herdam a data da nota', 'Tasks in daily notes inherit the note’s date')}</label>
      <span className="st-hint">{t('Um item de checklist sem data própria dentro de uma nota diária vale para o dia da nota (hoje, atrasada ou próxima). Uma menção de data ou lembrete no item tem prioridade. Subpáginas da nota não herdam.', 'A checklist item without its own date inside a daily note is due on the note’s day (today, overdue or upcoming). A date mention or reminder on the item takes priority. Subpages of the note do not inherit.')}</span>
    </div>

    <div className="st-row st-row-col">
      <label className="st-label"><input type="checkbox" disabled={flow.inheritTaskDate === false} checked={flow.showInheritedOverdue !== false} onChange={event => updateDailySettings({ showInheritedOverdue: event.target.checked })} /> {t('Tarefas atrasadas da nota diária: mostrar em Atrasadas', 'Overdue tasks from daily notes: show under Overdue')}</label>
      <div className="st-actions">
        <Button onClick={() => setRollover(true)}>{t('Trazer tarefas atrasadas para hoje…', 'Bring overdue tasks to today…')}{overdue.length > 0 ? ` (${overdue.length})` : ''}</Button>
      </div>
      <span className="st-hint">{t('Sempre manual: mostra a lista antes e pede confirmação.', 'Always manual: shows the list first and asks for confirmation.')}</span>
      {rollover && <RolloverDialog onClose={() => setRollover(false)} />}
    </div>

    <div className="st-row st-row-col">
      <label className="st-label" htmlFor="st-week-start">{t('Semana começa no', 'Week starts on')}</label>
      <Select id="st-week-start" value={flow.weekStart ?? 'auto'} onChange={event => updateDailySettings({ weekStart: event.target.value as 'auto' | 'sunday' | 'monday' })}>
        <option value="auto">{t('Conforme o idioma', 'Based on language')}</option>
        <option value="sunday">{t('Domingo', 'Sunday')}</option>
        <option value="monday">{t('Segunda-feira', 'Monday')}</option>
      </Select>
    </div>

    <div className="st-row st-row-col">
      <span className="st-label">{t('Datas em linguagem natural', 'Natural language dates')}</span>
      <span className="st-hint">{t('Em menções (@ ou /Data), células de data e na nota rápida (@amanhã, #tag): “amanhã às 9h”, “segunda que vem”, “dia 5”, “todo dia 5 às 9h”, “daqui a 2 semanas”, “5/11”, “fim do mês”, “em 3 dias úteis”.', 'In mentions (@ or /Date), date cells and quick notes (@tomorrow, #tag): “tomorrow at 9am”, “next monday”, “the 5th”, “every 5th at 9am”, “in 2 weeks”, “11/5”, “end of month”, “in 3 business days”.')}</span>
    </div>
  </>
}
