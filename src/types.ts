import COMPAT from '../shared/compatibility.ts'
// Contrato compartilhado do aplicativo. Não altere sem avisar o orquestrador.
import type { DatabasePropertyConfig, DatabaseRowConfig, DatabaseViewConfig, DatabaseConfig, DateConfig, DatabaseSelectOptionConfig, FileValue, PlaceValue, RichTextValue, RollupAggregation, RollupConfigExtras, TableCalculation } from './database-models'
import type { Locale } from './localization'
export type { FileValue, PlaceValue, RichTextValue } from './database-models'

export type PageFont = 'default' | 'serif' | 'mono'
export interface CommentTextAnchor { segments: { blockId: string; from: number; to: number; quote: string; prefix: string; suffix: string }[] }

export interface PageComment {
  id: string
  body: string
  createdAt: number
  updatedAt: number
  author: string
  resolved: boolean
  blockId?: string
  parentId?: string
  propertyId?: string
  textAnchor?: CommentTextAnchor
  suggestion?: { originalText: string; replacementText: string; status: 'open' | 'accepted' | 'rejected' }
}

export interface Page extends DatabaseRowConfig {
  id: string
  parentId: string | null
  title: string
  /** Emoji ou data URL de imagem local. */
  icon: string | null
  /** Valor CSS de `background` (cor/gradiente) ou data-URL/URL de imagem, ou null. */
  cover: string | null
  /** Posição vertical da capa em %, 0–100. */
  coverPosition: number
  favorite: boolean
  trashed: boolean
  trashedAt: number | null
  createdAt: number
  updatedAt: number
  /** Ordem entre irmãos (crescente). */
  order: number
  fullWidth: boolean
  smallText: boolean
  font: PageFont
  locked: boolean
  /** Texto puro do conteúdo, usado pela busca. */
  text: string
  /** Presente quando a página é um banco de dados; as linhas são as páginas filhas. */
  database?: DatabaseSchema
  /** Valores das propriedades quando a página é linha de um banco de dados (chave = Property.id). */
  props?: Record<string, PropValue>
  comments?: PageComment[]
  /** Índice local de links e menções explícitas a páginas. */
  outboundPageIds?: string[]
  syncedBlockIds?: string[]
  bodyText?: string
  bodyOutboundPageIds?: string[]
  /** Corpo de template aguardando a primeira gravação; removido após sucesso. */
  pendingTemplateBlocks?: unknown[]
  /** Reversible deletion of a child through its owning page block; used by undo. */
  removedByBlock?: { ownerId: string; blockId: string }
  /** Creation through /page or /database; differs from children created in the sidebar. */
  blockOwnerId?: string | null
  /** Child ownership transfers needed to undo/redo a block-to-page conversion. */
  blockConversion?: { sourceId: string; childIds: string[] }
  /** Proteção por senha (src/security): definida pelo processo principal, nunca pelo renderer. */
  passwordLock?: PagePasswordLock
  /** "Privado para IA" (docs/SECURITY.md): invisível a agentes (API local, MCP, CLI) e ao envio a IA em nuvem; vale também para subpáginas. */
  aiPrivate?: boolean
  /** "Não espelhar" (src/mirror): fora do espelho Markdown em texto claro; vale também para subpáginas. */
  mirrorSkip?: boolean
  /** Tipos de objeto ("supertags", src/objecttypes): ids de `settings.objectTypes`. */
  types?: string[]
  /** Valores dos campos dos tipos (chave = Property.id do tipo). Separado de `props` das linhas de banco. */
  typeProps?: Record<string, PropValue>
  /** Lousa (src/canvas, docs/USAGE.md): marcador; o conteúdo fica no documento da página. */
  canvas?: import('./canvas/model').CanvasPageInfo
}
export interface PagePasswordLock { rootId: string; hideTitle: boolean; unlocked?: boolean; /** New subpages inherit this lock. */ inherit?: boolean }

// ---------- Bancos de dados ----------

export type PropType = 'title' | 'text' | 'number' | 'select' | 'multiSelect' | 'status' | 'date' | 'checkbox' | 'url'
  | 'email' | 'phone' | 'createdTime' | 'updatedTime' | 'formula' | 'relation' | 'rollup'
  | 'person' | 'files' | 'createdBy' | 'updatedBy' | 'button' | 'uniqueId' | 'place'

export type OptionColor = 'default' | 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red'

export interface SelectOption extends DatabaseSelectOptionConfig {
  id: string
  name: string
  color: OptionColor
  /** Só exibição em opções sintéticas (ex.: tipos de objeto nas consultas); não é gravado nos bancos. */
  icon?: string
}

