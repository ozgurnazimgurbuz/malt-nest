import type { BoundingBox, Point, Polygon } from './types'
import { boundingBox, centroid, pointInPolygon, pointsEqual } from './ops'
import { geomEps } from './tolerance'

function EPS(): number {
  return geomEps()
}

export type Solid = {
  outer: Polygon
  holes: Polygon[]
  bounds: BoundingBox
}

export function solidFromRings(outer: Point[], holes: Point[][] = []): Solid {
  return {
    outer: { points: outer },
    holes: holes.map((h) => ({ points: h })),
    bounds: boundingBox(outer),
  }
}

export function expandBounds(b: BoundingBox, pad: number): BoundingBox {
  return {
    minX: b.minX - pad,
    minY: b.minY - pad,
    maxX: b.maxX + pad,
    maxY: b.maxY + pad,
    width: b.width + pad * 2,
    height: b.height + pad * 2,
  }
}

export function boundsOverlap(a: BoundingBox, b: BoundingBox, pad = 0): boolean {
  const e = EPS()
  return !(
    a.maxX + pad < b.minX - e ||
    b.maxX + pad < a.minX - e ||
    a.maxY + pad < b.minY - e ||
    b.maxY + pad < a.minY - e
  )
}

/** Point in solid region: inside outer and outside all holes. */
export function pointInSolid(p: Point, solid: Solid): boolean {
  if (!pointInPolygon(p, solid.outer.points)) return false
  for (const h of solid.holes) {
    if (pointInPolygon(p, h.points)) return false
  }
  return true
}

function edges(points: Point[]): Array<[Point, Point]> {
  const out: Array<[Point, Point]> = []
  if (points.length < 2) return out
  for (let i = 0; i < points.length; i++) {
    out.push([points[i]!, points[(i + 1) % points.length]!])
  }
  return out
}

function allEdges(solid: Solid): Array<[Point, Point]> {
  const list = edges(solid.outer.points)
  for (const h of solid.holes) list.push(...edges(h.points))
  return list
}

function orient(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  const e = EPS()
  return (
    Math.min(a.x, b.x) - e <= c.x &&
    c.x <= Math.max(a.x, b.x) + e &&
    Math.min(a.y, b.y) - e <= c.y &&
    c.y <= Math.max(a.y, b.y) + e
  )
}

export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const e = EPS()
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)

  if (o1 * o2 < -e && o3 * o4 < -e) return true
  if (Math.abs(o1) <= e && onSegment(a, b, c)) return true
  if (Math.abs(o2) <= e && onSegment(a, b, d)) return true
  if (Math.abs(o3) <= e && onSegment(c, d, a)) return true
  if (Math.abs(o4) <= e && onSegment(c, d, b)) return true
  return false
}

/** Proper crossing only — shared endpoints / touching edges do not count. */
export function segmentsProperlyIntersect(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): boolean {
  const e = EPS()
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  return o1 * o2 < -e && o3 * o4 < -e
}

function pointOnBoundary(p: Point, solid: Solid): boolean {
  const tol = Math.max(EPS() * 10, 1e-7)
  for (const [a, b] of allEdges(solid)) {
    if (distPointSegment(p, a, b) <= tol) return true
  }
  return false
}

function pointStrictlyInSolid(p: Point, solid: Solid): boolean {
  return pointInSolid(p, solid) && !pointOnBoundary(p, solid)
}

/** True if solid interiors overlap (boundary touch is allowed). */
export function solidsOverlap(a: Solid, b: Solid): boolean {
  if (!boundsOverlap(a.bounds, b.bounds)) return false

  const ae = allEdges(a)
  const be = allEdges(b)
  for (const [p, q] of ae) {
    for (const [r, s] of be) {
      if (segmentsProperlyIntersect(p, q, r, s)) return true
    }
  }

  const samples = (solid: Solid): Point[] => {
    const pts: Point[] = []
    // Inward-ish samples along outer edges (midpoints + slight inward offset)
    const ring = solid.outer.points
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!
      const q = ring[(i + 1) % ring.length]!
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
      const dx = q.x - p.x
      const dy = q.y - p.y
      const len = Math.hypot(dx, dy) || 1
      // CCW outward normal (dy, -dx); inward is opposite
      const ix = mid.x - (dy / len) * 1e-3
      const iy = mid.y + (dx / len) * 1e-3
      pts.push({ x: ix, y: iy })
    }
    const c = centroid(ring)
    if (pointStrictlyInSolid(c, solid)) pts.push(c)
    return pts
  }

  // A sample from solid X must actually lie in X's material before testing Y
  for (const v of samples(a)) {
    if (pointStrictlyInSolid(v, a) && pointStrictlyInSolid(v, b)) return true
  }
  for (const v of samples(b)) {
    if (pointStrictlyInSolid(v, b) && pointStrictlyInSolid(v, a)) return true
  }
  return false
}

function distPointSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < EPS() * EPS()) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const x = a.x + t * dx
  const y = a.y + t * dy
  return Math.hypot(p.x - x, p.y - y)
}

/** Minimum distance between solid boundaries (0 if overlapping). */
export function solidsDistance(a: Solid, b: Solid): number {
  if (solidsOverlap(a, b)) return 0
  let min = Infinity
  const ae = allEdges(a)
  const be = allEdges(b)
  for (const [p, q] of ae) {
    for (const r of b.outer.points) {
      min = Math.min(min, distPointSegment(r, p, q))
    }
    for (const h of b.holes) {
      for (const r of h.points) min = Math.min(min, distPointSegment(r, p, q))
    }
  }
  for (const [p, q] of be) {
    for (const r of a.outer.points) {
      min = Math.min(min, distPointSegment(r, p, q))
    }
    for (const h of a.holes) {
      for (const r of h.points) min = Math.min(min, distPointSegment(r, p, q))
    }
  }
  return min
}

/**
 * Collision for nesting: overlap OR clearance < spacing.
 * Bounding boxes are broad-phase only.
 */
/**
 * Collision for nesting via boundary distance (fallback).
 * Prefer `solidsCollide` from `./spacingCollide` for geometric offset spacing.
 */
export function solidsCollideByDistance(
  a: Solid,
  b: Solid,
  spacingMm: number,
): boolean {
  const pad = Math.max(0, spacingMm)
  const e = EPS()
  if (!boundsOverlap(a.bounds, b.bounds, pad)) return false
  if (solidsOverlap(a, b)) return true
  if (pad <= e) return false
  return solidsDistance(a, b) < pad - e
}

/**
 * Axis-aligned rectangular sheet containment.
 * Checks all outer vertices + edge midpoints (concave-safe for rectangular sheets).
 */
export function solidInsideRect(
  solid: Solid,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  const e = EPS()
  const check = (p: Point) =>
    p.x >= minX - e &&
    p.y >= minY - e &&
    p.x <= maxX + e &&
    p.y <= maxY + e
  const pts = solid.outer.points
  if (pts.length === 0) return false
  for (const p of pts) {
    if (!check(p)) return false
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    if (!check({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) return false
  }
  return true
}

export function translateSolid(solid: Solid, dx: number, dy: number): Solid {
  const outer = solid.outer.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
  const holes = solid.holes.map((h) =>
    h.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  )
  return solidFromRings(outer, holes)
}

export function almostSamePoint(a: Point, b: Point): boolean {
  return pointsEqual(a, b, 1e-7)
}
