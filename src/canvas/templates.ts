// Modelos prontos do quadro (inspirados nos do Miro; conteúdo e desenho próprios). Cada modelo é uma lista
// de objetos em coordenadas locais; a inserção remapeia ids (pasteObjects) e centraliza na visão.
import type { CanvasColor, CanvasObject, ConnectorObject, ShapeKind } from './model.ts'

export type TemplateId = 'kanban' | 'mindmap' | 'retro' | 'brainstorm' | 'flowchart' | 'timeline'
export interface CanvasTemplate { id: TemplateId; pt: string; en: string; descriptionPt: string; descriptionEn: string; build(locale: 'pt-BR' | 'en-US'): CanvasObject[] }

let counter = 0
const id = (prefix: string) => `tpl-${prefix}-${++counter}`
const note = (x: number, y: number, text: string, color: CanvasColor = 'yellow', w = 200, h = 160): CanvasObject => ({ id: id('n'), type: 'note', x, y, w, h, text, color })
const section = (x: number, y: number, w: number, h: number, title: string, color: CanvasColor = 'gray'): CanvasObject => ({ id: id('s'), type: 'section', x, y, w, h, title, color })
const shape = (shapeKind: ShapeKind, x: number, y: number, w: number, h: number, text: string, color: CanvasColor = 'blue', fill: 'tint' | 'solid' = 'tint'): CanvasObject => ({ id: id('sh'), type: 'shape', shape: shapeKind, x, y, w, h, text, color, fill })
const link = (from: string, to: string, route: ConnectorObject['route'] = 'curve', label?: string): ConnectorObject => ({ id: id('k'), type: 'connector', from: { id: from, x: 0, y: 0 }, to: { id: to, x: 0, y: 0 }, route, color: 'default', endArrow: true, ...(label ? { label } : {}) })
const text = (x: number, y: number, w: number, value: string, fontSize = 20): CanvasObject => ({ id: id('t'), type: 'text', x, y, w, h: fontSize * 1.4, text: value, color: 'default', fontSize })

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  { id: 'kanban', pt: 'Kanban', en: 'Kanban', descriptionPt: 'A fazer, fazendo e feito', descriptionEn: 'To do, doing and done', build: locale => {
    const t = (pt: string, en: string) => locale === 'en-US' ? en : pt
    const cols: [string, CanvasColor, CanvasColor][] = [[t('A fazer', 'To do'), 'gray', 'yellow'], [t('Fazendo', 'Doing'), 'blue', 'blue'], [t('Feito', 'Done'), 'green', 'green']]
    const out: CanvasObject[] = [section(-40, -100, 1060, 720, 'Kanban', 'default')]
    cols.forEach(([title, color, noteColor], i) => {
      out.push(section(i * 340, -40, 300, 620, title, color))
      for (let j = 0; j < (i === 0 ? 3 : 1); j++) out.push(note(i * 340 + 30, 20 + j * 190, t('Tarefa', 'Task') + ` ${i * 3 + j + 1}`, noteColor, 240, 160))
    })
    return out
  } },
  { id: 'mindmap', pt: 'Mapa mental', en: 'Mind map', descriptionPt: 'Tema central com ramos', descriptionEn: 'Central topic with branches', build: locale => {
    const center = shape('ellipse', -120, -60, 240, 120, locale === 'en-US' ? 'Central topic' : 'Tema central', 'blue', 'solid')
    const out: CanvasObject[] = [center]
    const colors: CanvasColor[] = ['orange', 'green', 'purple', 'pink', 'yellow', 'red']
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2
      const branch = shape('rect', Math.round(Math.cos(a) * 380) - 90, Math.round(Math.sin(a) * 260) - 35, 180, 70, (locale === 'en-US' ? 'Idea ' : 'Ideia ') + (i + 1), colors[i])
      out.push(branch, link(center.id, branch.id, 'curve'))
    }
    return out
  } },
  { id: 'retro', pt: 'Retrospectiva', en: 'Retrospective', descriptionPt: 'Bem, melhorar e ações', descriptionEn: 'Went well, improve, actions', build: locale => {
    const t = (pt: string, en: string) => locale === 'en-US' ? en : pt
    const cols: [string, CanvasColor][] = [[t('O que foi bem', 'What went well'), 'green'], [t('O que melhorar', 'What to improve'), 'orange'], [t('Ações', 'Actions'), 'blue']]
    const out: CanvasObject[] = [section(-40, -100, 1060, 620, t('Retrospectiva', 'Retrospective'), 'default')]
    cols.forEach(([title, color], i) => { out.push(section(i * 340, -40, 300, 520, title, color)); out.push(note(i * 340 + 30, 20, '', color === 'green' ? 'green' : color === 'orange' ? 'orange' : 'blue', 240, 160)) })
    return out
  } },
  { id: 'brainstorm', pt: 'Brainstorm', en: 'Brainstorm', descriptionPt: 'Pergunta e ideias ao redor', descriptionEn: 'A question with ideas around it', build: locale => {
    const out: CanvasObject[] = [section(-560, -440, 1120, 880, 'Brainstorm', 'purple'), note(-130, -100, locale === 'en-US' ? 'Question?' : 'Pergunta?', 'purple', 260, 200)]
    const colors: CanvasColor[] = ['yellow', 'pink', 'blue', 'green', 'orange', 'yellow', 'pink', 'blue']
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; out.push(note(Math.round(Math.cos(a) * 380) - 80, Math.round(Math.sin(a) * 290) - 65, '', colors[i], 160, 130)) }
    return out
  } },
  { id: 'flowchart', pt: 'Fluxograma', en: 'Flowchart', descriptionPt: 'Início, etapa, decisão e fim', descriptionEn: 'Start, step, decision and end', build: locale => {
    const t = (pt: string, en: string) => locale === 'en-US' ? en : pt
    const start = shape('ellipse', -90, 0, 180, 70, t('Início', 'Start'), 'green')
    const step = shape('rect', -100, 140, 200, 80, t('Etapa', 'Step'), 'blue')
    const decision = shape('diamond', -110, 290, 220, 130, t('Decisão?', 'Decision?'), 'orange')
    const yes = shape('rect', 220, 315, 180, 80, t('Fazer A', 'Do A'), 'blue')
    const no = shape('rect', -100, 500, 200, 80, t('Fazer B', 'Do B'), 'blue')
    const end = shape('ellipse', 230, 505, 160, 70, t('Fim', 'End'), 'red')
    return [start, step, decision, yes, no, end, link(start.id, step.id, 'orthogonal'), link(step.id, decision.id, 'orthogonal'), link(decision.id, yes.id, 'orthogonal', t('sim', 'yes')), link(decision.id, no.id, 'orthogonal', t('não', 'no')), link(yes.id, end.id, 'orthogonal'), link(no.id, end.id, 'orthogonal')]
  } },
  { id: 'timeline', pt: 'Linha do tempo', en: 'Timeline', descriptionPt: 'Cinco marcos em sequência', descriptionEn: 'Five milestones in sequence', build: locale => {
    const out: CanvasObject[] = [{ id: id('line'), type: 'connector', from: { x: -40, y: 0 }, to: { x: 1240, y: 0 }, route: 'straight', color: 'default', endArrow: true, strokeWidth: 3 }]
    for (let i = 0; i < 5; i++) {
      out.push(shape('diamond', i * 280 + 80, -22, 44, 44, '', i === 4 ? 'green' : 'blue', 'solid'))
      out.push(text(i * 280 - 0, 40, 200, (locale === 'en-US' ? 'Milestone ' : 'Marco ') + (i + 1), 18))
      out.push(note(i * 280 + 2, -220, '', 'yellow', 200, 150))
    }
    return out
  } },
]
