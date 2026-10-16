// "/Quadro" no menu de barra: cria um quadro filho (possuído pelo bloco) e o embute como prévia.
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions'
import type { SlashCommand } from '../page/slashMenu/catalog'
import type { PageEditorType } from '../page/schema'
import { createCanvas } from './canvasActions'
import { CanvasIcon } from './icons'

export const CANVAS_COMMANDS: readonly SlashCommand[] = [
  { id: 'canvas', en: 'Whiteboard (canvas)', pt: 'Lousa (canvas)', category: 'Advanced blocks', operation: 'canvas:inline', aliases: ['canvas', 'board', 'quadro', 'whiteboard', 'lousa', 'mapa', 'mind map', 'mapa mental', 'diagrama', 'diagram', 'quadro livre', 'lousa livre'], status: 'local' },
  { id: 'canvas-page', en: 'Whiteboard as page', pt: 'Lousa em página', category: 'Advanced blocks', operation: 'canvas:page', aliases: ['canvas', 'board', 'quadro', 'whiteboard', 'subpágina quadro', 'subpágina lousa', 'quadro livre'], status: 'local' },
]
export function canvasIcon(id: string) { return id === 'canvas' || id === 'canvas-page' ? <CanvasIcon name="canvas" size={18} /> : null }

/** Runs "canvas:*"; returns false when the operation belongs to another module. */
export function runCanvasCommand(operation: string, editor: PageEditorType, pageId: string, onCreated: () => Promise<void>, flushMeta: () => Promise<void>, open: (id: string) => void): boolean {
  if (operation !== 'canvas:inline' && operation !== 'canvas:page') return false
  const id = createCanvas(pageId, { blockOwnerId: pageId })
  const display = operation === 'canvas:page' ? 'page' : 'inline'
  insertOrUpdateBlockForSlashMenu(editor, { type: 'page', props: { pageId: id, ownership: 'owned', display } })
  void (async () => { await onCreated(); await flushMeta(); if (display === 'page') open(id) })()
  return true
}
