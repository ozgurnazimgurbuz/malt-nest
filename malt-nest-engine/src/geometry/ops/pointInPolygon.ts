import type { Point, Polygon, Ring, Shape } from '../types'
import {
  DEFAULT_TOLERANCE,
  nearlyEqual,
  type GeometryTolerance,
} from '../tolerance'

/**
 * Winding-number point-in-ring (includes boundary as inside when on-edge).
 */
export function pointInRing(
  p: Point,
  ring: Ring,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  if (ring.length < 3) return false
  if (pointOnRingBoundary(p, ring, tol)) return true

  let wn = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    if (a.y <= p.y) {
      if (b.y > p.y && isLeft(a, b, p) > 0) wn++
    } else if (b.y <= p.y && isLeft(a, b, p) < 0) {
      wn--
    }
  }
  return wn !== 0
}

function isLeft(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)
}

export function pointOnSegment(
  p: Point,
  a: Point,
  b: Point,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  const cross = (p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y)
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const distanceTolerance = tol.abs + tol.rel * Math.max(len, 1)
  if (len <= Math.sqrt(tol.edgeMinLen2)) {
    return Math.hypot(p.x - a.x, p.y - a.y) <= distanceTolerance
  }
  if (Math.abs(cross) / len > distanceTolerance) return false
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)
  const projection = dot / len
  if (projection < -distanceTolerance) return false
  if (projection > len + distanceTolerance) return false
  return true
}

export function pointOnRingBoundary(
  p: Point,
  ring: Ring,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  for (let i = 0; i < ring.length; i++) {
    if (pointOnSegment(p, ring[i]!, ring[(i + 1) % ring.length]!, tol)) {
      return true
    }
  }
  return false
}

/** Point inside polygon (in outer, not in any hole). */
export function pointInPolygon(
  p: Point,
  poly: Polygon,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  if (!pointInRing(p, poly.outer, tol)) return false
  for (const h of poly.holes) {
    if (pointInRing(p, h, tol) && !pointOnRingBoundary(p, h, tol)) {
      return false
    }
  }
  return true
}

export function pointInShape(
  p: Point,
  shape: Shape,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  return shape.polygons.some((poly) => pointInPolygon(p, poly, tol))
}

export function ringsEqual(
  a: Ring,
  b: Ring,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (
      !nearlyEqual(a[i]!.x, b[i]!.x, tol) ||
      !nearlyEqual(a[i]!.y, b[i]!.y, tol)
    ) {
      return false
    }
  }
  return true
}

export function shapesNearlyEqual(
  a: Shape,
  b: Shape,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  if (a.polygons.length !== b.polygons.length) return false
  for (let i = 0; i < a.polygons.length; i++) {
    const pa = a.polygons[i]!
    const pb = b.polygons[i]!
    if (!ringsEqual(pa.outer, pb.outer, tol)) return false
    if (pa.holes.length !== pb.holes.length) return false
    for (let h = 0; h < pa.holes.length; h++) {
      if (!ringsEqual(pa.holes[h]!, pb.holes[h]!, tol)) return false
    }
  }
  return true
}
