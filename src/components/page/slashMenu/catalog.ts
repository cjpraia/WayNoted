export type SlashCategory = 'Suggested' | 'Basic blocks' | 'Media' | 'Database' | 'Advanced blocks' | 'Inline' | 'Embeds' | 'Turn into' | 'Actions' | 'Text color' | 'Background color'
export type SlashStatus = 'local' | 'local-adaptation' | 'requires-local-model' | 'offline-reference'
export interface SlashCommand {
  id: string
  en: string
  pt: string
  category: SlashCategory
  operation: string
  aliases: string[]
  status: SlashStatus
  limit?: string
}
const command = (id: string, en: string, pt: string, category: SlashCategory, operation: string, aliases: string[] = [], status: SlashStatus = 'local', limit?: string): SlashCommand => ({ id, en, pt, category, operation, aliases: [...new Set([id, en.toLowerCase(), pt.toLowerCase(), ...aliases])], status, limit })

export const SLASH_CATALOG: readonly SlashCommand[] = [
  command('ai-meeting-notes', 'AI Meeting Notes', 'Notas de reunião com IA', 'Suggested', 'block:aiMeetingNotes', ['meeting', 'reunião', 'transcrição'], 'requires-local-model', 'Resumo exige modelo local; gravação/transcrição não começam automaticamente.'),
  command('html-suggested', 'HTML', 'HTML', 'Suggested', 'block:htmlSandbox', ['html'], 'local-adaptation', 'HTML roda em sandbox sem rede e sem acesso à origem do app.'),
  command('text', 'Text', 'Texto', 'Basic blocks', 'block:paragraph', ['paragraph', 'parágrafo', 'plain']),
  ...([1, 2, 3, 4] as const).map((level) => command(`heading-${level}`, `Heading ${level}`, `Título ${level}`, 'Basic blocks', `heading:${level}`, [`h${level}`, '#'.repeat(level), `titulo ${level}`])),
  command('bulleted-list', 'Bulleted list', 'Lista com marcadores', 'Basic blocks', 'block:bulletListItem', ['bullet', 'lista']),
  command('numbered-list', 'Numbered list', 'Lista numerada', 'Basic blocks', 'block:numberedListItem', ['numbered', 'lista', 'num']),
  command('to-do-list', 'To-do list', 'Lista de tarefas', 'Basic blocks', 'block:checkListItem', ['todo', 'checklist', 'tarefa']),
  command('toggle-list', 'Toggle list', 'Lista recolhível', 'Basic blocks', 'block:toggleListItem', ['toggle', 'recolher']),
  command('page', 'Page', 'Página', 'Basic blocks', 'page:owned', ['pagina', 'subpage']),
  command('callout', 'Callout', 'Destaque', 'Basic blocks', 'block:callout', ['alerta']),
  command('quote', 'Quote', 'Citação', 'Basic blocks', 'block:quote', ['citar']),
  command('table', 'Table', 'Tabela', 'Basic blocks', 'table', ['simple table', 'tabela simples']),
  command('divider', 'Divider', 'Divisor', 'Basic blocks', 'block:divider', ['separator', 'linha', 'div']),
  command('link-to-page', 'Link to page', 'Link para página', 'Basic blocks', 'page:linked', ['link page', 'página existente']),
  command('image', 'Image', 'Imagem', 'Media', 'native:image', ['foto', 'picture']),
  command('video', 'Video', 'Vídeo', 'Media', 'native:video', ['filme']),
  command('audio', 'Audio', 'Áudio', 'Media', 'native:audio', ['som']),
  command('code', 'Code', 'Código', 'Media', 'block:codeBlock', ['code block', 'código-fonte']),
  command('file', 'File', 'Arquivo', 'Media', 'file', ['attachment', 'anexo']),
  command('online-video', 'Online video', 'Vídeo online', 'Media', 'block:onlineVideo', ['youtube', 'vimeo', 'embed video', 'incorporar vídeo', 'spotify', 'loom'], 'local-adaptation', 'Player oficial do provedor (YouTube, Vimeo, Loom, Dailymotion, Spotify) em iframe isolado; modo Sempre/Clicar/Nunca em Configurações → Segurança e privacidade.'),
  command('web-bookmark', 'Web bookmark', 'Marcador da web', 'Media', 'block:bookmark', ['bookmark', 'link', 'book']),
  // Banco de dados: criar um banco, mostrar um existente (vinculada) e depois os layouts (Hick: os 3 primeiros cobrem quase todo uso).
  command('database-inline', 'Database - Inline', 'Banco de dados — embutido', 'Database', 'database:table:inline', ['database', 'banco', 'datainline', 'database inline', 'banco embutido']),
  command('database-full-page', 'Database - Full page', 'Banco de dados — página inteira', 'Database', 'database:table:page', ['database', 'banco', 'datafullpage', 'database full page', 'data full page', 'banco página inteira']),
  command('linked-data-source', 'Linked view of data source', 'Visualização vinculada de fonte de dados', 'Database', 'database:linked', ['linked database', 'fonte vinculada', 'visualização vinculada', 'linked view', 'banco existente', 'vincular'], 'local-adaptation', 'Fonte selecionada no mesmo workspace.'),
  ...([['table', 'Table view', 'Visualização de tabela'], ['board', 'Board view', 'Visualização de quadro'], ['gallery', 'Gallery view', 'Visualização de galeria'], ['list', 'List view', 'Visualização de lista'], ['feed', 'Feed view', 'Visualização de feed'], ['dashboard', 'Dashboard view', 'Visualização de painel'], ['calendar', 'Calendar view', 'Visualização de calendário'], ['timeline', 'Timeline view', 'Visualização de linha do tempo'], ['map', 'Map view', 'Visualização de mapa']] as const).map(([type, en, pt]) => command(`${type}-view`, en, pt, 'Database', `database:${type}:inline`, [type, 'database', 'banco'])),
  ...([['verticalBar', 'Vertical bar chart', 'Gráfico de barras verticais'], ['horizontalBar', 'Horizontal bar chart', 'Gráfico de barras horizontais'], ['line', 'Line chart', 'Gráfico de linhas'], ['donut', 'Donut chart', 'Gráfico de rosca'], ['number', 'Number chart', 'Gráfico de número']] as const).map(([type, en, pt]) => command(`chart-${type}`, en, pt, 'Database', `chart:${type}`, ['chart', 'grafico', 'gráfico', 'database', 'banco'])),
  command('form', 'Form', 'Formulário', 'Database', 'database:form:inline', ['survey', 'formulario'], 'local-adaptation', 'Formulário pessoal local, sem link público.'),
  command('table-of-contents', 'Table of contents', 'Índice', 'Advanced blocks', 'block:tableOfContents', ['toc', 'sumário']),
  command('block-equation', 'Block equation', 'Equação em bloco', 'Advanced blocks', 'block:equation', ['latex', 'math']),
  command('button', 'Button', 'Botão', 'Advanced blocks', 'block:localButton', ['action', 'ação', 'template']),
  command('breadcrumb', 'Breadcrumb', 'Caminho da página', 'Advanced blocks', 'block:breadcrumb', ['trail', 'navegação', 'bread']),
  command('tabs', 'Tabs', 'Abas', 'Advanced blocks', 'block:tabs', ['tab', 'abas'], 'local-adaptation', 'Abas contêm texto local; não incluem blocos aninhados.'),
  command('synced-block', 'Synced block', 'Bloco sincronizado', 'Advanced blocks', 'synced', ['shared', 'sincronizado']),
  ...([1, 2, 3, 4] as const).map((level) => command(`toggle-heading-${level}`, `Toggle heading ${level}`, `Título recolhível ${level}`, 'Advanced blocks', `toggle-heading:${level}`, ['toggle heading', 'título recolhível'])),
  ...([2, 3, 4, 5] as const).map((count) => command(`columns-${count}`, `${count} columns`, `${count} colunas`, 'Advanced blocks', `columns:${count}`, ['column', 'coluna'])),
  command('ai-meeting-notes-advanced', 'AI Meeting Notes', 'Notas de reunião com IA', 'Advanced blocks', 'block:aiMeetingNotes', ['meeting', 'reunião'], 'requires-local-model', 'Resumo exige modelo local.'),
  command('code-mermaid', 'Code - Mermaid', 'Código — Mermaid', 'Advanced blocks', 'block:mermaid', ['diagram', 'diagrama'], 'local-adaptation', 'Runtime Mermaid empacotado localmente, em iframe isolado; recursos externos bloqueados.'),
  command('ai-block', 'AI Block', 'Bloco de IA', 'Advanced blocks', 'block:aiBlock', ['ia', 'generate'], 'requires-local-model', 'Geração explícita requer modelo local instalado.'),
  command('mention-person', 'Mention a person', 'Mencionar pessoa', 'Inline', 'inline:person', ['@', 'pessoa'], 'local-adaptation', 'Menciona somente o perfil local.'),
  command('mention-page', 'Mention a page or data source', 'Mencionar página ou fonte de dados', 'Inline', 'inline:page', ['@page', 'página', 'mention'], 'local-adaptation', 'Pesquisa páginas locais.'),
  command('date-reminder', 'Date or reminder', 'Data ou lembrete', 'Inline', 'inline:date', ['date', 'data', 'reminder']),
  command('emoji', 'Emoji', 'Emoji', 'Inline', 'native:emoji', ['emoticon']),
  command('inline-equation', 'Inline equation', 'Equação inline', 'Inline', 'inline:equation', ['latex', 'math']),
  command('embed', 'Embed', 'Incorporar', 'Embeds', 'block:externalReference', ['url', 'iframe'], 'local-adaptation', 'Cartão com prévia pública capturada após escolha explícita; abre o site inteiro no navegador.'),
  command('html', 'HTML', 'HTML', 'Embeds', 'block:htmlSandbox', ['embed', 'code', 'page', 'webpage'], 'local-adaptation', 'HTML isolado por CSP e iframe sandbox sem rede.'),
  ...['Google Drive', 'Tweet', 'GitHub Gist', 'Google Maps', 'Figma', 'Abstract', 'InVision', 'Mixpanel', 'Framer', 'Whimsical', 'Miro', 'Sketch', 'Excalidraw'].map((name) => command(`embed-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, name, 'Embeds', `external:${name}`, [name.toLowerCase(), 'embed'], 'offline-reference', 'Referência externa local; sem autenticação, prévia ou sincronização.')),
  command('embed-pdf', 'PDF', 'PDF', 'Embeds', 'file:pdf', ['documento'], 'local-adaptation', 'Carrega PDF local de até 8 MB; sem conexão externa.'),
  ...['Loom', 'Typeform', 'CodePen', 'Replit', 'Hex', 'Deepnote', 'Trello', 'Slack', 'Pitch', 'OneDrive', 'PagerDuty'].map((name) => command(`embed-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, name, 'Embeds', `external:${name}`, [name.toLowerCase(), 'embed'], 'offline-reference', 'Referência externa local; sem autenticação, prévia ou sincronização.')),
  command('import-word', 'Word', 'Word', 'Embeds', 'import:word', ['docx', 'importar'], 'local-adaptation', 'Importa DOCX local como subpágina; fidelidade pode variar.'),
  ...['Monday', 'Quip'].map((name) => command(`embed-${name.toLowerCase()}`, name, name, 'Embeds', `external:${name}`, [name.toLowerCase(), 'embed'], 'offline-reference', 'Referência externa local; sem autenticação, prévia ou sincronização.')),
  command('import-zip', 'ZIP', 'ZIP', 'Embeds', 'import:zip', ['importar', 'arquivo zip'], 'local-adaptation', 'Importa páginas de pacote ZIP local.'),
  command('import-pdf', 'PDF', 'PDF', 'Embeds', 'import:pdf', ['importar pdf'], 'local-adaptation', 'Importa PDF local como subpágina.'),
  ...([['text', 'Text', 'Texto', 'paragraph'], ['heading-1', 'Heading 1', 'Título 1', 'heading:1'], ['heading-2', 'Heading 2', 'Título 2', 'heading:2'], ['heading-3', 'Heading 3', 'Título 3', 'heading:3'], ['heading-4', 'Heading 4', 'Título 4', 'heading:4'], ['page', 'Page', 'Página', 'page'], ['page-in', 'Page in', 'Página em…', 'page-in'], ['bulleted-list', 'Bulleted list', 'Lista com marcadores', 'bulletListItem'], ['numbered-list', 'Numbered list', 'Lista numerada', 'numberedListItem'], ['to-do-list', 'To-do list', 'Lista de tarefas', 'checkListItem'], ['toggle-list', 'Toggle list', 'Lista recolhível', 'toggleListItem'], ['code', 'Code', 'Código', 'codeBlock'], ['quote', 'Quote', 'Citação', 'quote'], ['callout', 'Callout', 'Destaque', 'callout'], ['block-equation', 'Block equation', 'Equação em bloco', 'equation'], ['synced-block', 'Synced block', 'Bloco sincronizado', 'syncedBlock']] as const).map(([id, en, pt, type]) => command(`turn-${id}`, en, pt, 'Turn into', `turn:${type}`, ['turn into', 'converter'])),
  ...([1, 2, 3, 4] as const).map((level) => command(`turn-toggle-heading-${level}`, `Toggle heading ${level}`, `Título recolhível ${level}`, 'Turn into', `turn:toggle-heading:${level}`, ['toggle heading'])),
  ...([2, 3, 4, 5] as const).map((count) => command(`turn-columns-${count}`, `${count} columns`, `${count} colunas`, 'Turn into', `turn:columns:${count}`, ['colunas'])),
  command('copy-link', 'Copy link to block', 'Copiar link do bloco', 'Actions', 'action:copy-link', ['link']),
  command('duplicate', 'Duplicate', 'Duplicar', 'Actions', 'action:duplicate', ['copy']),
  command('move-to', 'Move to', 'Mover para', 'Actions', 'action:move', ['move', 'moveto']),
  command('comment', 'Comment', 'Comentar', 'Actions', 'action:comment', ['comment', 'comentar'], 'local-adaptation', 'Comenta trecho selecionado na página local.'),
  command('delete', 'Delete', 'Excluir', 'Actions', 'action:delete', ['remove', 'trash']),
  command('ask-ai', 'Ask AI', 'Perguntar à IA', 'Actions', 'action:ai', ['ai', 'ia'], 'requires-local-model', 'Exige modelo local instalado.'),
  ...(['Default', 'Gray', 'Brown', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Red'] as const).map((color) => command(`text-color-${color.toLowerCase()}`, `${color} text`, `Texto ${color === 'Default' ? 'padrão' : ({ Gray: 'cinza', Brown: 'marrom', Orange: 'laranja', Yellow: 'amarelo', Green: 'verde', Blue: 'azul', Purple: 'roxo', Pink: 'rosa', Red: 'vermelho' } as Record<string, string>)[color]}`, 'Text color', `color:text:${color.toLowerCase()}`, ['text color', 'cor do texto'])),
  ...(['Default', 'Gray', 'Brown', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Red'] as const).map((color) => command(`background-color-${color.toLowerCase()}`, `${color} background`, `Fundo ${color === 'Default' ? 'padrão' : ({ Gray: 'cinza', Brown: 'marrom', Orange: 'laranja', Yellow: 'amarelo', Green: 'verde', Blue: 'azul', Purple: 'roxo', Pink: 'rosa', Red: 'vermelho' } as Record<string, string>)[color]}`, 'Background color', `color:background:${color.toLowerCase()}`, ['background', 'cor de fundo'])),
]

export const SLASH_CATEGORY_PT: Record<SlashCategory, string> = { Suggested: 'Sugeridos', 'Basic blocks': 'Blocos básicos', Media: 'Mídia', Database: 'Banco de dados', 'Advanced blocks': 'Blocos avançados', Inline: 'Inline', Embeds: 'Incorporações', 'Turn into': 'Transformar em', Actions: 'Ações', 'Text color': 'Cor do texto', 'Background color': 'Cor de fundo' }

export function catalogForQuery(query: string, locale: 'pt-BR' | 'en-US', catalog: readonly SlashCommand[] = SLASH_CATALOG): SlashCommand[] {
  const normalized = query.trim().toLocaleLowerCase(locale).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (!normalized) return [...catalog]
  const matches = catalog.filter((item) => [item.en, item.pt, item.id, ...item.aliases].some((candidate) => candidate.toLocaleLowerCase(locale).normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(normalized)))
  const chosen = new Map<string, SlashCommand>()
  for (const item of matches) {
    const key = `${item.operation}|${item.en}|${item.pt}`
    if (!chosen.has(key) || (chosen.get(key)!.category === 'Suggested' && item.category !== 'Suggested')) chosen.set(key, item)
  }
  return matches.filter((item) => chosen.get(`${item.operation}|${item.en}|${item.pt}`) === item)
}

/** Descrições curtas de comandos cujo nome não basta (Lei de Jakob: como o Export Bundle descreve). */
const SLASH_DESCRIPTIONS: Record<string, { pt: string; en: string }> = {
  'linked-data-source': { pt: 'Mostrar um banco existente aqui', en: 'Show an existing database here' },
}

/** Subtexto do item: categoria na busca (para agrupar visualmente) ou a descrição curta, quando houver. */
export function slashSubtext(item: SlashCommand, searching: boolean, locale: 'pt-BR' | 'en-US'): string | undefined {
  const description = SLASH_DESCRIPTIONS[item.id]?.[locale === 'en-US' ? 'en' : 'pt']
  const category = searching && ['Database', 'Turn into', 'Embeds'].includes(item.category) ? (locale === 'en-US' ? item.category : SLASH_CATEGORY_PT[item.category]) : undefined
  // Na busca o subtexto fica na mesma linha do título: só a categoria (curta). Sem busca, a descrição embaixo.
  if (searching) return category ?? description
  if (description) return description
  return item.status === 'offline-reference' ? (locale === 'en-US' ? 'Offline reference; no sign-in or preview' : 'Referência offline; sem login ou prévia') : undefined
}