export interface Property extends DatabasePropertyConfig {
  id: string
  name: string
  type: PropType
  /** Para select, multiSelect e status. */
  options?: SelectOption[]
  formula?: string
  /** Só exibição em colunas sintéticas (consultas): 'icon' desenha o valor como ícone de página. */
  display?: 'icon'
  relationDatabaseId?: string
  rollup?: {
    relationPropertyId: string
    targetPropertyId: string
    aggregation: RollupAggregation
  } & RollupConfigExtras
}

/** Datas em 'YYYY-MM-DD' (sem hora). */
export interface DateValue extends DateConfig {
  start: string
  end?: string
}

/**
 * title → não fica em `props`: é o `page.title` da linha.
 * text/url → string · number → number · checkbox → boolean
 * select/status → id da opção (string) · multiSelect → ids (string[]) · date → DateValue
 */
export type PropValue = string | number | boolean | string[] | DateValue | FileValue[] | PlaceValue | RichTextValue | null

export type ViewType = 'table' | 'board' | 'calendar' | 'list' | 'gallery' | 'timeline' | 'chart' | 'dashboard' | 'map' | 'feed' | 'form'

export type FilterOp =
  | 'contains'
  | 'notContains'
  | 'is'
  | 'isNot'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'before'
  | 'after'
  | 'isEmpty'
  | 'isNotEmpty'

export interface Filter {
  id: string
  propertyId: string
  op: FilterOp
  /** string para texto/opção/data ('YYYY-MM-DD'), number, boolean (checkbox). Ignorado em isEmpty/isNotEmpty. */
  value: string | number | boolean | null
}

export interface Sort {
  propertyId: string
  direction: 'asc' | 'desc'
}

export interface View extends DatabaseViewConfig {
  openPagesIn?: 'side' | 'center' | 'full'
  id: string
  name: string
  type: ViewType
  /** Combinados com E. */
  filters: Filter[]
  sorts: Sort[]
  /** ids de propriedades ocultas nesta visualização. */
  hidden: string[]
  /** Larguras de coluna (tabela), em px, por Property.id. */
  widths: Record<string, number>
  /** Quadro: propriedade select/status usada para agrupar. */
  groupBy?: string
  /** Calendário: propriedade date usada para posicionar. */
  dateProp?: string
  timelineScale?: 'week' | 'month' | 'quarter'
  chartGroupBy?: string
  chartValueId?: string
  chartAggregation?: 'count' | 'sum' | 'average'
  tableCalculations?: Record<string, TableCalculation>
}

export interface DatabaseSchema extends DatabaseConfig {
  /** A ordem do array é a ordem das colunas. Sempre contém exatamente uma propriedade `title`. */
  properties: Property[]
  views: View[]
  activeViewId: string
}

export type ThemeSetting = 'system' | 'light' | 'dark'

export type UpdateCheckResult =
  | { status: 'current'; current: string; latest: string }
  | { status: 'available'; current: string; latest: string; notes: Record<string, string>; hasDownload: boolean }
  | { status: 'error'; current: string; code: 'invalid-url' | 'network' | 'timeout' | 'http' | 'too-large' | 'invalid-feed' }

