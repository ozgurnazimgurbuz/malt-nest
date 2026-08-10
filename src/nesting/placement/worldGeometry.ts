import type { GeometryPart, Point } from '../../geometry'
import { boundingBox, partRotationOrigin, rotatePoints } from '../../geometry'
import type { Placement } from '../types'

/**
 * Single source of truth for placing a part in nesting/world coordinates.
 * Used by NestPreview and SVG export — do not duplicate this transform.
 */
export function applyPlacement(
  part: GeometryPart,
  placement: Placement,
): { outer: Point[]; holes: Point[][]; origin: Point } {
  const origin = partRotationOrigin(part.outer.points)
  const outer = rotatePoints(part.outer.points, placement.rotation, origin).map(
    (p) => ({
      x: p.x + placement.x,
      y: p.y + placement.y,
    }),
  )
  const holes = part.holes.map((h) =>
    rotatePoints(h.points, placement.rotation, origin).map((p) => ({
      x: p.x + placement.x,
      y: p.y + placement.y,
    })),
  )
  return { outer, holes, origin }
}

export function placementBounds(outer: Point[]) {
  return boundingBox(outer)
}
