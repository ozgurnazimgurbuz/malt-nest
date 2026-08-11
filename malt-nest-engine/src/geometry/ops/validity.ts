import { absoluteArea, signedArea } from '../ring'
import type { Point, Polygon, Ring, Shape } from '../types'
import {
  pointInRing,
  pointOnRingBoundary,
  pointOnSegment,
} from './pointInPolygon'
import {
  areaTolerance,
  DEFAULT_TOLERANCE,
  nearlyEqual,
  type GeometryTolerance,
} from '../tolerance'

export type ValidityIssue =
  | 'too_few_points'
  | 'degenerate_area'
  | 'self_intersecting'
  | 'non_finite_coordinate'
  | 'open_ring_duplicate'
  | 'hole_outside'
  | 'holes_intersect'
  | 'polygons_overlap'
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
  const orient = (p: Point, q: Point, r: Point) => {
    const dx = q.x - p.x
    const dy = q.y - p.y
    const length = Math.hypot(dx, dy)
    const cross = dx * (r.y - p.y) - dy * (r.x - p.x)
    const distanceTolerance = tol.abs + tol.rel * Math.max(length, 1)
    if (length <= Math.sqrt(tol.edgeMinLen2)) return 0
    if (Math.abs(cross) <= length * distanceTolerance) return 0
    return Math.sign(cross)
  }

  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)

  const sep =
    ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
    ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))
  return sep
}

function pointsEqual(
  a: Point,
  b: Point,
  tol: GeometryTolerance,
): boolean {
  return nearlyEqual(a.x, b.x, tol) && nearlyEqual(a.y, b.y, tol)
}

function segmentsTouchOrCross(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  tol: GeometryTolerance,
): boolean {
  return (
    segmentsIntersectProper(a, b, c, d, tol) ||
    pointOnSegment(a, c, d, tol) ||
    pointOnSegment(b, c, d, tol) ||
    pointOnSegment(c, a, b, tol) ||
    pointOnSegment(d, a, b, tol)
  )
}

function ringSelfIntersects(ring: Ring, tol: GeometryTolerance): boolean {
  const n = ring.length
  if (n < 4) return false
  for (let i = 0; i < n; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % n]!
    for (let j = i + 1; j < n; j++) {
      const c = ring[j]!
      const d = ring[(j + 1) % n]!
      if (!segmentsTouchOrCross(a, b, c, d, tol)) continue

      const adjacent = j === i + 1 || (i === 0 && j === n - 1)
      if (!adjacent) return true

      if (j === i + 1) {
        if (pointOnSegment(a, c, d, tol) || pointOnSegment(d, a, b, tol)) {
          return true
        }
      } else if (
        pointOnSegment(b, c, d, tol) ||
        pointOnSegment(c, a, b, tol)
      ) {
        return true
      }
    }
  }
  return false
}

function ringsTouchOrCross(
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
      if (segmentsTouchOrCross(a0, a1, b0, b1, tol)) return true
    }
  }
  return false
}

function ringsIntersectProper(
  a: Ring,
  b: Ring,
  tol: GeometryTolerance,
): boolean {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!
    const a1 = a[(i + 1) % a.length]!
    for (let j = 0; j < b.length; j++) {
      if (
        segmentsIntersectProper(
          a0,
          a1,
          b[j]!,
          b[(j + 1) % b.length]!,
          tol,
        )
      ) {
        return true
      }
    }
  }
  return false
}

function ringStrictlyContainsRing(
  outer: Ring,
  inner: Ring,
  tol: GeometryTolerance,
): boolean {
  if (ringsTouchOrCross(outer, inner, tol)) return false
  return inner.every(
    (p) => pointInRing(p, outer, tol) && !pointOnRingBoundary(p, outer, tol),
  )
}

function ringsOverlapOrTouch(
  a: Ring,
  b: Ring,
  tol: GeometryTolerance,
): boolean {
  if (ringsTouchOrCross(a, b, tol)) return true
  return (
    a.some((p) => pointInRing(p, b, tol)) ||
    b.some((p) => pointInRing(p, a, tol))
  )
}

function pointStrictlyInPolygon(
  point: Point,
  polygon: Polygon,
  tol: GeometryTolerance,
): boolean {
  if (
    !pointInRing(point, polygon.outer, tol) ||
    pointOnRingBoundary(point, polygon.outer, tol)
  ) {
    return false
  }
  return !polygon.holes.some((hole) => pointInRing(point, hole, tol))
}

function collinearOverlapHasLength(
  a0: Point,
  a1: Point,
  b0: Point,
  b1: Point,
  tol: GeometryTolerance,
): boolean {
  const dx = a1.x - a0.x
  const dy = a1.y - a0.y
  const length = Math.hypot(dx, dy)
  if (length <= tol.abs) return false
  const cross0 = dx * (b0.y - a0.y) - dy * (b0.x - a0.x)
  const cross1 = dx * (b1.y - a0.y) - dy * (b1.x - a0.x)
  const distanceTolerance = tol.abs + tol.rel * Math.max(length, 1)
  if (
    Math.abs(cross0) / length > distanceTolerance ||
    Math.abs(cross1) / length > distanceTolerance
  ) {
    return false
  }

  const ux = dx / length
  const uy = dy / length
  const projection0 = (b0.x - a0.x) * ux + (b0.y - a0.y) * uy
  const projection1 = (b1.x - a0.x) * ux + (b1.y - a0.y) * uy
  const overlapStart = Math.max(0, Math.min(projection0, projection1))
  const overlapEnd = Math.min(length, Math.max(projection0, projection1))
  return overlapEnd - overlapStart > tol.abs
}