export interface Settings {
  /** F7: URL (https) do feed JSON de atualizações; vazia por padrão, nenhuma verificação automática. */
  updateFeedUrl?: string
  locale: Locale
  /** Atalhos personalizados: id do comando em src/shortcuts.ts → teclas efetivas (mesmo tamanho do padrão). */
  shortcutOverrides?: Record<string, string[]>
  theme: ThemeSetting
  /** Fonte dos títulos: 'workspace' (Newsreader, padrão) ou 'system' (fonte do sistema). docs/DEVELOPMENT.md */
  titleFont?: "workspace" | 'system'
  /** Atenua barra lateral/abas/ações após 3 s de digitação contínua (padrão ligado). */
  dimWhileTyping?: boolean
  userName: string
  workspaceName: string
  sidebarWidth: number
  sidebarCollapsed: boolean
  /** ids de páginas expandidas na árvore da barra lateral. */
  expanded: Record<string, boolean>
  /** ids visitados recentemente, mais recente primeiro. */
  recent: string[]
  /** Migração única: removeu agrupamentos automáticos (primeiro Status/Seleção) de tabelas/listas/galerias. */
  autoGroupingCleaned?: boolean
  /** Barra lateral: mostra até 15 páginas recentes em vez de 5. */
  recentExpanded?: boolean
  openTabs?: { id: string; route: Route; pinned?: boolean; group?: { id: string; name: string } }[]
  activeTabId?: string
  personalTemplates?: PersonalTemplate[]
  /** 0 conserva todas as versões locais. */
  historyLimit?: number
  /** Retenção do histórico de versões: padrão (24 h tudo, 1/h por 7 dias, 1/dia por 90 dias, máx. 200), mais longo ou sem limite. */
  historyPolicy?: 'default' | 'long' | 'unlimited'
  automaticBackup?: { enabled: boolean; intervalHours: number; keep: number }
  localApiEnabled?: boolean
  /** Converter Markdown/TSV em blocos ao colar texto simples (padrão: ligado). docs/USAGE.md */
  pasteMarkdown?: boolean
  /** Vídeos online incorporados (YouTube, Vimeo…): sempre (padrão), clicar para carregar ou nunca. docs/SECURITY.md */
  embedVideos?: 'always' | 'click' | 'never'
  /** Interruptor mestre: nenhum conteúdo remoto é carregado (vale como `embedVideos: 'never'`). */
  blockRemoteContent?: boolean
  activityLimit?: number
  webhooks?: { id: string; url: string; secret: string; enabled: boolean; createdAt: number }[]
  /** Integração local com o Calendário do macOS (src/components/calendar). */
  calendarIntegration?: CalendarIntegrationSettings
  /** Painel de Produtividade (src/activity, docs/USAGE.md). */
  productivity?: ProductivitySettings
  /** Primeiros passos, dicas e retomada (src/onboarding, docs/USAGE.md). */
  onboarding?: OnboardingSettings
  /** Lembretes do macOS com ida e volta (src/reminders, docs/LOCAL-INTEGRATIONS.md). */
  remindersSync?: RemindersSyncSettings
  /** Revisão espaçada (src/review, docs/USAGE.md §Revisão espaçada). */
  review?: import('./review/reviewCore').ReviewSettings
  /** Fluxo diário: notas diárias, painel de calendário lateral (src/daily, docs/USAGE.md). */
  dailyFlow?: DailyFlowSettings
  /** Tipos de objeto (src/objecttypes/model.ts, docs/USAGE.md). */
  objectTypes?: import('./objecttypes/model').ObjectType[]
  /** Seção "Tipos" na barra lateral (ausente = visível quando houver tipos em uso). */
  objectTypesSidebar?: boolean
  /** Preferências de descoberta dos tipos (docs/USAGE.md). */
  objectTypesPrefs?: ObjectTypesPrefs
  /** Biblioteca de itens da lousa (seleções salvas para reutilizar; src/canvas/library.ts). */
  canvasLibrary?: import('./canvas/library').CanvasLibraryItem[]
}
export interface ObjectTypesPrefs {
  /** Cartão "Um tipo dá campos e um modelo…" já visto (botão "Entendi"). */
  introSeen?: boolean
  /** "Não perguntar de novo" no diálogo de aplicar. */
  confirmOff?: boolean
  /** Tipos já aplicados com confirmação (o diálogo aparece só na primeira vez de cada tipo). */
  confirmedTypes?: string[]
  /** Última escolha de "Inserir modelo" (padrão: sim). */
  insertTemplate?: boolean
  /** Gerenciador: mostrar tipos prontos não usados. */
  showUnused?: boolean
  /** Tipos nativos já semeados neste espaço (migração única; src/objecttypes/native.ts). */
  nativeTypesSeeded?: boolean
  /** Presets nativos que o usuário excluiu: não voltam sozinhos ("Restaurar tipos nativos" os recria). */
  nativeTypesDismissed?: string[]
  /** Ordem manual da seção "Tipos" da barra lateral (ids). */
  sidebarOrder?: string[]
  /** Campos das páginas que o usuário escolheu não incorporar, por tipo (docs/USAGE.md, "Campos retroativos"). */
  harvestDismissed?: Record<string, string[]>
}
export interface OnboardingSettings {
  /** Passos já feitos (id → instante). Marcados sozinhos por eventos locais do app. */
  done?: Record<string, number>
  /** Cartão de primeiros passos dispensado pelo usuário. */
  dismissed?: boolean
  /** "Você sabia?" desligado. */
  tipsOff?: boolean
  /** Dicas já mostradas/dispensadas (ids). */
  tipsSeen?: string[]
  /** Ponto de retomada: última página aberta e bloco do cursor. */
  resume?: { pageId: string; blockId?: string; at: number }
  /** Revisão semanal já tratada nesta semana (data ISO da segunda-feira). */
  weekReviewed?: string
}
export interface DailyFlowSettings {
  /** Banco gerenciado "Notas diárias" (criado na primeira nota). */
  databaseId?: string
  /** Modelo da nota: '' = padrão do fluxo diário; senão id de modelo (src/components/page/templates.ts). */
  templateId?: string
  /** Painel de calendário à direita (desligado por padrão). */
  panelOpen?: boolean
  panelWidth?: number
  panelTab?: 'day' | 'week' | 'month'
  weekStart?: 'auto' | 'sunday' | 'monday'
  /** Tarefas sem data própria numa nota diária herdam o dia da nota (padrão: ligado). */
  inheritTaskDate?: boolean
  /** Tarefas abertas de notas diárias passadas aparecem em Atrasadas (padrão: ligado). */
  showInheritedOverdue?: boolean
}
export interface ProductivitySettings {
  /** Registro de atividade local (padrão: ligado). */
  enabled?: boolean
  /** Meta diária opcional de palavras (0/ausente = sem meta). */
  dailyGoal?: number
  /** Início da semana no mapa de calor; 'auto' segue o idioma. */
  weekStart?: 'auto' | 'sunday' | 'monday'
}
export interface ActivityEntry { id: string; at: number; author: string; pageId: string; pageTitle: string; action: string; fields?: string[] }

