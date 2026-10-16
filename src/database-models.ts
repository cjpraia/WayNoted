/** Contratos opcionais de bancos de dados. Ausência dos campos preserva dados antigos. */
export interface FileValue {
  id: string
  name: string
  mimeType: string
  /** Data URL local; nenhum endereço remoto é necessário para abrir o anexo. */
  data: string
  size: number
}

export interface PlaceValue { label: string; lat: number; lng: number }

export interface RichTextRun { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; code?: boolean; href?: string; /** Cor da paleta (ex. "red") ou hex; usada pelo style() das fórmulas. */ color?: string; background?: string }
export interface RichTextValue { type: 'richText'; runs: RichTextRun[] }

export interface DateConfig {
  startTime?: string
  endTime?: string
  timeZone?: string
  repeat?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
  /** Detalhes da repetição (intervalo, dias, fim). Ausente = intervalo 1, sem fim (dados antigos). */
  recurrence?: DateRecurrence
  /** Lembrete relativo ao início, em minutos antes (0 = no horário; 1440 = 1 dia antes). */
  reminder?: number
  /** Histórico mínimo de conclusões de tarefa recorrente (epoch ms, mais recentes no fim). */
  completions?: number[]
  completedCount?: number
}

export interface DateRecurrence {
  /** A cada N dias/semanas/meses/anos (padrão 1). */
  interval?: number
  /** Semanal: dias da semana (0 = domingo). Padrão: o dia da data inicial. */
  weekdays?: number[]
  /** Mensal: mesmo dia do mês (padrão), "2ª terça" ou "última sexta". */
  monthly?: 'day' | 'weekday' | 'lastWeekday'
  /** Fim por data (inclusiva) ou por número de ocorrências. */
  until?: string
  count?: number
  /** Início da série; preserva fim de mês, 29/02 e contagem ao avançar. */
  anchor?: string
}

export interface DatabaseSelectOptionConfig {
  group?: 'todo' | 'progress' | 'complete'
  /** Cor livre (#rrggbb); quando presente substitui a cor da paleta na exibição. */
  customColor?: string
}

/** Agregações de rollup e de cálculo de coluna (rodapé da tabela). */
export type RollupAggregation = 'count' | 'countValues' | 'countUnique' | 'sum' | 'average' | 'median' | 'min' | 'max' | 'range'
  | 'showOriginal' | 'unique' | 'empty' | 'notEmpty' | 'percentEmpty' | 'percentNotEmpty'
  | 'checked' | 'unchecked' | 'percentChecked' | 'percentUnchecked' | 'earliest' | 'latest' | 'dateRange'
export type TableCalculation = 'none' | Exclude<RollupAggregation, 'showOriginal' | 'unique'>

/** Regra simples aplicada às páginas relacionadas (filtro do rollup e da escolha de relação). */
export interface RelatedFilterRule {
  id: string
  propertyId: string
  op: 'is' | 'isNot' | 'contains' | 'notContains' | 'gt' | 'lt' | 'gte' | 'lte' | 'before' | 'after' | 'isEmpty' | 'isNotEmpty' | 'checked' | 'unchecked'
  value?: string | number | boolean | null
}
export interface RollupConfigExtras {
  /** Só as páginas relacionadas que atendem às regras entram no rollup. */
  filter?: RelatedFilterRule[]
  filterOperator?: 'and' | 'or'
}

export type ButtonAction =
  | { kind: 'setProperty'; propertyId: string; value: string | number | boolean | null }
  | { kind: 'setTitle'; value: string }
  | { kind: 'createRow'; templateId?: string }
  | { kind: 'duplicateRow' }
  | { kind: 'archiveRow' }

