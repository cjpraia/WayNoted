// "Hoje" na barra de menus: o retrato usa os mesmos baldes da Caixa de tarefas (início futuro fora, prazo vencido em atrasadas).
import test from 'node:test'
import assert from 'node:assert/strict'
import { bucketTasks } from '../src/tasks/taskCore.ts'
import { buildTraySnapshot } from '../src/tray/snapshot.ts'

const TODAY = '2026-10-09'
const item = (key, due, extra = {}) => ({ key, kind: 'row', pageId: 'p-' + key, title: 'Tarefa ' + key, due, sourceId: 's', sourceTitle: 'S', ...extra })
const pages = ids => Object.fromEntries(ids.map(id => [id, { id, trashed: false }]))

test('retrato do tray: início futuro fica de fora; vencida entra como atrasada; em andamento entra em hoje', () => {
  const items = [
    item('hoje', TODAY),
    item('futuro', TODAY, { startDate: '2026-10-12' }),            // prazo hoje, mas só começa depois
    item('futuro2', '2026-10-20', { startDate: '2026-10-15' }),
    item('vencida', '2026-10-05'),
    item('vencida-com-inicio', '2026-10-07', { startDate: '2026-10-01' }),
    item('andamento', '2026-10-15', { startDate: '2026-10-08' }),  // começou, prazo adiante
    item('proxima', '2026-10-30'),
    item('sem-data', null),
  ]
  const snap = buildTraySnapshot(bucketTasks(items, TODAY), pages(items.map(i => i.pageId)))
  const ids = snap.items.map(i => i.id)
  assert.deepEqual(ids.sort(), ['andamento', 'hoje', 'vencida', 'vencida-com-inicio'].sort())
  assert.equal(snap.total, 4); assert.equal(snap.overdue, 2)
  const flags = Object.fromEntries(snap.items.map(i => [i.id, i.overdue]))
  assert.equal(flags['vencida'], true); assert.equal(flags['vencida-com-inicio'], true)
  assert.equal(flags['hoje'], false); assert.equal(flags['andamento'], false)
  assert.ok(!ids.includes('futuro') && !ids.includes('futuro2') && !ids.includes('proxima'))
})

test('retrato do tray: lixeira e páginas protegidas nunca entram; limite de 10 mantém o total', () => {
  const items = [item('a', TODAY), item('b', TODAY), ...Array.from({ length: 12 }, (_, i) => item('n' + i, TODAY))]
  const p = pages(items.map(i => i.pageId)); p['p-a'].trashed = true; p['p-b'].passwordLock = { unlocked: true }
  const snap = buildTraySnapshot(bucketTasks(items, TODAY), p)
  assert.equal(snap.items.length, 10); assert.equal(snap.total, 12)
  assert.ok(!snap.items.some(i => i.id === 'a' || i.id === 'b'))
})