export interface Meta {
  pages: Record<string, Page>
  settings: Settings
  notifications?: Record<string, LocalNotification>
  syncedBlocks?: Record<string, SyncedBlockRecord>
}

export interface PersonalTemplate { id: string; title: string; description: string; icon: string | null; blocks: unknown[]; createdAt: number; updatedAt: number }
export interface SyncedBlockRecord { id: string; blocks: unknown[]; updatedAt: number; sourcePageId: string }
export interface LocalNotification { id: string; pageId: string; title: string; body: string; dueAt: number; createdAt: number; readAt: number | null; firedAt: number | null; repeat?: 'none' | 'daily' | 'weekly' | 'monthly'
  /** Lembrete gerado por uma data de banco (`date.reminder`); id determinístico por ocorrência. */
  source?: { kind: 'date'; rowId: string; propertyId: string; occurrence: string; snoozed?: boolean }
  /** Excluído na Caixa de entrada; marcador impede que a mesma ocorrência dispare de novo. */
  dismissedAt?: number }
export interface LocalWorkspace { id: string; name: string; createdAt: number; current?: boolean }
export type Route = { type: 'home' } | { type: 'graph' } | { type: 'productivity' } | { type: 'tasks' } | { type: 'review' } | { type: 'page'; id: string; blockId?: string; viewId?: string; commentId?: string }
  /** Coleção de um tipo como tela própria (docs/USAGE.md). */
  | { type: 'objectType'; id: string }

/** Destinos de workspace:// além das rotas da interface (electron/deep-links.cjs). */
export type DeepLinkRoute = Route | { type: 'daily'; date: string } | { type: 'search'; q: string } | { type: 'new'; title: string }

/** Espelho Markdown (D1): texto claro, opt-in. */
export interface MirrorSettings {
  enabled: boolean
  directory: string
  acknowledgedAt: number
  vaultAcknowledged: boolean
  defaultDirectory: string
  vault: { enabled: boolean; locked: boolean }
  status: { updatedAt: number; pages: number; written: number; removed: number; error: { message: string; at: number } | null; root: string | null; hasFiles: boolean }
}

export interface BackupSettings { enabled: boolean; intervalHours: number; directory: string; retention: { daily: number; weekly: number; monthly: number }; defaultDirectory: string; icloud: { path: string; available: boolean } }
export interface BackupSetInfo { id: string; kind: 'auto' | 'manual' | 'pre-restore'; createdAt: number; size: number; fileCount: number; encrypted: boolean; schemaVersion: number | null; verified: boolean | null; healthy: boolean | null; problems: number }
export interface BackupDescription { ok: boolean; createdAt?: number; kind?: string; encrypted?: boolean; schemaVersion?: number; fileCount?: number; totalSize?: number; pages?: number; newerThanApp?: boolean; problems: { file: string; reason: string }[] }
export interface WorkspaceBackup {
  format: typeof COMPAT.record011
  version: 1
  exportedAt: string
  meta: Meta
  documents: Record<string, unknown[]>
  versions?: Record<string, DocumentVersion[]>
  activity?: ActivityEntry[]
}

export interface DocumentVersion {
  id: string
  savedAt: number
  blocks: unknown[]
  page?: Page
  reason?: 'edit' | 'metadata' | 'restore' | 'conflict' | 'checkpoint'
  /** Versão fixada/nomeada pelo usuário: nunca é podada pela política de retenção. */
  pinned?: boolean
  name?: string
}