function outerEdgesOverlapOnSameSide(
  a: Ring,
  b: Ring,
  tol: GeometryTolerance,
): boolean {
  const aWinding = Math.sign(signedArea(a))
  const bWinding = Math.sign(signedArea(b))
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!
    const a1 = a[(i + 1) % a.length]!
    const adx = a1.x - a0.x
    const ady = a1.y - a0.y
    const aLength = Math.hypot(adx, ady)
    if (aLength <= tol.abs) continue
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j]!
      const b1 = b[(j + 1) % b.length]!
      if (!collinearOverlapHasLength(a0, a1, b0, b1, tol)) continue
      const bdx = b1.x - b0.x
      const bdy = b1.y - b0.y
      const bLength = Math.hypot(bdx, bdy)
      if (bLength <= tol.abs) continue

      const aNormalX = (-ady / aLength) * aWinding
      const aNormalY = (adx / aLength) * aWinding
      const bNormalX = (-bdy / bLength) * bWinding
      const bNormalY = (bdx / bLength) * bWinding
      if (aNormalX * bNormalX + aNormalY * bNormalY > 0) return true
    }
  }
  return false
}

function polygonsProvablyOverlap(
  a: Polygon,
  b: Polygon,
  tol: GeometryTolerance,
): boolean {
  if (ringsIntersectProper(a.outer, b.outer, tol)) return true
  if (outerEdgesOverlapOnSameSide(a.outer, b.outer, tol)) return true
  if (b.holes.some((hole) => ringsIntersectProper(a.outer, hole, tol))) {
    return true
  }
  if (a.holes.some((hole) => ringsIntersectProper(b.outer, hole, tol))) {
    return true
  }
  if (a.outer.some((point) => pointStrictlyInPolygon(point, b, tol))) {
    return true
  }
  if (b.outer.some((point) => pointStrictlyInPolygon(point, a, tol))) {
    return true
  }

  return (
    a.outer.every((point) => pointOnRingBoundary(point, b.outer, tol)) &&
    b.outer.every((point) => pointOnRingBoundary(point, a.outer, tol))
  )
}

export function validateRing(
  ring: Ring,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): ValidityReport {
  const issues: ValidityIssue[] = []
  const hasNonFiniteCoordinate = ring.some(
    (p) => !Number.isFinite(p.x) || !Number.isFinite(p.y),
  )
  const hasOpenRingDuplicate =
    ring.length > 1 && pointsEqual(ring[0]!, ring[ring.length - 1]!, tol)
  const effectiveRing = hasOpenRingDuplicate ? ring.slice(0, -1) : ring
  if (effectiveRing.length < 3) issues.push('too_few_points')
  if (hasNonFiniteCoordinate) issues.push('non_finite_coordinate')
  if (hasOpenRingDuplicate) issues.push('open_ring_duplicate')
  if (!hasNonFiniteCoordinate) {
    if (absoluteArea(effectiveRing) <= areaTolerance(tol)) {
      issues.push('degenerate_area')
    }
    if (ringSelfIntersects(effectiveRing, tol)) issues.push('self_intersecting')
  }
  return { ok: issues.length === 0, issues }
}

export function validatePolygon(
  poly: Polygon,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): ValidityReport {
  const issues: ValidityIssue[] = []
  const outer = validateRing(poly.outer, tol)
  issues.push(...outer.issues)
  const holeReports: ValidityReport[] = []
  for (const h of poly.holes) {
    const hr = validateRing(h, tol)
    holeReports.push(hr)
    issues.push(...hr.issues)
  }

  if (outer.ok && holeReports.every((report) => report.ok)) {
    if (
      poly.holes.some(
        (hole) => !ringStrictlyContainsRing(poly.outer, hole, tol),
      )
    ) {
      issues.push('hole_outside')
    }
    for (let i = 0; i < poly.holes.length; i++) {
      for (let j = i + 1; j < poly.holes.length; j++) {
        if (ringsOverlapOrTouch(poly.holes[i]!, poly.holes[j]!, tol)) {
          issues.push('holes_intersect')
        }
      }
    }
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
  const validPolygons: Polygon[] = []
  for (const p of shape.polygons) {
    const report = validatePolygon(p, tol)
    issues.push(...report.issues)
    if (report.ok) validPolygons.push(p)
  }
  for (let i = 0; i < validPolygons.length; i++) {
    for (let j = i + 1; j < validPolygons.length; j++) {
      if (polygonsProvablyOverlap(validPolygons[i]!, validPolygons[j]!, tol)) {
        issues.push('polygons_overlap')
      }
    }
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
