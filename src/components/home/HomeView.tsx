// Meu dia (rota `home`): cabeçalho com data e ações rápidas, Hoje, Esta semana, Visitadas recentemente (com prévia real),
// modelos/tipos prontos/modelos pessoais e Todas as páginas. Decisões em docs/DEVELOPMENT.md.
import { t, getLocale } from '../../i18n'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Lock, Star } from 'lucide-react'
import { actions, api, selectors, useStore } from '../../store'
import type { Page } from '../../types'
import { PageIcon } from '../page/PageIcon'
import { coverStyle } from '../page/covers'
import { availableTemplates, createFromTemplate, templates as builtinTemplates } from '../page/templates'
import { Icon, toneSurface } from '../ui/icons/Icon'
import { parseIconValue, type IconColor } from '../ui/icons/iconValue'
import { protectedAncestor, protectedTitle } from '../../security/pageLock'
import { createCanvas } from '../canvas/canvasActions'
import { openToday } from '../../daily/dailyNotes'
import { currentBuckets, useTaskIndexVersion } from '../../tasks/taskIndex'
import { useToday } from '../../daily/CalendarPanel'
import { createObject, objectTypes } from '../../objecttypes/actions'
import { sidebarTypes } from '../../objecttypes/visibility'
import { openTypesGallery } from '../../objecttypes/ui'
import type { QuickCaptureBridge } from '../../quick/types'
import './HomeView.css'
import { TodayCard } from '../../tasks/TodayCard'
import { ReviewHomeCard } from '../../review/ReviewView'
import { openVoiceTasks } from '../../voice/VoiceTasksDialog'
import { HomeWeekCard } from '../productivity/HomeWeekCard'
import { EmptyState } from '../ui/illustrations/Illustration'
import { ContinueCard, OnboardingCard, TipLine, WeekReviewCard, useResumeTarget } from './CoachCards'
import './coach.css'
import { Select } from '../ui/Select'
import { shortcutHint } from '../../shortcuts'

function greeting(date = new Date()): string {
  const h = date.getHours()
  if (h >= 5 && h < 12) return t("Bom dia", "Good morning")
  if (h >= 12 && h < 18) return t("Boa tarde", "Good afternoon")
  return t("Boa noite", "Good evening")
}

function relativeTime(ts: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000))
  if (seconds < 60) return t('agora mesmo', 'just now')
  const [divisor, unit]: [number, Intl.RelativeTimeFormatUnit] = seconds < 3600 ? [60, 'minute'] : seconds < 86400 ? [3600, 'hour'] : seconds < 2592000 ? [86400, 'day'] : seconds < 31536000 ? [2592000, 'month'] : [31536000, 'year']
  return new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' }).format(-Math.floor(seconds / divisor), unit)
}

const untitled = () => t("Sem título", "Untitled")
const kindOf = (page: Page) => page.canvas ? 'canvas' as const : page.database ? 'database' as const : 'page' as const

/** Cor de destaque de um ícone (`lucide:nome:cor`); emoji/imagem/sem ícone → neutro. */
function iconTint(icon: string | null | undefined): IconColor {
  const parsed = parseIconValue(icon)
  return parsed?.kind === 'glyph' ? parsed.color : 'default'
}

function RowIcon({ page, size = 16 }: { page: Page; size?: number }) {
  return <PageIcon value={page.icon} fallback={kindOf(page)} className="hm-emoji" style={{ fontSize: size, width: size, height: size }} />
}

