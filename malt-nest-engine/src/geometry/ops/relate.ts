import type { BoundingBox, Point, Polygon, Ring, Shape } from '../types'
import { ringBounds } from '../ring'
import { pointInPolygon, pointInRing } from './pointInPolygon'
import { segmentsIntersectProper } from './validity'
import { DEFAULT_TOLERANCE, type GeometryTolerance } from '../tolerance'

function bboxOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return !(
    a.maxX < b.minX ||
    b.maxX < a.minX ||
    a.maxY < b.minY ||
    b.maxY < a.minY
  )
}

function ringEdgesIntersect(
  a: Ring,
  b: Ring,
  tol: GeometryTolerance,
): boolean {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!
    const a1 = a[(i + 1) % a.length]!
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j]!
      const b1 = b[(j + 1) % b.length]!
      if (segmentsIntersectProper(a0, a1, b0, b1, tol)) return true
    }
  }
  return false
}

/** True if polygons' filled regions intersect (including edge crossings). */
export function polygonsIntersect(
  a: Polygon,
  b: Polygon,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  const ba = ringBounds(a.outer)
  const bb = ringBounds(b.outer)
  if (!ba || !bb || !bboxOverlap(ba, bb)) return false

  if (ringEdgesIntersect(a.outer, b.outer, tol)) return true
  // vertex of one inside the other
  if (a.outer.some((p) => pointInPolygon(p, b, tol))) return true
  if (b.outer.some((p) => pointInPolygon(p, a, tol))) return true
  return false
}

export function shapesIntersect(
  a: Shape,
  b: Shape,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  for (const pa of a.polygons) {
    for (const pb of b.polygons) {
      if (polygonsIntersect(pa, pb, tol)) return true
    }
  }
  return false
}

/** True if `inner` is completely inside `outer` (including boundary). */
export function polygonContainsPolygon(
  outer: Polygon,
  inner: Polygon,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  for (const p of inner.outer) {
    if (!pointInPolygon(p, outer, tol)) return false
  }
  if (ringEdgesIntersect(outer.outer, inner.outer, tol)) return false
  return true
}

export function shapeContainsPoint(
  shape: Shape,
  p: Point,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  return shape.polygons.some((poly) => pointInPolygon(p, poly, tol))
}

export function ringContainsPoint(
  ring: Ring,
  p: Point,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  return pointInRing(p, ring, tol)
}
