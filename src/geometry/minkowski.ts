import { normalizePolygon } from './normalize'
import { geomEps } from './tolerance'
import type { Point, Polygon } from './types'
import { boundingBox, signedArea } from './ops'

function reflect(points: Point[]): Point[] {
  return points.map((p) => ({ x: -p.x, y: -p.y }))
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/** Monotone chain convex hull (CCW). */
export function convexHull(points: Point[]): Point[] {
  const pts = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .slice()
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  if (pts.length <= 1) return pts
  const lower: Point[] = []
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= geomEps()
    ) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= geomEps()
    ) {
      upper.pop()
    }
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/**
 * Minkowski sum of two convex polygons (CCW).
 * Result vertices ⊂ { a + b }.
 */
export function minkowskiSumConvex(a: Polygon, b: Polygon): Polygon {
  const ha = convexHull(a.points)
  const hb = convexHull(b.points)
  if (ha.length === 0 || hb.length === 0) return { points: [] }
  // Ensure CCW
  const A =
    signedArea(ha) >= 0 ? ha : ha.slice().reverse()
  const B =
    signedArea(hb) >= 0 ? hb : hb.slice().reverse()

  // Edge-merge algorithm for convex Minkowski sum
  const n = A.length
  const m = B.length
  // Start at bottom-left of each
  let i0 = 0
  let j0 = 0
  for (let i = 1; i < n; i++) {
    if (A[i]!.y < A[i0]!.y || (A[i]!.y === A[i0]!.y && A[i]!.x < A[i0]!.x))
      i0 = i
  }
  for (let j = 1; j < m; j++) {
    if (B[j]!.y < B[j0]!.y || (B[j]!.y === B[j0]!.y && B[j]!.x < B[j0]!.x))
      j0 = j
  }

  const out: Point[] = []
  let i = 0
  let j = 0
  do {
    const ai = A[(i0 + i) % n]!
    const bj = B[(j0 + j) % m]!
    out.push({ x: ai.x + bj.x, y: ai.y + bj.y })
    const ai2 = A[(i0 + i + 1) % n]!
    const bj2 = B[(j0 + j + 1) % m]!
    const ea = { x: ai2.x - ai.x, y: ai2.y - ai.y }
    const eb = { x: bj2.x - bj.x, y: bj2.y - bj.y }
    const c = ea.x * eb.y - ea.y * eb.x
    if (c > geomEps()) i++
    else if (c < -geomEps()) j++
    else {
      i++
      j++
    }
  } while (i < n || j < m)

  const cleaned = normalizePolygon(out, true)
  return cleaned.ok ? cleaned.polygon : { points: convexHull(out) }
}

/** A ⊕ (−B) for convex polygons — NFP of B relative to A (translation of B). */
export function minkowskiDifferenceConvex(a: Polygon, b: Polygon): Polygon {
  return minkowskiSumConvex(a, { points: reflect(b.points) })
}

export function polygonBounds(poly: Polygon) {
  return boundingBox(poly.points)
}
