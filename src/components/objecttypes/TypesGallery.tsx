// Galeria "Explorar tipos" (tipos prontos criados só quando o usuário escolhe), confirmação leve ao aplicar e
// guia "Página, Banco ou Tipo?". docs/USAGE.md
import { useEffect, useRef, useState } from 'react'
import { FileText, Plus, Tag, X } from 'lucide-react'
import { actions, useStore } from '../../store'
import { useI18n } from '../../i18n'
import { PageIcon } from '../page/PageIcon'
import { BlockIcon } from '../ui/BlockIcon'
import { DialogActions } from '../ui/DialogActions'
import { Button, IconButton } from '../ui/Button'
import { PropTypeIcon } from '../database/icons'
import { fieldSummary, galleryEntries, type GalleryEntry } from '../../objecttypes/visibility'
import { adoptStarterType, applySummary, createType, missingNativeCount, restoreNative, undoTypes } from '../../objecttypes/actions'
import { openTypeCollection, openTypesGallery, openTypesGuide, openTypesManager, patchTypesUi, setTypesPrefs, showTypesToast, typesPrefs, useTypesUi, type TypesUiState } from '../../objecttypes/ui'
import { applyTypeFlow } from './TypePicker'
import { ReviewHost } from './Harvest'
import { TypesIntro, typesIntroText } from './TypesIntro'
import './objecttypes.css'

/** Esc fecha e o foco volta para quem abriu (Jakob). */
function useDialogKeys(onClose: () => void) {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('.dbv-popover')) { event.stopPropagation(); close.current() } }
    window.addEventListener('keydown', onKey)
    if (!box.current?.contains(document.activeElement)) box.current?.querySelector<HTMLElement>('[autofocus], button.np-btn, button')?.focus()
    return () => { window.removeEventListener('keydown', onKey); if (opener?.isConnected) opener.focus() }
  }, [])
  return box
}

export function TypesGallery({ pageIds, onClose }: { pageIds?: string[]; onClose: () => void }) {
  const { t, locale } = useI18n()
  const { pages, settings } = useStore()
  const box = useDialogKeys(onClose)
  const entries = galleryEntries(pages, settings.objectTypes ?? [], locale === 'en-US' ? 'en-US' : 'pt-BR')
  const forPages = !!pageIds?.length
  const use = (entry: GalleryEntry) => {
    const id = entry.adopted && entry.existing ? entry.existing.id : adoptStarterType(entry.preset)
    if (!id) return
    onClose()
    if (forPages) { void applyTypeFlow(pageIds!, id).catch(actions.reportSaveError); return }
    openTypeCollection(id)
    if (!entry.adopted) showTypesToast(t('Tipo {name} pronto. Crie uma página ou aplique numa que já existe com “+ Tipo”.', 'Type {name} is ready. Create a page or apply it to an existing one with “+ Type”.', { name: entry.name }), () => { undoTypes() })
  }
  return <div className="ot-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={box} className="ot-gallery" role="dialog" aria-modal="true" aria-labelledby="ot-gallery-title" data-ot="gallery">
      <div className="ot-gallery-head">
        <div>
          <h2 id="ot-gallery-title" className="np-display">{t('Explorar tipos', 'Explore types')}</h2>
          <p>{forPages ? t('Escolha um tipo para aplicar a esta página. Nada é criado até você escolher.', 'Pick a type to apply to this page. Nothing is created until you choose.') : t('Os tipos principais já estão no seu espaço; estes são extras. Nada é criado até você clicar em “Usar”.', 'The main types are already in your workspace; these are extras. Nothing is created until you click “Use”.')}</p>
        </div>
        <IconButton label={t('Fechar', 'Close')} onClick={onClose}><X size={16} /></IconButton>
      </div>
      <TypesIntro />
      {!entries.length && <p className="ot-collection-note" data-ot="gallery-empty">{t('Todos os tipos prontos já estão no seu espaço (veja a seção “Tipos” da barra lateral).', 'All ready-made types are already in your workspace (see the “Types” section in the sidebar).')}</p>}
      <ul className="ot-gallery-grid" aria-label={t('Tipos prontos', 'Ready-made types')}>
        {entries.map((entry) => <li key={entry.preset} className="ot-gcard" data-preset={entry.preset}>
          <span className={`ot-gcard-icon db-color-${entry.color}`} aria-hidden><PageIcon value={entry.icon} style={{ width: 20, height: 20 }} /></span>
          <div className="ot-gcard-text">
            <strong>{entry.name}</strong>
            <span>{entry.description}</span>
            <small>{t('Campos: {list}', 'Fields: {list}', { list: fieldSummary(entry.fields) })}</small>
          </div>
          <Button aria-label={(entry.adopted ? (forPages ? t('Aplicar {name}', 'Apply {name}', { name: entry.name }) : t('Abrir {name}', 'Open {name}', { name: entry.name })) : t('Usar {name}', 'Use {name}', { name: entry.name }))} onClick={() => use(entry)}>
            {entry.adopted ? (forPages ? t('Aplicar', 'Apply') : t('Abrir', 'Open')) : t('Usar', 'Use')}
          </Button>
        </li>)}
      </ul>
      <div className="ot-gallery-foot">
        <Button onClick={() => { const id = createType(); onClose(); if (id) openTypesManager(id) }}><Plus size={14} /> {t('Criar tipo do zero', 'Create a type from scratch')}</Button>
        <span className="ot-spacer" />
        {missingNativeCount() > 0 && <Button onClick={() => { restoreNative(); onClose() }}>{t('Restaurar tipos nativos', 'Restore built-in types')}</Button>}
        <button type="button" className="ot-link" onClick={() => { onClose(); openTypesGuide() }}>{t('Página, banco ou tipo?', 'Page, database or type?')}</button>
      </div>
    </div>
  </div>
}