export interface DatabasePropertyConfig {
  numberFormat?: 'number' | 'currency' | 'percent' | 'progress'
  currency?: string
  relationMirrorPropertyId?: string
  buttonActions?: ButtonAction[]
  uniqueIdPrefix?: string
  /** Exibição de datas (padrão: data completa, ex. "8 de outubro de 2026"). */
  dateFormat?: 'full' | 'short' | 'monthDayYear' | 'dayMonthYear' | 'yearMonthDay' | 'relative'
  /** Exibição da hora (padrão: 24 horas em pt-BR, 12 horas em en-US). */
  timeFormat?: '12h' | '24h'
  /** Seleção dependente: cada opção desta propriedade lista as opções da propriedade-mãe em que aparece. */
  dependsOn?: { propertyId: string; links: Record<string, string[]> }
  /** Escolha de páginas de uma relação: filtro salvo, ordenação e propriedades exibidas dos candidatos. */
  relationPicker?: { filters?: RelatedFilterRule[]; filterOperator?: 'and' | 'or'; sortPropertyId?: string; sortDirection?: 'asc' | 'desc'; shownPropertyIds?: string[] }
  /** Data recorrente: ao concluir, mover a data (padrão) ou criar uma nova cópia da linha. */
  recurrenceOnComplete?: 'advance' | 'copy'
  /** Propriedade status/checkbox que conclui a tarefa; 'none' desliga. Padrão: primeiro status, senão checkbox. */
  recurrenceDoneProperty?: string
}

export interface DatabaseRowConfig {
  createdBy?: string
  updatedBy?: string
  sequence?: number
  subitemParentId?: string | null
  dependencyIds?: string[]
}

export type FilterTree = { kind: 'rule'; filterId: string } | { kind: 'group'; id?: string; operator: 'and' | 'or'; children: FilterTree[] }

export interface ConditionalColorRule {
  id: string
  propertyId: string
  operator: 'is' | 'isNot' | 'contains' | 'gt' | 'lt' | 'isEmpty'
  value?: string | number | boolean | null
  color: string
}

export type DashboardWidget = {
  id: string
  kind: 'chart' | 'number' | 'list' | 'calendar'
  title: string
  viewId?: string
  propertyId?: string
}

export interface DatabaseViewConfig {
  /** Visualização vinculada: id da visualização da fonte de onde esta aba foi copiada ("Visualizações em <fonte>"); evita duplicar. */
  sourceViewId?: string
  filterTree?: FilterTree
  subgroupBy?: string
  hiddenGroups?: string[]
  /** Quantas linhas carregar por vez (tabela, lista, galeria, quadro, feed). Ausente ou 0 = todas. */
  loadLimit?: number
  frozenColumns?: number
  /** Per-column wrapping; absent keeps the compact table layout. */
  wrappedColumns?: string[]
  showPageIcon?: boolean
  /** 'property' usa a primeira imagem de `cardPreviewPropertyId` (propriedade de arquivos). */
  cardPreview?: 'none' | 'cover' | 'content' | 'property'
  cardPreviewPropertyId?: string
  // Opções do painel "Configurações da visualização" (docs/DEVELOPMENT.md). Todas opcionais;
  // ausência = comportamento anterior. Dados inválidos são descartados ao abrir (workspace.ts).
  /** Mostra o título do banco acima das abas (padrão: sim). */
  showSourceTitle?: boolean
  /** Quebra o texto de todas as colunas/cartões (tabela, lista, quadro, galeria). */
  wrapAll?: boolean
  /** Tabela: linhas verticais entre colunas (padrão: sim). */
  verticalLines?: boolean
  /** Tabela: numeração das linhas à esquerda. */
  rowNumbers?: boolean
  /** Quadro: fundo colorido das colunas (padrão: sim). */
  colorColumns?: boolean
  cardSize?: 'small' | 'medium' | 'large'
  /** Quadro/galeria: propriedades empilhadas ('list', padrão) ou lado a lado ('compact'). */
  cardLayout?: 'compact' | 'list'
  /** Calendário (padrão: sim). */
  showWeekends?: boolean
  showWeekNumbers?: boolean
  /** Linha do tempo: coluna de títulos à esquerda (padrão: sim). */
  timelineTable?: boolean
  /** Ordem dos grupos: manual (ordem das opções) ou alfabética. */
  groupSort?: 'manual' | 'alphabetical' | 'reverse'
  /** Padrão: quadro mostra grupos vazios; tabela/lista/galeria os ocultam. */
  hideEmptyGroups?: boolean
  /** Contagem de itens no cabeçalho de cada grupo (padrão: sim). */
  showGroupCount?: boolean
  chartType?: 'horizontalBar' | 'verticalBar' | 'line' | 'donut' | 'number' | 'stackedBar' | 'cumulativeLine' | 'sankey' | 'treemap'
  /** Segunda propriedade do gráfico: pilhas (empilhado), destino (Sankey) ou subnível (árvore). */
  chartSecondaryGroupBy?: string
  mapPlacePropertyId?: string
  colorRules?: ConditionalColorRule[]
  dashboardWidgets?: DashboardWidget[]
  formFields?: string[]
  formTitle?: string
  formDescription?: string
  feedDateProp?: string
}

