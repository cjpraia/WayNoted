// Resolve text defaults once for the board, editing overlay and exports.
import { contrast, fontOf, inkColor, swatch, type CanvasColor, type CanvasPalette, type StyleProps, type TextBoxObject, type TextStyle } from './model.ts'

export type TextFormat = TextStyle & Pick<StyleProps, 'font'> & { textColor?: CanvasColor; background?: CanvasColor }

export function textBoxFormat(object: TextBoxObject) {
  return {
    fontSize: object.fontSize ?? 16,
    align: object.align ?? (object.type === 'shape' ? 'center' : 'left'),
    weight: object.bold ? 700 : object.type === 'shape' ? 500 : 400,
    italic: object.italic,
  } as const
}

export function textBoxRect(object: TextBoxObject) {
  if (object.type === 'text' && !object.background) return object
  const x = object.type === 'text' ? 8 : object.type === 'note' ? 14 : object.shape === 'rect' ? 12 : object.w * 0.18
  const y = object.type === 'text' ? 4 : object.type === 'note' ? 12 : 8
  const insetX = Math.min(x, (object.w - 1) / 2)
  const insetY = Math.min(y, (object.h - 1) / 2)
  return { x: object.x + insetX, y: object.y + insetY, w: object.w - insetX * 2, h: object.h - insetY * 2 }
}

export function textBoxColor(object: TextBoxObject, palette: CanvasPalette): string {
  const { dark, text, bg } = palette
  if (object.type === 'text') {
    if (!object.background) return object.color === 'default' ? text : inkColor(object.color, dark)
    return readableInk(object.color, swatch(object.background, dark)[0], dark)
  }
  const [fill, foreground, stroke] = swatch(object.color, dark)
  const solid = object.type === 'shape' && object.fill === 'solid'
  const tinted = object.type === 'note' || object.fill === 'tint'
  if (!object.textColor) return solid ? '#ffffff' : tinted ? foreground : text
  return readableInk(object.textColor, solid ? stroke : tinted ? fill : bg, dark)
}

function readableInk(color: CanvasColor, background: string, dark: boolean) {
  const ink = inkColor(color, dark)
  if (contrast(ink, background) >= 4.5) return ink
  const candidates = [swatch(color, dark)[1], swatch(color, !dark)[1]]
  return contrast(candidates[0], background) >= contrast(candidates[1], background) ? candidates[0] : candidates[1]
}

export function textBoxFamily(object: TextBoxObject, palette: CanvasPalette) {
  return object.font ? fontOf(object) : palette.font
}

export function applyTextFormat(object: TextBoxObject, format: TextFormat): TextBoxObject {
  const { textColor, background, ...style } = format
  if (object.type === 'text') return {
    ...object,
    ...style,
    fontSize: style.fontSize ?? object.fontSize,
    color: 'textColor' in format ? textColor ?? 'default' : object.color,
    background: 'background' in format ? background : object.background,
  }
  return { ...object, ...style, textColor: 'textColor' in format ? textColor : object.textColor }
}
