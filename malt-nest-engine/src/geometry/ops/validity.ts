import { absoluteArea, signedArea } from '../ring'
import type { Point, Polygon, Ring, Shape } from '../types'
import {
  DEFAULT_TOLERANCE,
  nearlyEqual,
  nearlyZero,
  type GeometryTolerance,
} from '../tolerance'

export type ValidityIssue =
  | 'too_few_points'
  | 'degenerate_area'
  | 'self_intersecting'
  | 'open_ring_duplicate'
  | 'hole_outside'
  | 'empty_shape'

export type ValidityReport = {
  ok: boolean
  issues: ValidityIssue[]
}

function segmentsIntersectProper(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  tol: GeometryTolerance,
): boolean {
  const orient = (p: Point, q: Point, r: Point) =>
    (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y)

  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)

  const sep =
    ((o1 > tol.abs && o2 < -tol.abs) || (o1 < -tol.abs && o2 > tol.abs)) &&
    ((o3 > tol.abs && o4 < -tol.abs) || (o3 < -tol.abs && o4 > tol.abs))
  return sep
}

function ringSelfIntersects(ring: Ring, tol: GeometryTolerance): boolean {
  const n = ring.length
  if (n < 4) return false
  for (let i = 0; i < n; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % n]!
    for (let j = i + 1; j < n; j++) {
      // skip adjacent edges
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue
      if (
        (i + 1) % n === j ||
        (j + 1) % n === i
      )
        continue
      const c = ring[j]!
      const d = ring[(j + 1) % n]!
      // also skip if they share a vertex
      if (
        (nearlyEqual(a.x, c.x, tol) && nearlyEqual(a.y, c.y, tol)) ||
        (nearlyEqual(a.x, d.x, tol) && nearlyEqual(a.y, d.y, tol)) ||
        (nearlyEqual(b.x, c.x, tol) && nearlyEqual(b.y, c.y, tol)) ||
        (nearlyEqual(b.x, d.x, tol) && nearlyEqual(b.y, d.y, tol))
      ) {
        continue
      }
      if (segmentsIntersectProper(a, b, c, d, tol)) return true
    }
  }
  return false
}

export function validateRing(
  ring: Ring,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): ValidityReport {
  const issues: ValidityIssue[] = []
  if (ring.length < 3) issues.push('too_few_points')
  if (nearlyZero(absoluteArea(ring), tol)) issues.push('degenerate_area')
  if (ringSelfIntersects(ring, tol)) issues.push('self_intersecting')
  return { ok: issues.length === 0, issues }
}

export function validatePolygon(
  poly: Polygon,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): ValidityReport {
  const issues: ValidityIssue[] = []
  const outer = validateRing(poly.outer, tol)
  issues.push(...outer.issues)
  for (const h of poly.holes) {
    const hr = validateRing(h, tol)
    issues.push(...hr.issues)
  }
  return { ok: issues.length === 0, issues: [...new Set(issues)] }
}

export function validateShape(
  shape: Shape,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): ValidityReport {
  if (shape.polygons.length === 0) {
    return { ok: false, issues: ['empty_shape'] }
  }
  const issues: ValidityIssue[] = []
  for (const p of shape.polygons) {
    issues.push(...validatePolygon(p, tol).issues)
  }
  return { ok: issues.length === 0, issues: [...new Set(issues)] }
}

export function isValidShape(
  shape: Shape,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  return validateShape(shape, tol).ok
}

/** Export for tests / intersect helpers. */
export { segmentsIntersectProper, signedArea }
