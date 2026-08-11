import {
  bboxArea,
  bboxHeight,
  bboxWidth,
  shapeArea,
  shapeBounds,
} from '../geometry'
import type { Shape } from '../geometry/types'
import { shapeComplexity } from './complexity'
import type { OrderingStrategy } from './types'
import { DEFAULT_ORDERING } from './types'

function tieId(a: Shape, b: Shape): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Stable deterministic sort. Same inputs → same order always.
 * Tie-break: shape.id ascending, then input index.
 */
export function sortParts(
  parts: readonly Shape[],
  strategy: OrderingStrategy = DEFAULT_ORDERING,
): Shape[] {
  const scored = parts.map((s, i) => {
    const b = shapeBounds(s)
    let key = 0
    switch (strategy) {
      case 'area_desc':
        key = shapeArea(s)
        break
      case 'bbox_area_desc':
        key = b ? bboxArea(b) : 0
        break
      case 'height_desc':
        key = b ? bboxHeight(b) : 0
        break
      case 'width_desc':
        key = b ? bboxWidth(b) : 0
        break
      case 'complexity_desc':
        key = shapeComplexity(s)
        break
      default: {
        const _exhaustive: never = strategy
        void _exhaustive
        key = shapeArea(s)
      }
    }
    return { s, key, i }
  })

  scored.sort((a, b) => {
    if (b.key !== a.key) return b.key - a.key
    const id = tieId(a.s, b.s)
    if (id !== 0) return id
    return a.i - b.i
  })

  return scored.map((x) => x.s)
}

/** Ordered shape ids for diagnostics / determinism checks. */
export function orderIds(
  parts: readonly Shape[],
  strategy: OrderingStrategy,
): string[] {
  return sortParts(parts, strategy).map((s) => s.id)
}
