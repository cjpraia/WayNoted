import { boxBounds, center, facingSide, type Point } from './geometry.ts'
import { isBox, newObjectId, type CanvasObject, type ShapeObject, type Side } from './model.ts'
import { createConnector } from './ops.ts'

type BranchSide = Exclude<Side, 'auto'>

const BRANCH_WIDTH = 184
const BRANCH_HEIGHT = 68
const BRANCH_GAP = 88
const TOPIC_MARGIN = 24

export function isMindMapTopic(object: CanvasObject | undefined): object is ShapeObject {
  return object?.type === 'shape' && !!object.mindMap
}

export function createMindMapRoot(at: Point, text: string): ShapeObject {
  const w = 216, h = 80
  return {
    id: newObjectId(), type: 'shape', shape: 'rect', mindMap: 'root',
    x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h,
    text, color: 'blue', fill: 'solid', radius: 24,
  }
}

/** Merges blocked intervals across the branch lane and finds the closest free spot. */
function nearestFreePosition(preferred: number, blocked: { start: number; end: number }[]): number {
  blocked.sort((a, b) => a.start - b.start)
  let start = Number.NEGATIVE_INFINITY, end = Number.NEGATIVE_INFINITY
  for (const interval of blocked) {
    if (interval.start >= end) {
      if (start < preferred && preferred < end) break
      if (interval.start >= preferred) return preferred
      start = interval.start
    }
    end = Math.max(end, interval.end)
  }
  if (preferred <= start || preferred >= end) return preferred
  return preferred - start < end - preferred ? Math.floor(start) : Math.ceil(end)
}

export function createMindMapBranch(objects: readonly CanvasObject[], source: ShapeObject, side: BranchSide, text: string) {
  const sourceBounds = boxBounds(source)
  const origin = center(sourceBounds)
  const horizontal = side === 'left' || side === 'right'
  const x = side === 'right' ? Math.ceil(sourceBounds.x + sourceBounds.w + BRANCH_GAP)
    : side === 'left' ? Math.floor(sourceBounds.x - BRANCH_GAP - BRANCH_WIDTH) : Math.round(origin.x - BRANCH_WIDTH / 2)
  const y = side === 'bottom' ? Math.ceil(sourceBounds.y + sourceBounds.h + BRANCH_GAP)
    : side === 'top' ? Math.floor(sourceBounds.y - BRANCH_GAP - BRANCH_HEIGHT) : Math.round(origin.y - BRANCH_HEIGHT / 2)
  const blocked = objects.flatMap(object => {
    if (object.hidden || !isBox(object) || object.type === 'section') return []
    const r = boxBounds(object)
    if (horizontal && r.x - TOPIC_MARGIN < x + BRANCH_WIDTH && r.x + r.w + TOPIC_MARGIN > x) {
      return [{ start: r.y - BRANCH_HEIGHT - TOPIC_MARGIN, end: r.y + r.h + TOPIC_MARGIN }]
    }
    if (!horizontal && r.y - TOPIC_MARGIN < y + BRANCH_HEIGHT && r.y + r.h + TOPIC_MARGIN > y) {
      return [{ start: r.x - BRANCH_WIDTH - TOPIC_MARGIN, end: r.x + r.w + TOPIC_MARGIN }]
    }
    return []
  })
  const branch: ShapeObject = {
    id: newObjectId(), type: 'shape', shape: 'rect', mindMap: 'branch',
    x: horizontal ? x : nearestFreePosition(x, blocked),
    y: horizontal ? nearestFreePosition(y, blocked) : y,
    w: BRANCH_WIDTH, h: BRANCH_HEIGHT, text, color: source.color, fill: 'tint', radius: 16,
  }
  const branchCenter = center(branch)
  const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const
  const connector = createConnector(
    { ...origin, id: source.id, side: facingSide(source, center({
      x, y, w: BRANCH_WIDTH, h: BRANCH_HEIGHT,
    })) },
    { ...branchCenter, id: branch.id, side: opposite[side] },
    false,
  )
  return { branch, connector: { ...connector, color: source.color } }
}
