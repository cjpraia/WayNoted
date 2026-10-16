import type { DatabaseSchema, Page, View, ViewType } from '../../../types'
import type { SettingsScreen } from './model'

/** Tudo de que as telas do painel precisam; montado pelo DatabaseView. */
export interface SettingsCtx {
  db: Page
  schema: DatabaseSchema
  view: View
  /** Banco bloqueado (db.locked): nada de configuração além de desbloquear. */
  readOnly: boolean
  /** Esquema não editável aqui (bloqueado, vinculado ou multifonte). */
  schemaLocked: boolean
  /** Linhas não editáveis aqui (multifonte). */
  dataReadOnly: boolean
  rowCount: number
  canDeleteView: boolean
  onImportCsv: () => void
  onExportCsv: () => void
  onCreateLinked: () => void
  onDuplicateView: () => void
  onDeleteView: () => void
  /** Ausente quando o banco já está aberto como página inteira. */
  onOpenFull?: () => void
  /** Visão virtual (coleção de um tipo, sem banco por trás): sem fonte, propriedades, automações, bloqueio nem "Mais configurações". */
  virtual?: boolean
  /** Troca de layout da visão virtual (substitui `actions.changeViewType`, que exige um banco). */
  onChangeLayout?: (type: ViewType) => void
  /** Layouts oferecidos (a coleção só tem os que sabe desenhar). */
  layouts?: ViewType[]
}

export interface ScreenProps {
  ctx: SettingsCtx
  push: (screen: SettingsScreen, from?: string) => void
  close: () => void
}

const IN_TYPE: Record<ViewType, [string, string]> = {
  table: ['na tabela', 'table'], board: ['no quadro', 'board'], calendar: ['no calendário', 'calendar'], list: ['na lista', 'list'],
  gallery: ['na galeria', 'gallery'], timeline: ['na linha do tempo', 'timeline'], chart: ['no gráfico', 'chart'], dashboard: ['no painel', 'dashboard'],
  map: ['no mapa', 'map'], feed: ['no feed', 'feed'], form: ['no formulário', 'form'],
}
/** "na tabela" / "table" para "Mostradas na tabela" / "Shown in table". */
export const inType = (type: ViewType) => IN_TYPE[type] ?? IN_TYPE.table