/** "Aplicar o tipo Projeto? Vai adicionar 4 campos e inserir o modelo no topo." — só na primeira vez de cada tipo. */
export function ApplyTypeDialog({ pageId, typeId, onClose }: { pageId: string; typeId: string; onClose: () => void }) {
  const { t } = useI18n()
  const box = useDialogKeys(onClose)
  const summary = applySummary(typeId)
  const [template, setTemplate] = useState(typesPrefs().insertTemplate !== false)
  const [dontAsk, setDontAsk] = useState(false)
  const confirm = () => {
    const prefs = typesPrefs()
    setTypesPrefs({ confirmedTypes: [...new Set([...(prefs.confirmedTypes ?? []), typeId])].slice(-200), insertTemplate: summary.hasTemplate ? template : prefs.insertTemplate, ...(dontAsk ? { confirmOff: true } : {}) })
    onClose()
    void applyTypeFlow([pageId], typeId, false, { confirmed: true, template: summary.hasTemplate && template }).catch(actions.reportSaveError)
  }
  const fields = summary.fields.length
  return <div className="ot-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={box} className="ot-dialog" role="dialog" aria-modal="true" aria-labelledby="ot-apply-title" data-ot="confirm" onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); confirm() } }}>
      <h3 id="ot-apply-title">{t('Aplicar o tipo {name}?', 'Apply the {name} type?', { name: summary.name })}</h3>
      <p>{fields
        ? (summary.hasTemplate && template
          ? t('Vai adicionar {n} campos ({list}) e inserir o modelo no topo.', 'It will add {n} fields ({list}) and insert the template at the top.', { n: fields, list: fieldSummary(summary.fields, 4) })
          : t('Vai adicionar {n} campos ({list}).', 'It will add {n} fields ({list}).', { n: fields, list: fieldSummary(summary.fields, 4) }))
        : (summary.hasTemplate && template ? t('Vai inserir o modelo no topo.', 'It will insert the template at the top.') : t('A página ganha o chip do tipo e entra na coleção.', 'The page gets the type chip and joins the collection.'))}
        {' '}{t('O texto que já existe não muda, e dá para desfazer.', 'Existing text stays as is, and you can undo.')}</p>
      {summary.hasTemplate && <label><input type="checkbox" checked={template} onChange={(e) => setTemplate(e.target.checked)} autoFocus /> <span>{t('Inserir modelo', 'Insert template')}</span></label>}
      <label className="ot-dialog-quiet"><input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} /> <span>{t('Não perguntar de novo', 'Don’t ask again')}</span></label>
      <DialogActions confirmLabel={t('Aplicar', 'Apply')} onCancel={onClose} onConfirm={confirm} />
    </div>
  </div>
}


/**
 * "Incorporar campos da página ao tipo?" — a página tem campos próprios (do banco) que o tipo não tem. Todos vêm
 * marcados; os valores continuam valendo (mesmo id). Um único passo desfazível junto com a aplicação do tipo.
 */