export interface DocumentConflict { id: string; kind: 'deleted-document'; pageId: string; savedAt: number; blocks: unknown[]; page: Page }

export interface CalendarEventLink { eventId: string; itemId?: string; calendarId: string; propId: string; signature: string; createdAt: number; syncedAt: number; error?: string }
/** Vínculo tarefa ↔ Lembrete do macOS (C3b). `sig` = último estado sincronizado (título, conclusão, prazo). */
export interface ReminderLink { taskKey: string; reminderId: string; sig: string; localAt: number; remoteAt: number }
export interface SyncLogEntry { at: number; key: string; title: string; action: 'created' | 'pushed' | 'pulled' | 'conflict' | 'unlinked' | 'error'; detail: string }
export interface RemindersSyncSettings {
  /** Opt-in: a permissão do macOS só é pedida ao ligar. */
  enabled: boolean
  listName: string
  listId?: string
  /** Tarefas escolhidas para espelhar (chave da tarefa). */
  chosen?: Record<string, true>
  /** Removidas do espelho pelo usuário no app Lembretes: não voltam sozinhas com "hoje e atrasadas". */
  dismissed?: Record<string, true>
  /** Também espelha tarefas de hoje e atrasadas. */
  autoToday?: boolean
  links?: Record<string, ReminderLink>
  /** Últimos 50 eventos (criado, enviado, recebido, conflito, desvinculado, erro). */
  log?: SyncLogEntry[]
  lastSyncAt?: number
  lastError?: string
}

/** Tarefa agendada no Calendário do macOS (E2): ligação tarefa ↔ evento, chave = TaskItem.key. */
export interface TaskEventLink {
  taskKey: string; eventId: string; itemId?: string; calendarId: string
  /** Título da tarefa no último envio (mudou = renomear o evento). */
  title: string
  start: string; end: string
  /** Prazo e hora da tarefa quando foi agendada (mudou = oferecer mover o evento). */
  due: string | null; time: string | null
  createdAt: number; syncedAt: number
  /** O usuário escolheu manter o evento depois de a tarefa concluir ou sumir. */
  keepEvent?: boolean
  error?: string
}
export interface CalendarIntegrationSettings {
  enabled: boolean
  /** Calendários do macOS sobrepostos nas visualizações Calendário. */
  calendarIds: string[]
  /** Calendário onde "Adicionar ao Calendário" cria eventos ('' = padrão do sistema). */
  defaultCalendarId?: string
  /** Visualizações Calendário com a sobreposição oculta. */
  hiddenViews?: Record<string, boolean>
  /** Vínculos linha → evento criado pelo app. */
  links?: Record<string, CalendarEventLink>
  /** Tarefas agendadas no Calendário (E2), por chave de tarefa. */
  taskLinks?: Record<string, TaskEventLink>
  /** Duração padrão, em minutos, de um evento criado a partir de uma tarefa (padrão 30). */
  taskDuration?: number
}
export interface SystemCalendarStatus { available: boolean; reason?: string; authorization: 'notDetermined' | 'restricted' | 'denied' | 'fullAccess' | 'writeOnly' | 'unavailable' | 'unknown' }
export interface SystemCalendar { id: string; title: string; color: string; source: string; allowsModify: boolean }
export interface SystemCalendarEvent { id: string; itemId: string; calendarId: string; calendarTitle: string; color: string; title: string; start: string; end: string; allDay: boolean; location: string; readOnly: boolean }
export interface SystemCalendarEventInput { title: string; start: string; end: string; allDay: boolean; timeZone?: string | null; notes?: string; url?: string }
export interface AppleReminderList { id: string; title: string; source: string; allowsModify: boolean }
export interface AppleReminderDue { date: string; time?: string }
/** Lembrete do app Lembretes do macOS (C3b). `modified` é a última alteração, em ISO. */
export interface AppleReminder { id: string; listId: string; title: string; completed: boolean; notes: string; url: string; modified: string; due?: AppleReminderDue; completedAt?: string }
export interface DictationStatus { available: boolean; reason?: string; speech?: string; microphone?: string; recognizer?: boolean; onDevice?: boolean; locale?: string }
export interface DictationEvent { sessionId: number; type: 'ready' | 'level' | 'partial' | 'final' | 'error' | 'end'; text?: string; segment?: number; value?: number; code?: string; message?: string; cancelled?: boolean }

