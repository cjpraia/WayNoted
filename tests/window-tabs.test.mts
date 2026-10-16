import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripWindowTabs, shieldWindowTabs } from '../electron/window-tabs.mjs'
import { mergeMeta } from '../electron/meta-merge.mjs'

const tab = (id: string) => ({ id, route: { type: 'home' } })
const meta = (tabs?: unknown[], active?: string, extra = {}) => ({ pages: {}, notifications: {}, syncedBlocks: {}, settings: { theme: 'system', ...(tabs ? { openTabs: tabs, activeTabId: active } : {}), ...extra } })

test('janela secundária recebe o meta sem abas e não altera as do disco', () => {
  const disk = meta([tab('a'), tab('b'), tab('c')], 'a')
  const mine: any = stripWindowTabs(disk)
  assert.equal(mine.settings.openTabs, undefined)
  assert.equal(mine.settings.activeTabId, undefined)
  assert.equal(disk.settings.openTabs.length, 3, 'original intacto')
  // Ela abre a própria aba e muda o tema.
  const proposed: any = { ...mine, settings: { ...mine.settings, theme: 'dark', openTabs: [tab('x')], activeTabId: 'x' } }
  const shielded: any = shieldWindowTabs(proposed, mine)
  assert.equal(shielded.settings.openTabs, undefined)
  const merged: any = mergeMeta(disk, mine, shielded)
  assert.equal(merged.settings.theme, 'dark', 'o resto das configurações sincroniza')
  assert.deepEqual(merged.settings.openTabs.map((t: any) => t.id), ['a', 'b', 'c'], 'abas da principal preservadas')
})

test('base com abas (após resposta de gravação) é preservada; principal grava as próprias', () => {
  const disk = meta([tab('a'), tab('b')], 'a')
  const base = meta([tab('a'), tab('b')], 'a')
  const shielded: any = shieldWindowTabs(meta([tab('z')], 'z'), base)
  assert.deepEqual(shielded.settings.openTabs.map((t: any) => t.id), ['a', 'b'])
  // A principal (sem escudo) tem as abas "efêmeras": a proposta vence.
  const primary: any = mergeMeta(disk, base, meta([tab('a')], 'a'))
  assert.deepEqual(primary.settings.openTabs.map((t: any) => t.id), ['a'])
  // Principal e secundária gravando em sequência não se sobrescrevem.
  const afterPrimary: any = primary
  const second: any = mergeMeta(afterPrimary, stripWindowTabs(disk), shieldWindowTabs(meta([tab('q')], 'q', { theme: 'dark' }), stripWindowTabs(disk)))
  assert.deepEqual(second.settings.openTabs.map((t: any) => t.id), ['a'])
  assert.equal(second.settings.theme, 'dark')
})

test('main.cjs aplica o escudo nas três vias de IPC e marca janelas secundárias', () => {
  const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
  assert.match(main, /const secondary = \[\.\.\.contexts\.values\(\)\]\.some\(c => c\.workspaceId === workspaceId/)
  assert.equal([...main.matchAll(/ctx\.secondary/g)].length >= 3, true)
  assert.match(main, /stripWindowTabs\(meta\)/)
  assert.equal([...main.matchAll(/shieldWindowTabs\(/g)].length, 2)
})
