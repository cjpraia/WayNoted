// Escolha de um tipo para aplicar a uma ou mais páginas (cabeçalho, /Tipo, ⌘K, barra lateral, #tag).
// Só mostra os tipos em uso ou escolhidos; os prontos ficam na galeria "Explorar tipos" (docs/USAGE.md).
import { useMemo, useState } from 'react'
import { LayoutGrid, Plus, Settings2 } from 'lucide-react'
import { actions, getState, useStore } from '../../store'
import { useI18n } from '../../i18n'
import { PageIcon } from '../page/PageIcon'
import { DbPopover, Menu, MenuItem, MenuLabel, MenuSep, type DbAnchor } from '../database/ui/Popover'
import { fold, type ObjectType } from '../../objecttypes/model'
import { sidebarTypes } from '../../objecttypes/visibility'
import { applyType, applyTypeStep, createType, expandTargets, insertTemplate, objectTypes } from '../../objecttypes/actions'
import { extraFieldsFor } from '../../objecttypes/adjust'
import { openTypesGallery, openTypesManager, patchTypesUi, showTypesToast, typesPrefs } from '../../objecttypes/ui'
import { TypesIntro } from './TypesIntro'
import './objecttypes.css'

/**
 * Aplica o tipo. Numa página só: na primeira vez de cada tipo pede uma confirmação leve; depois aplica campos,
 * ícone (se a página não tem) e modelo num passo único com aviso "Desfazer". Em lote (subpáginas, linhas de
 * um banco): o modelo só vai para páginas vazias.
 */
export async function applyTypeFlow(pageIds: string[], typeId: string, includeChildren = false, options: { confirmed?: boolean; template?: boolean; incorporate?: readonly string[] } = {}): Promise<number> {
  const targets = expandTargets(pageIds, includeChildren)
  const en = getState().settings.locale === 'en-US'
  // A página tem campos próprios (do banco) que o tipo não tem: pergunta antes se entram no tipo (docs/USAGE.md).
  if (options.incorporate === undefined) {
    const fields = extraFieldsFor(getState().pages, objectTypes(), targets, typeId)
    if (fields.length) { patchTypesUi({ incorporate: { pageIds, typeId, includeChildren, fields, options: { confirmed: options.confirmed, template: options.template } } }); return 0 }
  }
  if (targets.length === 1 && pageIds.length === 1 && targets[0] === pageIds[0]) {
    const prefs = typesPrefs()
    if (!options.confirmed && !prefs.confirmOff && !prefs.confirmedTypes?.includes(typeId)) { patchTypesUi({ confirmApply: { pageId: targets[0], typeId } }); return 0 }
    const result = await applyTypeStep(targets[0], typeId, { template: options.template ?? prefs.insertTemplate !== false, incorporate: options.incorporate })
    if (!result.applied) showTypesToast(en ? 'Nothing to apply (page locked or already has this type).' : 'Nada a aplicar (página bloqueada ou já com o tipo).')
    return result.applied ? 1 : 0
  }
  const { applied } = applyType(targets, typeId, { incorporate: options.incorporate })
  for (const id of applied.slice(0, 500)) await insertTemplate(id, typeId, 'ifEmpty').catch(() => false)
  if (!applied.length && targets.length) showTypesToast(en ? 'Nothing to apply (pages locked or already typed).' : 'Nada a aplicar (páginas bloqueadas ou já com o tipo).')
  return applied.length
}

export function TypeChipLabel({ type }: { type: Pick<ObjectType, 'icon' | 'name' | 'color'> }) {
  return <span className="ot-type-label"><span className={`ot-dot db-color-${type.color}`} aria-hidden />{type.icon && <span aria-hidden><PageIcon value={type.icon} style={{ width: 16, height: 16 }} /></span>}<span>{type.name}</span></span>
}

export function TypePicker({ pageIds, anchor, onClose }: { pageIds: string[]; anchor: DbAnchor; onClose: () => void }) {
  const { t } = useI18n()
  const { pages } = useStore()
  const types = objectTypes()
  const [query, setQuery] = useState('')
  const [withChildren, setWithChildren] = useState(false)
  const single = pageIds.length === 1 ? pages[pageIds[0]] : undefined
  const childCount = useMemo(() => Math.max(0, expandTargets(pageIds, true).length - expandTargets(pageIds, false).length), [pageIds, pages])
  const isDatabase = !!single?.database
  const q = fold(query)
  // Sem busca: só os tipos em uso/escolhidos (Hick). Com busca: todos, inclusive prontos ocultos.
  const visible = q ? types.map((type) => ({ type, count: 0 })) : sidebarTypes(pages, types)
  const list = visible.filter(({ type }) => !q || fold(type.name).includes(q)).filter(({ type }) => !(single && !isDatabase && single.types?.includes(type.id)))
  const exact = types.some((type) => fold(type.name) === q)
  const choose = (typeId: string) => { onClose(); void applyTypeFlow(pageIds, typeId, withChildren).catch(actions.reportSaveError) }
  return <DbPopover anchor={anchor} onClose={onClose} className="ot-picker" label={t('Aplicar tipo', 'Apply type')}>
    <Menu width={300}>
      <TypesIntro compact />
      <div className="dbv-input-wrap"><input autoFocus className="dbv-input" placeholder={t('Buscar ou criar tipo…', 'Search or create a type…')} aria-label={t('Buscar tipo', 'Search type')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        if (list[0]) choose(list[0].type.id)
        else if (query.trim()) choose(createType({ name: query.trim() }))
      }} /></div>
      {isDatabase ? <div className="ot-picker-opt">{t('Aplica às {n} linhas deste banco.', 'Applies to the {n} rows of this database.', { n: childCount + expandTargets(pageIds, false).length })}</div>
        : childCount > 0 && <label className="ot-picker-opt"><input type="checkbox" checked={withChildren} onChange={(e) => setWithChildren(e.target.checked)} /> {t('Incluir subpáginas e linhas ({n})', 'Include subpages and rows ({n})', { n: childCount })}</label>}
      {list.length > 0 && <MenuLabel>{t('Seus tipos', 'Your types')}</MenuLabel>}
      {list.map(({ type, count }) => <MenuItem key={type.id} label={<TypeChipLabel type={type} />} hint={count ? String(count) : undefined} onClick={() => choose(type.id)} />)}
      {!list.length && !query.trim() && types.length > 0 && visible.length > 0 && <MenuLabel>{t('Todos os seus tipos já estão nesta página', 'All your types are already on this page')}</MenuLabel>}
      {query.trim() && !exact && <MenuItem icon={<Plus size={16} />} label={t('Criar tipo “{name}”', 'Create type “{name}”', { name: query.trim() })} onClick={() => choose(createType({ name: query.trim() }))} />}
      <MenuItem icon={<LayoutGrid size={16} />} label={t('Explorar tipos prontos…', 'Explore ready-made types…')} hint={!visible.length ? t('Pessoa, Projeto…', 'Person, Project…') : undefined} onClick={() => { onClose(); openTypesGallery(pageIds) }} />
      {types.length > 0 && <><MenuSep /><MenuItem icon={<Settings2 size={16} />} label={t('Gerenciar tipos…', 'Manage types…')} onClick={() => { onClose(); openTypesManager() }} /></>}
    </Menu>
  </DbPopover>
}