export function IncorporateDialog({ pageIds, typeId, includeChildren, fields, options, onClose }: NonNullable<TypesUiState['incorporate']> & { onClose: () => void }) {
  const { t } = useI18n()
  const box = useDialogKeys(onClose)
  const type = applySummary(typeId)
  const [picked, setPicked] = useState(() => new Set(fields.map((field) => field.property.id)))
  const toggle = (id: string) => setPicked((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const run = (incorporate: string[]) => { onClose(); void applyTypeFlow(pageIds, typeId, includeChildren, { ...options, confirmed: true, incorporate }).catch(actions.reportSaveError) }
  return <div className="ot-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={box} className="ot-dialog" role="dialog" aria-modal="true" aria-labelledby="ot-inc-title" data-ot="incorporate">
      <h3 id="ot-inc-title">{t('Incorporar campos da página ao tipo?', 'Add the page’s fields to the type?')}</h3>
      <p>{t('Esta página tem campos que o tipo {name} não tem. Os marcados passam a fazer parte do tipo (e do modelo), com os valores preservados. Dá para desfazer.', 'This page has fields the {name} type doesn’t have. The checked ones become part of the type (and its template), keeping their values. You can undo.', { name: type.name })}</p>
      <ul className="ot-inc-list">
        {fields.map(({ property, filled, pageIds: holders }) => <li key={property.id}><label>
          <input type="checkbox" checked={picked.has(property.id)} onChange={() => toggle(property.id)} />
          <PropTypeIcon type={property.type} /> <span>{property.name || t('Sem nome', 'Untitled')}</span>
          <small>{filled ? t('{n} valor(es)', '{n} value(s)', { n: filled }) : t('sem valor', 'no value')}{holders.length > 1 ? ` · ${t('{n} páginas', '{n} pages', { n: holders.length })}` : ''}</small>
        </label></li>)}
      </ul>
      <div className="np-dialog-actions">
        <Button onClick={() => run([])}>{t('Não incorporar', 'Don’t add')}</Button>
        <Button variant="primary" disabled={!picked.size} onClick={() => run([...picked])}>{t('Incorporar selecionados', 'Add selected')}</Button>
      </div>
    </div>
  </div>
}

/** Guia "Página, Banco ou Tipo?": quando usar cada um, com exemplo e o botão de criar. */
export function TypesGuide({ onDone }: { onDone?: () => void }) {
  const { t } = useI18n()
  const done = () => { onDone?.(); actions.setSettingsOpen(false) }
  const cards = [
    { key: 'page', icon: <FileText size={20} />, title: t('Página', 'Page'), when: t('Para escrever: notas, ideias, documentos. Pode ter subpáginas.', 'To write: notes, ideas, documents. It can hold subpages.'), example: t('“Ata da reunião de terça”', '“Tuesday meeting notes”'), action: t('Nova página', 'New page'), run: () => { done(); actions.openPage(actions.createPage(null)) } },
    { key: 'database', icon: <BlockIcon name="database-full-page" size={20} />, title: t('Banco de dados', 'Database'), when: t('Para uma lista de itens parecidos num só lugar, vista em tabela, quadro ou calendário.', 'For a list of similar items in one place, seen as a table, board or calendar.'), example: t('“Projetos”, com Status e Prazo em cada linha', '“Projects”, with Status and Deadline on each row'), action: t('Novo banco de dados', 'New database'), run: () => { done(); actions.openPage(actions.createDatabase(null)) } },
    { key: 'type', icon: <Tag size={20} />, title: t('Tipo', 'Type'), when: t('Para dar os mesmos campos a páginas espalhadas pelo espaço, sem movê-las.', 'To give the same fields to pages spread across the workspace, without moving them.'), example: t('“Pessoa”: e-mail e telefone em qualquer página sobre alguém', '“Person”: email and phone on any page about someone'), action: t('Explorar tipos', 'Explore types'), run: () => { done(); openTypesGallery() } },
  ]
  return <div className="ot-guide" data-ot="guide">
    <div className="ot-guide-grid">
      {cards.map((card) => <section key={card.key} className="ot-guide-card" data-kind={card.key} aria-labelledby={`ot-guide-${card.key}`}>
        <span className="ot-guide-icon" aria-hidden>{card.icon}</span>
        <h4 id={`ot-guide-${card.key}`}>{card.title}</h4>
        <p>{card.when}</p>
        <p className="ot-guide-example">{t('Exemplo: {text}', 'Example: {text}', { text: card.example })}</p>
        <Button onClick={card.run}>{card.action}</Button>
      </section>)}
    </div>
    <p className="ot-collection-note">{t('Dá para mudar depois: subpáginas viram banco de dados, e a coleção de um tipo também (“Transformar em banco de dados”).', 'You can change later: subpages can become a database, and so can a type collection (“Turn into a database”).')}</p>
  </div>
}

export function TypesGuideDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const box = useDialogKeys(onClose)
  return <div className="ot-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={box} className="ot-gallery" role="dialog" aria-modal="true" aria-labelledby="ot-guide-title">
      <div className="ot-gallery-head">
        <div><h2 id="ot-guide-title" className="np-display">{t('Página, banco ou tipo?', 'Page, database or type?')}</h2><p>{typesIntroText(t)}</p></div>
        <IconButton label={t('Fechar', 'Close')} onClick={onClose}><X size={16} /></IconButton>
      </div>
      <TypesGuide onDone={onClose} />
    </div>
  </div>
}

/** Diálogos globais da descoberta de tipos (montados em ObjectTypesHost). */
export function TypesDiscoveryHost() {
  const ui = useTypesUi()
  return <>
    {ui.gallery && <TypesGallery pageIds={ui.gallery.pageIds} onClose={() => patchTypesUi({ gallery: null })} />}
    {ui.confirmApply && <ApplyTypeDialog key={ui.confirmApply.pageId + ui.confirmApply.typeId} pageId={ui.confirmApply.pageId} typeId={ui.confirmApply.typeId} onClose={() => patchTypesUi({ confirmApply: null })} />}
    {ui.incorporate && <IncorporateDialog key={ui.incorporate.typeId + ui.incorporate.pageIds.join()} {...ui.incorporate} onClose={() => patchTypesUi({ incorporate: null })} />}
    {ui.guide && <TypesGuideDialog onClose={() => patchTypesUi({ guide: false })} />}
    <ReviewHost />
  </>
}
