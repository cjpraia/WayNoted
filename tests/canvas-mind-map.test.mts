import assert from 'node:assert/strict'
import test from 'node:test'
import { boxBounds, connectorEnds, rectsIntersect, translateObject } from '../src/canvas/geometry.ts'
import { CanvasHistory } from '../src/canvas/history.ts'
import { createMindMapBranch, createMindMapRoot, isMindMapTopic } from '../src/canvas/mindMap.ts'
import { normalizeCanvas, normalizeObject, type CanvasObject } from '../src/canvas/model.ts'
import { deleteObjects, freezeConnectorEnds, lookupOf, parseClipboard, pasteObjects, serializeClipboard } from '../src/canvas/ops.ts'
import { CANVAS_TEMPLATES } from '../src/canvas/templates.ts'

test('mind map branches follow connected topics and survive a document or clipboard round trip', () => {
  const root = createMindMapRoot({ x: 0, y: 0 }, 'Tema central')
  const { branch, connector } = createMindMapBranch([root], root, 'left', 'Ramo')
  const scene = freezeConnectorEnds([root, connector, branch])
  const restored = normalizeCanvas({ objects: scene }).data.objects
  assert.deepEqual(restored, scene)
  assert.equal(root.mindMap, 'root')
  assert.equal(branch.mindMap, 'branch')
  assert.equal(isMindMapTopic(normalizeObject({ ...root, mindMap: 'unknown' })!), false)
  assert.equal(connector.endArrow, false)

  const clipboard = parseClipboard(serializeClipboard(scene, new Set([root.id, branch.id])))!
  const copies = pasteObjects(clipboard, { x: 100, y: 100 })
  const copiedRoot = copies.find(object => isMindMapTopic(object) && object.mindMap === 'root')!
  const copiedLink = copies.find(object => object.type === 'connector')!
  assert.notEqual(copiedRoot.id, root.id)
  assert.equal(copiedLink.from.id, copiedRoot.id)
  const before = connectorEnds(copiedLink, lookupOf(copies))
  const moved = copies.map(object => object.id === copiedRoot.id ? translateObject(object, 24, 32) : object)
  const after = connectorEnds(copiedLink, lookupOf(moved))
  assert.equal(after.a.x, before.a.x + 24)
  assert.equal(after.a.y, before.a.y + 32)
  assert.deepEqual(after.b, before.b)

  const tall = moved.map(object => object.id === copiedRoot.id && isMindMapTopic(object) ? { ...object, h: object.h + 40 } : object)
  const resized = connectorEnds(copiedLink, lookupOf(tall))
  assert.equal(resized.a.x, after.a.x)
  assert.equal(resized.a.y, after.a.y + 20)
  assert.deepEqual(resized.b, after.b)
})

test('branches choose a free position on the requested side and stay editable as a tree', () => {
  const root = createMindMapRoot({ x: 0, y: 0 }, 'Central')
  const obstacle = { ...createMindMapRoot({ x: 288, y: 0 }, 'Outro objeto'), rotation: 25 }
  const section = { id: 'section', type: 'section', x: -200, y: -200, w: 1000, h: 1000, title: 'Mapa', color: 'gray' } as const
  const existing: CanvasObject[] = [section, root, obstacle]
  for (let i = 0; i < 7; i++) {
    const { branch, connector } = createMindMapBranch(existing, root, 'right', 'Irmão')
    assert.ok(branch.x > root.x + root.w)
    assert.ok(existing.slice(1).filter(isMindMapTopic).every(object => !rectsIntersect(branch, boxBounds(object))))
    existing.push(branch, connector)
  }
  const child = existing.filter(isMindMapTopic).at(-1)!
  const { branch, connector } = createMindMapBranch(existing, child, 'bottom', 'Detalhe')
  assert.ok(branch.y > child.y + child.h)
  assert.equal(connector.from.id, child.id)
  assert.equal(connector.to.id, branch.id)
  const templateTopics = CANVAS_TEMPLATES.find(template => template.id === 'mindmap')!.build('pt-BR').filter(isMindMapTopic)
  assert.equal(templateTopics.length, 7)
})

test('a new branch and its connection undo together, and deleting the branch removes its connection', () => {
  const root = createMindMapRoot({ x: 0, y: 0 }, 'Central')
  const { branch, connector } = createMindMapBranch([root], root, 'right', 'Ramo')
  const history = new CanvasHistory()
  history.record([root])
  const scene = [root, branch, connector]
  assert.deepEqual(history.undo(scene), [root])
  assert.deepEqual(history.redo([root]), scene)
  assert.deepEqual(deleteObjects(scene, new Set([branch.id])), [root])
  assert.deepEqual(deleteObjects(scene, new Set([connector.id])), [root, branch])
})
