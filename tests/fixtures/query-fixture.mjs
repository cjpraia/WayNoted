// Espaço sintético com 3 bancos relacionados (Projetos ↔ Tarefas ↔ Pessoas), páginas comuns,
// uma página protegida por senha, uma na lixeira e checklists — usado pelos testes de consultas.
export const ID = {
  home: '00000000-0000-4000-8000-000000000001', projects: '00000000-0000-4000-8000-000000000002', tasks: '00000000-0000-4000-8000-000000000003',
  people: '00000000-0000-4000-8000-000000000004', notes: '00000000-0000-4000-8000-000000000005', secret: '00000000-0000-4000-8000-000000000006',
  secretChild: '00000000-0000-4000-8000-000000000007', trashed: '00000000-0000-4000-8000-000000000008', idea: '00000000-0000-4000-8000-000000000009',
  p1: '10000000-0000-4000-8000-000000000001', p2: '10000000-0000-4000-8000-000000000002', p3: '10000000-0000-4000-8000-000000000003', p4: '10000000-0000-4000-8000-000000000004',
  t1: '20000000-0000-4000-8000-000000000001', t2: '20000000-0000-4000-8000-000000000002', t3: '20000000-0000-4000-8000-000000000003',
  ana: '30000000-0000-4000-8000-000000000001', bia: '30000000-0000-4000-8000-000000000002',
}
const DAY = 86_400_000
export const NOW = new Date(2026, 9, 8, 12, 0, 0) // quinta-feira, 8 de outubro de 2026 (local)
const at = (days) => NOW.getTime() + days * DAY
const view = { id: 'v', name: 'Tabela', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }
const db = (properties) => ({ properties, views: [view], activeViewId: 'v' })
export function page(id, extra = {}) {
  return { id, parentId: null, title: id, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: at(-30), updatedAt: at(-20), order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', ...extra }
}
export function fixturePages() {
  const pages = {
    [ID.home]: page(ID.home, { title: 'Início', text: 'Bem-vindo', order: 0, favorite: true }),
    [ID.notes]: page(ID.notes, { title: 'Notas', parentId: ID.home, text: 'Uma ideia #ideia solta e outra #Projeto', updatedAt: at(-1), outboundPageIds: [ID.home], cover: 'linear-gradient(red, blue)', order: 1 }),
    [ID.idea]: page(ID.idea, { title: 'Ideias', parentId: ID.home, text: 'um dois três quatro cinco', updatedAt: at(-3), outboundPageIds: [ID.p1, ID.home], icon: '💡', order: 2 }),
    [ID.secret]: page(ID.secret, { title: 'Diário secreto', text: 'segredo #ideia', outboundPageIds: [ID.home], updatedAt: at(0), passwordLock: { rootId: ID.secret, hideTitle: true } }),
    [ID.secretChild]: page(ID.secretChild, { title: 'Filho secreto', parentId: ID.secret, text: 'ainda segredo', updatedAt: at(0), outboundPageIds: [ID.home] }),
    [ID.trashed]: page(ID.trashed, { title: 'Lixo', trashed: true, trashedAt: at(-1), text: '#ideia', outboundPageIds: [ID.home], updatedAt: at(0) }),
    [ID.projects]: page(ID.projects, { title: 'Projetos', order: 3, database: db([
      { id: 'pn', name: 'Nome', type: 'title' },
      { id: 'ps', name: 'Status', type: 'select', options: [{ id: 's1', name: 'Em andamento', color: 'blue' }, { id: 's2', name: 'Pausado', color: 'gray' }, { id: 's3', name: 'Concluído', color: 'green' }] },
      { id: 'pd', name: 'Prazo', type: 'date' },
      { id: 'pt', name: 'Tags', type: 'multiSelect', options: [{ id: 'g1', name: 'ideia', color: 'pink' }, { id: 'g2', name: 'cliente', color: 'red' }] },
      { id: 'ph', name: 'Horas', type: 'number' },
      { id: 'pe', name: 'Equipe', type: 'relation', relationDatabaseId: ID.people },
    ]) }),
    [ID.tasks]: page(ID.tasks, { title: 'Tarefas', order: 4, database: db([
      { id: 'tn', name: 'Nome', type: 'title' },
      { id: 'tp', name: 'Projeto', type: 'relation', relationDatabaseId: ID.projects },
      { id: 'tf', name: 'Feito', type: 'checkbox' },
      { id: 'tv', name: 'Prazo', type: 'date' },
      { id: 'ts', name: 'Status', type: 'status', options: [{ id: 'x1', name: 'A fazer', color: 'gray' }, { id: 'x2', name: 'Em andamento', color: 'blue' }, { id: 'x3', name: 'Concluído', color: 'green' }] },
    ]) }),
    [ID.people]: page(ID.people, { title: 'Pessoas', order: 5, database: db([{ id: 'nn', name: 'Nome', type: 'title' }, { id: 'ne', name: 'Email', type: 'email' }]) }),
    [ID.p1]: page(ID.p1, { title: 'Site novo', parentId: ID.projects, order: 0, updatedAt: at(-2), props: { ps: 's1', pd: { start: '2026-10-10' }, pt: ['g2'], ph: 12, pe: [ID.ana] } }),
    [ID.p2]: page(ID.p2, { title: 'App móvel', parentId: ID.projects, order: 1, updatedAt: at(-10), props: { ps: 's1', pd: { start: '2026-10-01' }, pt: ['g1'], ph: 40, pe: [ID.ana, ID.bia] } }),
    [ID.p3]: page(ID.p3, { title: 'Arquivo antigo', parentId: ID.projects, order: 2, updatedAt: at(-40), props: { ps: 's3', pd: { start: '2026-09-01' }, ph: 3 } }),
    [ID.p4]: page(ID.p4, { title: 'Pesquisa', parentId: ID.projects, order: 3, updatedAt: at(-5), props: { ps: 's2', pt: ['g1'] } }),
    [ID.t1]: page(ID.t1, { title: 'Wireframes', parentId: ID.tasks, order: 0, updatedAt: at(-1), props: { tp: [ID.p1], tf: false, tv: { start: '2026-10-07' }, ts: 'x2' } }),
    [ID.t2]: page(ID.t2, { title: 'Publicar', parentId: ID.tasks, order: 1, updatedAt: at(-6), props: { tp: [ID.p1], tf: true, tv: { start: '2026-10-20' }, ts: 'x3' } }),
    [ID.t3]: page(ID.t3, { title: 'Protótipo', parentId: ID.tasks, order: 2, updatedAt: at(-2), props: { tp: [ID.p2], tf: false, tv: { start: '2026-10-12' }, ts: 'x1' } }),
    [ID.ana]: page(ID.ana, { title: 'Ana', parentId: ID.people, order: 0, props: { ne: 'ana@example.com' } }),
    [ID.bia]: page(ID.bia, { title: 'Bia', parentId: ID.people, order: 1, props: { ne: 'bia@example.com' } }),
  }
  return pages
}
export const checklists = () => new Map([
  [ID.notes, [{ blockId: 'c1', text: 'Ligar para cliente', checked: false, date: new Date(2026, 9, 8, 9).toISOString() }, { blockId: 'c2', text: 'Comprar café', checked: true, date: '' }]],
  [ID.secret, [{ blockId: 'c3', text: 'Tarefa secreta', checked: false, date: '' }]],
])