/** Prévia do cartão recente: capa → mini-tabela (banco) → lousa (quadro) → trecho do texto sobre fundo tingido. */
function CardPreview({ page, hidden }: { page: Page; hidden: boolean }) {
  if (page.cover) return <span className="hm-card-preview has-cover" style={coverStyle(page.cover, page.coverPosition)} aria-hidden />
  const tint = iconTint(page.icon)
  const style = { ['--hm-tint' as string]: toneSurface(tint) } as CSSProperties
  if (hidden) return <span className="hm-card-preview is-locked" style={style} aria-hidden><Lock size={16} strokeWidth={1.75} /></span>
  if (page.database) {
    const columns = (page.database.properties ?? []).slice(0, 3)
    const rows = Math.min(3, Math.max(2, selectors.childrenShared(page.id).length))
    return <span className="hm-card-preview is-db" style={style} aria-hidden>
      <span className="hm-mini-table">
        <span className="hm-mini-row is-head">{(columns.length ? columns : [{ id: 'a', name: '' }]).map(column => <span key={column.id}>{column.name}</span>)}</span>
        {Array.from({ length: rows }, (_, i) => <span key={i} className="hm-mini-row">{(columns.length ? columns : [{ id: 'a' }]).map(column => <span key={column.id}><i /></span>)}</span>)}
      </span>
    </span>
  }
  if (page.canvas) return <span className="hm-card-preview is-canvas" style={style} aria-hidden><span className="hm-mini-shape a" /><span className="hm-mini-shape b" /><span className="hm-mini-shape c" /></span>
  const excerpt = (page.text || '').replace(/\s+/g, ' ').trim().slice(0, 180)
  return <span className={`hm-card-preview is-text${excerpt ? '' : ' is-empty'}`} style={style} aria-hidden>
    {excerpt ? <span className="hm-card-excerpt">{excerpt}</span> : <span className="hm-card-lines"><i /><i /><i /></span>}
  </span>
}

