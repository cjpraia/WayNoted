// Peças do painel "Configurações da visualização": cabeçalho, linhas de 30 px, interruptores,
// rótulos de seção e menus de escolha ancorados à linha. Medidas em viewSettings.css.
import { useState, type ReactNode } from 'react'
import { Icon } from '../../ui/icons'
import { IconButton } from '../../ui/Button'
import { DbPopover } from '../ui/Popover'
import { t } from '../../../i18n'

export function PanelHeader({ title, main, onBack, onClose }: { title: string; main?: boolean; onBack?: () => void; onClose: () => void }) {
  return (
    <div className={`vs-header${main ? ' vs-header--main' : ''}`}>
      {onBack && <IconButton className="vs-header-btn" data-vs-nav label={t('Voltar', 'Back')} onClick={onBack}><Icon name="back" size={16} /></IconButton>}
      <span className="vs-header-title">{title}</span>
      <IconButton className="vs-close" label={t('Fechar', 'Close')} onClick={onClose}><Icon name="close" size={14} /></IconButton>
    </div>
  )
}

export function NavRow(props: {
  id?: string
  icon?: ReactNode
  label: ReactNode
  value?: ReactNode
  chevron?: 'right' | 'down' | false
  disabled?: boolean
  danger?: boolean
  active?: boolean
  title?: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const { chevron = 'right' } = props
  return (
    <button
      type="button"
      className={`vs-row${props.danger ? ' vs-row--danger' : ''}${props.active ? ' vs-row--active' : ''}`}
      data-vs-nav
      data-vs-id={props.id}
      disabled={props.disabled}
      title={props.title}
      onClick={props.onClick}
    >
      {props.icon && <span className="vs-row-icon">{props.icon}</span>}
      <span className="vs-row-label">{props.label}</span>
      {props.value !== undefined && props.value !== '' && <span className="vs-row-value">{props.value}</span>}
      {chevron && <span className="vs-row-chevron"><Icon name={chevron === 'down' ? 'chevron-down' : 'chevron-right'} size={16} /></span>}
    </button>
  )
}

export function ToggleRow({ id, icon, label, checked, disabled, onChange }: { id?: string; icon?: ReactNode; label: ReactNode; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="vs-row" data-vs-nav data-vs-id={id} disabled={disabled} onClick={() => onChange(!checked)}>
      {icon && <span className="vs-row-icon">{icon}</span>}
      <span className="vs-row-label">{label}</span>
      <span className={`vs-toggle${checked ? ' is-on' : ''}`} aria-hidden="true"><span /></span>
    </button>
  )
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: { label: string; onClick: () => void; disabled?: boolean } }) {
  return (
    <div className="vs-section">
      <span>{children}</span>
      {action && <button type="button" className="vs-section-action" data-vs-nav disabled={action.disabled} onClick={action.onClick}>{action.label}</button>}
    </div>
  )
}

export const Sep = () => <div className="vs-sep" role="separator" />

export interface Choice<T extends string> { value: T; label: string; description?: string; icon?: ReactNode; sub?: Choice<string>[]; disabled?: boolean }

/** Linha com valor atual; ao clicar abre um menu de escolhas ancorado a ela (chevron vira ⌄). */
export function ChoiceRow<T extends string>(props: { id?: string; icon?: ReactNode; label: ReactNode; value: T; choices: Choice<T>[]; disabled?: boolean; display?: string; onChange: (value: T, sub?: string) => void }) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const current = props.choices.find((choice) => choice.value === props.value)
  return (
    <>
      <NavRow
        id={props.id}
        icon={props.icon}
        label={props.label}
        value={props.display ?? current?.label ?? ''}
        chevron={el ? 'down' : 'right'}
        active={!!el}
        disabled={props.disabled}
        onClick={(e) => setEl(el ? null : e.currentTarget)}
      />
      {el && <ChoiceMenu anchor={el} choices={props.choices} value={props.value} onClose={() => setEl(null)} onPick={(value, sub) => { setEl(null); props.onChange(value as T, sub) }} />}
    </>
  )
}

function ChoiceMenu({ anchor, choices, value, subValue, onPick, onClose }: { anchor: HTMLElement; choices: Choice<string>[]; value: string; subValue?: string; onPick: (value: string, sub?: string) => void; onClose: () => void }) {
  const [sub, setSub] = useState<{ el: HTMLElement; choice: Choice<string> } | null>(null)
  return (
    <DbPopover anchor={anchor} ignore={anchor} placement="bottom-end" offset={2} onClose={onClose} className="vs-choice-pop" style={{ minWidth: Math.max(200, anchor.getBoundingClientRect().width - 24) }}>
      <div className="vs-choice" role="menu" onKeyDown={keyNav}>
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="menuitemradio"
            aria-checked={choice.value === value}
            data-vs-nav
            disabled={choice.disabled}
            className={`vs-choice-item${choice.value === value ? ' is-current' : ''}`}
            onClick={(e) => choice.sub ? setSub({ el: e.currentTarget, choice }) : onPick(choice.value)}
          >
            {choice.icon && <span className="vs-row-icon">{choice.icon}</span>}
            <span className="vs-choice-text"><span>{choice.label}</span>{choice.description && <small>{choice.description}</small>}</span>
            {choice.sub ? <Icon name="chevron-right" size={16} className="vs-choice-mark" /> : choice.value === value && <Icon name="check" size={16} className="vs-choice-mark" />}
          </button>
        ))}
      </div>
      {sub && (
        <DbPopover anchor={sub.el} placement="right-start" onClose={() => setSub(null)} className="vs-choice-pop">
          <div className="vs-choice" role="menu" onKeyDown={keyNav}>
            {sub.choice.sub!.length ? sub.choice.sub!.map((item) => (
              <button key={item.value} type="button" role="menuitemradio" aria-checked={subValue === item.value} data-vs-nav className="vs-choice-item" onClick={() => onPick(sub.choice.value, item.value)}>
                {item.icon && <span className="vs-row-icon">{item.icon}</span>}
                <span className="vs-choice-text"><span>{item.label}</span></span>
              </button>
            )) : <div className="vs-empty">{t('Nenhuma propriedade de arquivos', 'No files property')}</div>}
          </div>
        </DbPopover>
      )}
    </DbPopover>
  )
}

/** ↑/↓ entre elementos `[data-vs-nav]` do contêiner (Enter/Espaço já ativam botões). */
export function keyNav(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const target = e.target as HTMLElement
  if (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && !target.hasAttribute('data-vs-nav'))) return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-vs-nav]:not(:disabled)'))
  if (!items.length) return
  e.preventDefault()
  e.stopPropagation()
  const i = items.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length : i) - 1
  items[next].focus()
}
