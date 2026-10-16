// Menu de uma opção (⋯): renomear, excluir, mover, grupo de status e cor. Usado pelo editor de
// opções da célula e pela lista de opções do menu da propriedade.
import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import type { OptionColor, SelectOption } from '../../types'
import { getState } from '../../store'
import { resolveLinkedRoot } from './linkedSource'
import { OPTION_COLORS } from './lib'
import { normalizeHex } from './customColors'
import { OptionChip } from './OptionChip'
import { optionColorLabel } from './labels'
import { DbPopover, Menu, MenuItem, MenuLabel, MenuSep, type DbAnchor } from './ui/Popover'
import { deleteOption, moveOption, updateOption } from './schemaOps'
import { t } from '../../i18n'

export const STATUS_GROUPS = ['todo', 'progress', 'complete'] as const
export function groupLabel(group: typeof STATUS_GROUPS[number]) {
  return group === 'todo' ? t('A fazer', 'To do') : group === 'progress' ? t('Em andamento', 'In progress') : t('Concluído', 'Complete')
}

/** Menu de uma opção: renomear, excluir e trocar a cor. */
export function OptionMenu(props: { dbId: string; propId: string; option: SelectOption; isStatus?: boolean; anchor: DbAnchor; onClose: () => void }) {
  const { dbId, propId, option } = props
  const ordered = getState().pages[resolveLinkedRoot(getState().pages, dbId)]?.database?.properties.find((property) => property.id === propId)?.options?.filter((item) => !props.isStatus || (item.group ?? 'todo') === (option.group ?? 'todo')) ?? []
  const position = ordered.findIndex((item) => item.id === option.id)
  const [name, setName] = useState(option.name)
  const nameRef = useRef(name)
  nameRef.current = name
  const inputRef = useRef<HTMLInputElement>(null)

  const commitName = () => {
    const n = nameRef.current.trim()
    if (n && n !== option.name) updateOption(dbId, propId, option.id, { name: n })
  }
  useEffect(() => {
    inputRef.current?.select()
    return commitName
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <DbPopover anchor={props.anchor} placement="right-start" onClose={props.onClose} label={t('Editar opção', 'Edit option')}>
      <Menu width={220}>
        <div className="dbv-input-wrap">
          <input
            ref={inputRef}
            className="dbv-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitName()
                props.onClose()
              }
            }}
          />
        </div>
        <MenuItem
          icon={<Trash2 size={16} />}
          label={t('Excluir', 'Delete')}
          danger
          onClick={() => {
            nameRef.current = option.name
            deleteOption(dbId, propId, option.id)
            props.onClose()
          }}
        />
        <MenuItem icon={<ArrowUp size={16} />} label={t('Mover para cima', 'Move up')} disabled={position <= 0} onClick={() => { if (position > 0) moveOption(dbId, propId, option.id, ordered[position - 1].id, false) }} />
        <MenuItem icon={<ArrowDown size={16} />} label={t('Mover para baixo', 'Move down')} disabled={position < 0 || position >= ordered.length - 1} onClick={() => { if (position >= 0 && position < ordered.length - 1) moveOption(dbId, propId, option.id, ordered[position + 1].id, true) }} />
        <MenuSep />
        {props.isStatus && <><MenuLabel>{t('Grupo de status', 'Status group')}</MenuLabel>{STATUS_GROUPS.map((group) => <MenuItem key={group} label={groupLabel(group)} checked={(option.group ?? 'todo') === group} onClick={() => updateOption(dbId, propId, option.id, { group })} />)}<MenuSep /></>}
        <MenuLabel>{t('Cores', 'Colors')}</MenuLabel>
        {OPTION_COLORS.map((c: OptionColor) => (
          <MenuItem
            key={c}
            icon={<span className={`ed-swatch db-color-${c}`} />}
            label={optionColorLabel(c)}
            checked={!option.customColor && option.color === c}
            onClick={() => updateOption(dbId, propId, option.id, { color: c, customColor: undefined })}
          />
        ))}
        <MenuSep />
        <CustomColorPicker option={option} onPick={(customColor) => updateOption(dbId, propId, option.id, { customColor })} />
      </Menu>
    </DbPopover>
  )
}

/** Cor livre (#rrggbb) com prévia; o contraste é ajustado automaticamente para os dois temas. */
function CustomColorPicker({ option, onPick }: { option: SelectOption; onPick: (hex: string | undefined) => void }) {
  const [draft, setDraft] = useState(option.customColor ?? '')
  const valid = normalizeHex(draft)
  return <>
    <MenuLabel>{t('Cor personalizada', 'Custom color')}</MenuLabel>
    <div className="ed-color-custom">
      <input type="color" aria-label={t('Escolher cor', 'Pick a color')} value={valid ?? '#2f80ed'} onChange={(event) => { setDraft(event.target.value); onPick(event.target.value) }} />
      <input className="dbv-input" aria-label={t('Cor em hexadecimal', 'Hex color')} placeholder="#2f80ed" value={draft} maxLength={7} onChange={(event) => { setDraft(event.target.value); const hex = normalizeHex(event.target.value); if (hex) onPick(hex) }} onKeyDown={(event) => event.stopPropagation()} />
      {option.customColor && <button type="button" className="dbv-link" onClick={() => { setDraft(''); onPick(undefined) }}>{t('Remover', 'Remove')}</button>}
    </div>
    {valid && <div className="ed-color-preview"><OptionChip name={option.name} color={option.color} custom={valid} /></div>}
  </>
}