export function HomeView() {
  const { settings, pages } = useStore()
  useTaskIndexVersion()
  const today = useToday()
  const templates = availableTemplates()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [sort, setSort] = useState<'updated' | 'title'>('updated')
  const [visible, setVisible] = useState(24)
  const recent = selectors.recent(12)
  const resume = useResumeTarget()
  const [pendingCapture, setPendingCapture] = useState(false)
  useEffect(() => { let alive = true; void (api as unknown as QuickCaptureBridge).quickDraftInfo?.().then(has => { if (alive) setPendingCapture(!!has) }).catch(() => {}); return () => { alive = false } }, [])
  const all = Object.values(pages)
    .filter((p) => selectors.isLive(p.id) && (!onlyFavorites || p.favorite))
    .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'pt-BR') : b.updatedAt - a.updatedAt)
  const name = settings.userName.trim()
  const locale = getLocale() === 'en-US' ? 'en-US' : 'pt-BR'
  const dateLabel = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${today}T12:00:00`)), [locale, today])
  const buckets = currentBuckets(today)
  const dueToday = buckets.today.length, overdue = buckets.overdue.length
  const subtitle = dueToday || overdue
    ? [dueToday ? t('{n} tarefas para hoje', '{n} tasks due today', { n: dueToday }) : '', overdue ? t('{n} atrasadas', '{n} overdue', { n: overdue }) : ''].filter(Boolean).join(' · ')
    : t('Nada agendado para hoje. Bom momento para escrever.', 'Nothing scheduled today. A good moment to write.')

  const builtinIds = new Set(builtinTemplates.map(template => template.id))
  const starter = templates.filter(template => builtinIds.has(template.id))
  const personal = (settings.personalTemplates ?? []).filter(template => !builtinIds.has(template.id))
  // Só os tipos em uso ou escolhidos (Hick); os prontos ficam na galeria "Explorar tipos" (docs/USAGE.md).
  const typeChips: { key: string; icon: string | null; label: string; run: () => string }[] = sidebarTypes(pages, objectTypes()).slice(0, 6).map(({ type }) => ({ key: type.id, icon: type.icon, label: type.name, run: () => createObject(type.id) }))
  const quickBridge = api as unknown as QuickCaptureBridge

  const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : t("Não foi possível criar a página. Tente novamente.", "Could not create the page. Please try again."))
  const create = () => actions.openPage(actions.createPage(null))
  const open = (id: string, e: React.MouseEvent) => e.metaKey || e.ctrlKey ? actions.openInNewTab({ type: 'page', id }) : actions.openPage(id)
  const useTemplate = async (id: string) => {
    setBusy(id); setError('')
    try { const created = await createFromTemplate(id, null); if (created) actions.openPage(created) }
    catch (cause) { report(cause) }
    finally { setBusy(null) }
  }
  const runType = (chip: typeof typeChips[number]) => {
    setError('')
    try { actions.openPage(chip.run()) } catch (cause) { report(cause) }
  }

  const quick: { id: string; icon: string; label: string; keys?: string; run: () => void }[] = [
    { id: 'page', icon: 'new-page', label: t("Nova página", "New page"), keys: shortcutHint('new-page'), run: create },
    { id: 'db', icon: 'database', label: t("Novo banco", "New database"), keys: '', run: () => actions.openPage(actions.createDatabase(null)) },
    { id: 'today', icon: 'today', label: t("Nota de hoje", "Today’s note"), keys: shortcutHint('daily-today'), run: () => void openToday().catch(report) },
    ...(quickBridge.showQuickCapture ? [{ id: 'capture', icon: 'quick-capture', label: t("Captura rápida", "Quick capture"), keys: '⌥⌘N', run: () => void quickBridge.showQuickCapture!().catch(report) }] : []),
    { id: 'voice', icon: 'dictation', label: t("Tarefas por voz", "Tasks by voice"), keys: '', run: openVoiceTasks },
    { id: 'canvas', icon: 'canvas', label: t("Nova lousa", "New whiteboard"), keys: '', run: () => actions.openPage(createCanvas(null)) },
  ]

  const tile = (key: string, icon: string | null, title: string, description: string | undefined, onClick: () => void, extra = '') => {
    const tint = iconTint(icon)
    return <button key={key} type="button" className={`hm-template${extra}`} disabled={busy !== null} onClick={onClick}>
      <span className="hm-tile" style={{ background: toneSurface(tint) }} aria-hidden><PageIcon value={icon} fallback="page" style={{ width: 18, height: 18 }} /></span>
      <span className="hm-template-text"><strong>{busy === key ? t("Criando…", "Creating…") : title}</strong>{description && <span>{description}</span>}</span>
    </button>
  }

  return (
    <div className="hm-root">
      <div className="hm-inner">
        <header className="hm-head">
          <p className="hm-date"><Icon name="home" size={14} className="hm-date-icon" /> <span>{dateLabel}</span></p>
          <h1 className="hm-greeting">{name ? `${greeting()}, ${name}` : greeting()}</h1>
          <p className="hm-subtitle">{subtitle}</p>
          <div className="hm-quick-actions" role="group" aria-label={t("Ações rápidas", "Quick actions")}>
            {quick.map(item => <button key={item.id} type="button" className="hm-quick-action" data-action={item.id} title={item.keys ? `${item.label} (${item.keys})` : item.label} onClick={item.run}><Icon name={item.icon} size={16} /> {item.label}</button>)}
          </div>
        </header>

        {/* Um único destaque primário (Von Restorff): "Continuar" quando há retomada; senão "Abrir nota de hoje". */}
        {resume && <ContinueCard target={resume} pendingCapture={pendingCapture} />}
        <OnboardingCard />
        <TipLine />

        {/* Fluxo diário: 5 próximas tarefas e a nota de hoje (src/tasks/TodayCard.tsx). */}
        <TodayCard primary={!resume} />
        <WeekReviewCard today={today} />
        <ReviewHomeCard />

        {settings.productivity?.enabled !== false && <section className="hm-section" aria-labelledby="hm-week-title">
          <h2 className="hm-section-title" id="hm-week-title">{t("Esta semana", "This week")}</h2>
          <HomeWeekCard />
        </section>}

        <section className="hm-section" aria-labelledby="hm-recent-title">
          <h2 className="hm-section-title" id="hm-recent-title">{t("Visitadas recentemente", "Recently visited")}</h2>
          {recent.length > 0 ? (
            <div className="hm-cards" role="list">
              {recent.map((p) => {
                const hidden = !!protectedAncestor(pages, p.id)
                const title = protectedTitle(p, t('Página protegida', 'Protected page')) ?? (p.title || untitled())
                return (
                  <button key={p.id} role="listitem" className="hm-card" onClick={e => open(p.id, e)} aria-label={t("Abrir {title}", "Open {title}", { title })}>
                    <CardPreview page={p} hidden={hidden} />
                    <span className="hm-card-icon"><RowIcon page={p} size={20} /></span>
                    <span className="hm-card-title">{title}</span>
                    <span className="hm-card-date">{relativeTime(p.updatedAt)}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <EmptyState className="hm-empty" illustration="pages" title={t("Nenhuma página visitada ainda", "No pages visited yet")}
              action={<button className="hm-btn" onClick={create} aria-label={t("Nova página", "New page")}><Icon name="plus" size={14} /> {t("Nova página", "New page")}</button>}>
              {t("As páginas que você abrir aparecem aqui, à mão.", "Pages you open show up here, close at hand.")}
            </EmptyState>
          )}
        </section>

        <section className="hm-section" aria-labelledby="hm-templates-title">
          <h2 className="hm-section-title" id="hm-templates-title">{t("Comece com um modelo", "Start with a template")}</h2>
          <div className="hm-templates">{starter.map(template => tile(template.id, template.icon, template.title, template.description, () => void useTemplate(template.id)))}</div>
          {<>
            <h3 className="hm-subsection-title">{t("Tipos", "Types")}</h3>
            <div className="hm-chips">{!typeChips.length && <button type="button" className="hm-chip" onClick={() => openTypesGallery()} title={t("Um tipo dá campos e um modelo a qualquer página", "A type gives any page fields and a template")}><span className="hm-tile is-small" aria-hidden><PageIcon value="lucide:tag:gray" fallback="page" style={{ width: 14, height: 14 }} /></span>{t("Explorar tipos", "Explore types")}</button>}{typeChips.map(chip => <button key={chip.key} type="button" className="hm-chip" disabled={busy !== null} onClick={() => runType(chip)} title={t("Nova página do tipo {name}", "New {name} page", { name: chip.label })}>
              <span className="hm-tile is-small" style={{ background: toneSurface(iconTint(chip.icon)) }} aria-hidden><PageIcon value={chip.icon} fallback="page" style={{ width: 14, height: 14 }} /></span>{chip.label}
            </button>)}</div>
          </>}
          {personal.length > 0 && <>
            <h3 className="hm-subsection-title">{t("Seus modelos", "Your templates")}</h3>
            <div className="hm-templates">{personal.map(template => tile(template.id, template.icon, template.title || untitled(), template.description, () => void useTemplate(template.id)))}</div>
          </>}
          {error && <p className="hm-error" role="alert">{error}</p>}
        </section>

        {(Object.values(pages).some(p => selectors.isLive(p.id))) && (
          <section className="hm-section" aria-labelledby="hm-all-title">
            <div className="hm-list-head">
              <h2 className="hm-section-title" id="hm-all-title">{t("Todas as páginas", "All pages")}</h2>
              <div className="hm-list-toolbar">
                <button className={onlyFavorites ? 'is-active' : ''} aria-pressed={onlyFavorites} onClick={() => { setOnlyFavorites(value => !value); setVisible(24) }}><Star size={14} strokeWidth={1.75} /> {t("Favoritos", "Favorites")}</button>
                <Select aria-label={t("Ordenar páginas", "Sort pages")} value={sort} onChange={e => setSort(e.target.value as 'updated' | 'title')}><option value="updated">{t("Última edição", "Last edited")}</option><option value="title">{t("Título", "Title")}</option></Select>
              </div>
            </div>
            <div className="hm-list">
              {all.slice(0, visible).map((p) => {
                const path = selectors.ancestors(p.id).map((a) => a.title || untitled()).join(' / ')
                const title = protectedTitle(p, t('Página protegida', 'Protected page')) ?? (p.title || untitled())
                return (
                  <button key={p.id} className="hm-row" onClick={e => open(p.id, e)} aria-label={t("Abrir {title}", "Open {title}", { title })}>
                    <span className="hm-row-icon"><RowIcon page={p} size={16} /></span>
                    <span className="hm-row-title">{title}</span>
                    {path && <span className="hm-row-path">{path}</span>}
                    <span className="hm-row-date">{relativeTime(p.updatedAt)}</span>
                  </button>
                )
              })}
              {!all.length && <p className="hm-empty-text">{t("Nenhuma página favorita ainda. Use a estrela no topo de uma página.", "No favorite pages yet. Use the star at the top of a page.")}</p>}
            </div>
            {all.length > visible && <button className="hm-show-more" onClick={() => setVisible(value => value + 24)}>{t("Mostrar mais ({count})", "Show more ({count})", { count: all.length - visible })}</button>}
          </section>
        )}
      </div>
    </div>
  )
}