export interface DatabaseTemplate {
  id: string
  name: string
  title: string
  props: Record<string, unknown>
  icon?: string | null
  /** Snapshot local do corpo BlockNote, aplicado a cada linha criada com o template. */
  bodyBlocks?: unknown[]
  repeat?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
  nextRunAt?: number
}

/** Ações das automações: as do botão mais mover, criar tarefa, adicionar tag/tipo e notificar. Tudo local. */
export type AutomationAction =
  | ButtonAction
  /** Move a linha para outro banco (deve ser a última ação da regra). */
  | { kind: 'moveRow'; databaseId: string }
  /** Acrescenta uma tarefa (checklist) ao corpo da linha. `{titulo}` vira o título da linha; `inDays` define o prazo a partir de hoje. */
  | { kind: 'createTask'; title: string; inDays?: number }
  /** "Tag": aplica um tipo de objeto à linha. */
  | { kind: 'addType'; typeId: string }
  /** Cria um lembrete local imediato na Caixa de entrada. `{titulo}` vira o título da linha. */
  | { kind: 'notify'; message: string }

export type AutomationTrigger =
  | { kind: 'propertyChange'; propertyId: string }
  | { kind: 'scheduled'; every: 'daily' | 'weekly' | 'monthly'; nextRunAt: number }
  /** Linha/página criada neste banco. */
  | { kind: 'rowCreated' }
  /** Tag/tipo adicionado à linha (`typeId` vazio = qualquer). */
  | { kind: 'typeAdded'; typeId?: string }
  /** A linha foi marcada como concluída (Status "Concluído" ou caixa de conclusão). */
  | { kind: 'taskCompleted' }
  /** A data de uma propriedade chegou (`offsetDays` negativo = antes, positivo = depois). Dispara uma vez por data. */
  | { kind: 'dateArrived'; propertyId: string; offsetDays?: number }

export interface AutomationCondition {
  /** `@title` para o título da linha. */
  propertyId: string
  op: 'equals' | 'notEquals' | 'contains' | 'notEmpty' | 'empty'
  value?: string | number | boolean | null
}

export interface AutomationRunLog {
  at: number
  automationId: string
  name: string
  rowId: string
  rowTitle: string
  status: 'done' | 'error' | 'skipped' | 'test'
  detail: string
}

export interface DatabaseAutomation {
  id: string
  name: string
  enabled: boolean
  trigger: AutomationTrigger
  /** Todas precisam valer (E) para a regra rodar. */
  conditions?: AutomationCondition[]
  actions: AutomationAction[]
  /** "Data chegou": linha → data (AAAA-MM-DD) em que já disparou, para não repetir. */
  fired?: Record<string, string>
}

export interface DatabaseConfig {
  rowLayout?: {
    hidden?: string[]; sections?: { id: string; name: string; propertyIds: string[] }[]
    pinnedPropertyIds?: string[]; detailsPropertyIds?: string[]; showPropertyIcons?: boolean; fullWidth?: boolean
    tabs?: { id: string; name: string; databaseId: string; viewId?: string; relationPropertyId?: string }[]
  }
  templates?: DatabaseTemplate[]
  defaultTemplateId?: string
  /** Tipo aplicado às linhas novas (docs/USAGE.md, "Ajustes pós-teste"). `null` = o usuário recusou; ausente = nunca decidido (a sugestão automática pode aparecer uma vez). */
  newRowTypeId?: string | null
  nextSequence?: number
  linkedSourceId?: string
  sourceDatabaseIds?: string[]
  automations?: DatabaseAutomation[]
  /** Últimas 50 execuções das automações (inclusive testes), da mais recente para a mais antiga. */
  automationLog?: AutomationRunLog[]
  /** Página convertida em banco: o corpo original continua acima da tabela, como descrição (docs/USAGE.md). */
  bodyDescription?: boolean
}
