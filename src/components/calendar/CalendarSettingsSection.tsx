import PRODUCT from '../../../shared/product.json' with { type: 'json' }
// Configurações → Calendário: ativação, permissão do macOS e calendários escolhidos.
import { useI18n } from '../../i18n'
import { CalendarAccessPanel } from './CalendarAccessPanel'
import { updateCalendarSettings, useCalendarSettings } from './calendarState'
import { Select } from '../ui/Select'
import { DURATION_OPTIONS } from '../../tasks/taskCalendarCore'
import { RemindersSettingsSection } from '../../reminders/RemindersUi'

export function CalendarSettingsSection() {
  const { t } = useI18n()
  const settings = useCalendarSettings()
  const linked = Object.keys(settings.links ?? {}).length
  const scheduled = Object.keys(settings.taskLinks ?? {}).length
  return <>
    <h2 className="st-h">{t('Calendário', 'Calendar')}</h2>
    <p className="st-p">{t(`O ${PRODUCT.name} conversa somente com o app Calendário deste Mac (EventKit). Nenhuma conta é criada pelo ${PRODUCT.name} e nada é enviado a servidores; as contas que o Calendário já sincroniza continuam sob controle do macOS.`, `${PRODUCT.name} talks only to this Mac’s Calendar app (EventKit). ${PRODUCT.name} creates no accounts and sends nothing to servers; accounts Calendar already syncs remain under macOS control.`)}</p>
    <div className="st-row"><CalendarAccessPanel /></div>
    <div className="st-row st-row-col">
      <span className="st-label">{t('Eventos vinculados', 'Linked events')}</span>
      <span className="st-hint">{linked
        ? t(`{count} linha(s) com evento criado pelo ${PRODUCT.name}. Para remover um vínculo, use “Remover do Calendário” no menu da linha.`, `{count} row(s) with an event created by ${PRODUCT.name}. To remove a link, use “Remove from Calendar” in the row menu.`, { count: linked })
        : t('Clique com o botão direito numa linha com data na visualização Calendário e escolha “Adicionar ao Calendário”.', 'Right-click a dated row in a Calendar view and choose “Add to Calendar”.')}</span>
    </div>
    <div className="st-row st-row-col">
      <span className="st-label">{t('Tarefas agendadas', 'Scheduled tasks')}</span>
      <span className="st-hint">{t('Arraste uma tarefa para o painel de calendário (ou use o ícone de calendário na linha da tarefa) para criar um evento com link de volta. O evento vai para o calendário escolhido acima e acompanha a tarefa; nada é apagado sem perguntar.', 'Drag a task onto the calendar panel (or use the calendar icon on the task row) to create an event with a link back. The event goes to the calendar chosen above and follows the task; nothing is deleted without asking.')} {scheduled ? t('{count} tarefa(s) agendada(s).', '{count} task(s) scheduled.', { count: scheduled }) : ''}</span>
      <label className="npcal-field"><span className="npcal-label">{t('Duração padrão do evento', 'Default event length')}</span>
        <Select value={String(settings.taskDuration ?? 30)} onChange={event => updateCalendarSettings({ taskDuration: Number(event.target.value) })}>
          {DURATION_OPTIONS.map(minutes => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} min` : `${minutes / 60} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`}</option>)}
        </Select>
      </label>
    </div>
    <RemindersSettingsSection />
  </>
}
