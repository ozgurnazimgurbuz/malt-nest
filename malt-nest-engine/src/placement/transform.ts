import {
  normalizeShape,
  shapeBounds,
  shapeCentroid,
  translateShape,
  rotateShape,
} from '../geometry'
import type { Point, Shape } from '../geometry/types'
import type { Placement } from './types'

/**
 * Build an immutable Placement.
 *
 * Pipeline:
 *   original → normalize
 *   → T(−centroid)
 *   → R(rotationDeg)   // about origin (= former centroid)
 *   → T(+position)     // world centroid = position
 */
export function createPlacement(
  shape: Shape,
  position: Point,
  rotationDeg: number,
): Placement {
  const normalized = normalizeShape(shape)
  const c = shapeCentroid(normalized)
  if (!c) {
    throw new Error(`Cannot place shape "${shape.id}": degenerate centroid`)
  }
  const atOrigin = translateShape(normalized, -c.x, -c.y)
  const rotated = rotateShape(atOrigin, rotationDeg)
  const geometry = translateShape(rotated, position.x, position.y)
  const bounds = shapeBounds(geometry)
  if (!bounds) {
    throw new Error(`Cannot place shape "${shape.id}": empty bounds`)
  }
  return {
    shapeId: shape.id,
    position: { x: position.x, y: position.y },
    rotationDeg,
    geometry,
    bounds,
  }
}

/** Deep-ish copy (geometry is already immutable-style plain data). */
export function clonePlacement(p: Placement): Placement {
  return {
    shapeId: p.shapeId,
    position: { x: p.position.x, y: p.position.y },
    rotationDeg: p.rotationDeg,
    geometry: p.geometry,
    bounds: { ...p.bounds },
  }
}