/** Ponte exposta pelo preload do Electron em `window.api`. */
export interface NativeApi {
  platform?: string
  runtimeInfo?(): Promise<{ platform: string; arch: string; calendar: boolean; reminders: boolean; notesImport: boolean; nativeEmbeddings: boolean; ocr: boolean; dictation: boolean; credentialStore: string; name: string }>
  loadMeta(): Promise<Meta | null>
  saveMeta(meta: Meta, base?: Meta | null): Promise<Meta | void>
  /** Gravação incremental (Electron): só as páginas alteradas desde a base `seq` (ver electron/meta-patch.mjs). */
  saveMetaDelta?(request: { seq: number | null; patch?: import('../electron/meta-patch.mjs').MetaPatch; meta?: Meta; base?: Meta | null }): Promise<{ seq: number; patch: import('../electron/meta-patch.mjs').MetaPatch } | { resync: true }>
  /** Conteúdo (blocos BlockNote) de uma página, ou null se ainda não existe. */
  loadDoc(id: string): Promise<unknown[] | null>
  saveDoc(id: string, blocks: unknown[], options?: { checkpoint?: boolean; base?: string | null; page?: Page; ownershipAt?: number; userEdit?: boolean }): Promise<Meta | void>
  /** Lote (importações): uma transação no processo principal, sem devolver o meta a cada página. */
  saveDocs?(entries: { id: string; blocks: unknown[]; options?: { base?: string | null; checkpoint?: boolean } }[]): Promise<{ saved: number } | void>
  listDocVersions(id: string): Promise<DocumentVersion[]>
  saveDocVersions(id: string, versions: DocumentVersion[]): Promise<void>
  deleteDoc(id: string): Promise<void>
  /** Abre o diálogo "Salvar como" e grava o arquivo. Resolve false se cancelado. */
  exportFile(defaultName: string, content: string): Promise<boolean>
  exportBinaryFile?(defaultName: string, data: Uint8Array): Promise<boolean>
  /** Abre o seletor de imagem e devolve uma data-URL, ou null se cancelado. */
  pickImage(): Promise<string | null>
  pickFiles?(): Promise<FileValue[]>
  /** Ação explícita do usuário: captura metadados e imagem pública como dados locais. */
  /** Informa ao processo principal o modo de incorporação de vídeos (Configurações → Segurança e privacidade). */
  setEmbedMode?(mode: 'always' | 'click' | 'never'): Promise<void>
  /** Atalhos personalizados do menu nativo (id do comando → acelerador do Electron); ids ausentes voltam ao padrão. */
  setShortcutAccelerators?(accelerators: Record<string, string>, recording?: boolean): Promise<void>
  fetchLinkPreview?(url: string): Promise<{ url: string; title: string; description: string; image: string; icon: string }>
  /** Abre a página inteira no navegador padrão após verificar o endereço. */
  openExternalPage?(url: string): Promise<void>
  /** F7: só ao clicar; uma requisição HTTPS ao feed que o usuário configurou. Nunca baixa nem instala. */
  checkForUpdates?(feedUrl: string): Promise<UpdateCheckResult>
  /** Abre no navegador a página de download do último resultado "available". */
  openUpdatePage?(): Promise<void>
  /** Lê THIRD-PARTY-NOTICES.md do app (caminho fixo no processo principal) e a versão do app. */
  readThirdPartyNotices?(): Promise<{ found: boolean; text: string; version: string }>
  revealThirdPartyNotices?(): Promise<void>
  exportPDF?(defaultName: string): Promise<boolean>
  openWindow?(route?: Route): Promise<void>
  listWorkspaces?(): Promise<LocalWorkspace[]>
  createWorkspace?(name: string): Promise<LocalWorkspace>
  openWorkspace?(id: string): Promise<void>
  isSchedulerLeader?(): Promise<boolean>
  securityInfo?(): Promise<{ enabled: boolean; algorithm?: string; keyProtection?: string; reason?: string; deviceCipher?: 'none' | 'keychain' | 'legacy'; legacyPending?: boolean }>
  deviceCipherStatus?(): Promise<{ mode: 'none' | 'keychain' | 'legacy'; backups: { exists: boolean; count: number; expiresAt: number | null } }>
  deviceCipherSet?(enabled: boolean): Promise<{ mode: 'none' | 'keychain' | 'legacy'; backups: { exists: boolean; count: number; expiresAt: number | null } }>
  deviceCipherRemoveBackups?(): Promise<{ mode: 'none' | 'keychain' | 'legacy'; backups: { exists: boolean; count: number; expiresAt: number | null } }>
  deviceCipherOpenFolder?(): Promise<boolean>
  localApiInfo?(): Promise<{ enabled: boolean; url?: string }>
  agentOverview?(): Promise<import('./agent/types').AgentOverview>
  agentPending?(): Promise<import('./agent/types').AgentApproval[]>
  clipperPairStart?(): Promise<{ code: string; expiresAt: number; url: string }>
  clipperPairCancel?(): Promise<boolean>
  agentCreateClient?(input: { name: string; scopes: import('./agent/types').AgentScope[]; autoWrite?: boolean }): Promise<{ client: import('./agent/types').AgentClientView; token: string; snippets: import('./agent/types').AgentSnippets }>
  agentUpdateClient?(id: string, patch: { name?: string; scopes?: import('./agent/types').AgentScope[]; autoWrite?: boolean }): Promise<import('./agent/types').AgentClientView>
  agentRevokeClient?(id: string): Promise<boolean>
  agentUpdateSettings?(patch: { timeoutSec?: number; legacyNoticeShown?: boolean }): Promise<import('./agent/types').AgentSettingsView>
  agentDecide?(id: string, decision: 'approve' | 'reject', options?: { grantHour?: boolean }): Promise<boolean>
  agentRevokeGrant?(clientId: string): Promise<boolean>
  agentLog?(limit?: number): Promise<import('./agent/types').AgentLogEntry[]>
  agentLogClear?(): Promise<boolean>
  agentConnector?(): Promise<import('./agent/types').AgentSnippets & { command: string; packaged: boolean }>
  agentInstallCli?(): Promise<{ cancelled: boolean; path?: string; state?: string }>
  agentUninstallCli?(): Promise<{ cancelled: boolean; path?: string; state?: string }>
  onAgentEvent?(handler: (event: import('./agent/types').AgentEvent) => void): () => void
  copyLocalApiToken?(): Promise<void>
  copyText?(value: string): Promise<void>
  listActivity?(): Promise<ActivityEntry[]>
  productivityLoad?(): Promise<import('../electron/productivity-data.mjs').ProductivityData | null>
  productivityRecord?(delta: import('../electron/productivity-data.mjs').ProductivityDelta): Promise<import('../electron/productivity-data.mjs').ProductivityData | { locked: true }>
  productivityBackfill?(days: Record<string, Partial<import('../electron/productivity-data.mjs').ProductivityDay>>): Promise<import('../electron/productivity-data.mjs').ProductivityData | { locked: true }>
  productivityClear?(): Promise<import('../electron/productivity-data.mjs').ProductivityData | { locked: true }>
  webhookStatus?(): Promise<{ hookId: string; eventId: string; attempts: number; sentAt?: number; error?: string }[]>
  saveMetaConflict?(meta: Meta): Promise<void>
  listDocumentConflicts?(): Promise<DocumentConflict[]>
  snapshotBackup?(): Promise<WorkspaceBackup | null>
  listAutoBackups?(): Promise<{ file: string; savedAt: number; size: number }[]>
  loadAutoBackup?(file: string): Promise<WorkspaceBackup>
  backupSettings?(): Promise<BackupSettings>
  backupSettingsSet?(patch: Partial<Pick<BackupSettings, 'enabled' | 'intervalHours' | 'directory' | 'retention'>>): Promise<BackupSettings>
  backupChooseFolder?(): Promise<string | null>
  backupRevealFolder?(): Promise<boolean>
  backupList?(verify?: 'quick' | 'full'): Promise<BackupSetInfo[]>
  backupNow?(): Promise<{ id: string; createdAt: number; removed: number }>
  backupDescribe?(id: string): Promise<BackupDescription>
  /** Restauração completa: substitui o espaço (guardando o estado atual como cópia) e recarrega a janela. */
  backupRestore?(id: string): Promise<{ restored: number; safetyBackup: string | null; encrypted: boolean }>
  mirrorSettings?(): Promise<MirrorSettings>
  mirrorSettingsSet?(patch: { enabled?: boolean; acknowledged?: boolean; directory?: string; vaultAcknowledged?: boolean }): Promise<Omit<MirrorSettings, 'defaultDirectory' | 'vault' | 'status'>>
  mirrorChooseFolder?(): Promise<string | null>
  mirrorSyncState?(): Promise<{ version: number; globalSig: string; pages: Record<string, { sig: string; files: string[] }> } | null>
  mirrorApply?(payload: { workspaceName?: string; locale?: string; files?: Record<string, string | Uint8Array>; pages?: Record<string, { sig: string; files: string[] }>; version?: number; globalSig?: string; complete?: boolean; force?: boolean; partial?: boolean; error?: string }): Promise<{ written: number; removed: number; pages: number; updatedAt: number } | null>
  mirrorReveal?(): Promise<boolean>
  mirrorRemove?(): Promise<{ removed: number }>
  draftLoad?(pageId: string, windowId: string): Promise<unknown[] | null>
  draftSave?(pageId: string, windowId: string, blocks: unknown[]): Promise<void>
  draftDelete?(pageId: string, windowId: string): Promise<void>
  localAIModels?(): Promise<string[]>
  localAIGenerate?(input: { model: string; prompt: string; context: string; operation: 'write' | 'summarize' | 'translate' | 'ask' | 'autofill'; locale: Locale }): Promise<string>
  localAICancel?(): Promise<void>
  pickTranscriptionModel?(): Promise<string | null>
  transcribeAudio?(input: { data: Uint8Array; mimeType: string; modelPath: string; language: 'auto' | 'pt' | 'en' }): Promise<string>
  cancelTranscription?(): Promise<void>
  calendarStatus?(): Promise<SystemCalendarStatus>
  calendarRequestAccess?(): Promise<SystemCalendarStatus>
  calendarList?(): Promise<{ calendars: SystemCalendar[]; defaultCalendarId: string }>
  calendarEvents?(input: { start: string; end: string; calendarIds: string[] }): Promise<SystemCalendarEvent[]>
  calendarCreateEvent?(input: SystemCalendarEventInput & { calendarId?: string }): Promise<SystemCalendarEvent>
  calendarUpdateEvent?(input: Partial<SystemCalendarEventInput> & { id: string; itemId?: string }): Promise<SystemCalendarEvent>
  calendarDeleteEvent?(input: { id: string; itemId?: string }): Promise<{ deleted: boolean }>
  remindersStatus?(): Promise<SystemCalendarStatus>
  remindersRequestAccess?(): Promise<SystemCalendarStatus>
  remindersEnsureList?(input: { title: string; id?: string }): Promise<{ list: AppleReminderList; created: boolean }>
  remindersList?(input: { listId: string }): Promise<{ reminders: AppleReminder[] }>
  remindersUpsert?(input: { listId?: string; id?: string; title?: string; notes?: string; url?: string; completed?: boolean; due?: AppleReminderDue | null }): Promise<AppleReminder>
  remindersComplete?(input: { id: string; completed?: boolean }): Promise<AppleReminder>
  remindersDelete?(input: { id: string }): Promise<{ deleted: boolean }>
  openPrivacySettings?(pane: 'calendars' | 'reminders' | 'microphone' | 'speech' | 'dictation' | 'automation'): Promise<void>
  dictationStatus?(locale: Locale): Promise<DictationStatus>
  dictationStart?(input: { locale: Locale }): Promise<{ sessionId: number }>
  dictationStop?(): Promise<void>
  dictationCancel?(): Promise<void>
  onDictationEvent?(handler: (event: DictationEvent) => void): () => void
  onNavigate?(handler: (route: DeepLinkRoute) => void): () => void
  onDataChanged?(handler: (change: { meta?: Meta; documentId?: string; cacheReset?: boolean }) => void): () => void
  /** Abre a pasta de dados no Finder. */
  revealDataFolder(): Promise<void>
  /** Fechamento desktop aguarda a gravação dos editores e metadados. */
  onBeforeClose?(handler: () => Promise<void>): () => void
  onCommand?(handler: (command: string) => void): () => void
  /** B5: abrir .md/.txt avulso (o main guarda o caminho; aqui só o `fileId`). */
  /** D3b: saída JSON do osascript (parse em src/importers/appleNotes). */
  appleNotesFolders?(): Promise<string>
  appleNotesBatch?(folderId: string, offset: number, limit: number): Promise<string>
  appleNotesCancel?(): Promise<boolean>
  openMarkdownFile?(): Promise<ExternalFile | null>
  externalFileCheck?(fileId: string): Promise<{ state: 'same' | 'changed' | 'missing' | 'invalid'; size?: number }>
  externalFileReload?(fileId: string): Promise<ExternalFile>
  externalFileSave?(fileId: string, text: string, options?: { force?: boolean }): Promise<{ saved: boolean; conflict?: 'changed' | 'missing' | 'invalid' }>
  externalFileRelease?(fileId: string): Promise<boolean>
  onExternalFile?(handler: (file: ExternalFile) => void): () => void
}

export interface ExternalFile { fileId: string; name: string; path: string; text: string; size: number }

declare global {
  interface Window {
    api?: NativeApi
  }
}
