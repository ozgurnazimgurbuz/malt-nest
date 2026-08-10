import { geomEps } from './tolerance'
import type { Point, Polygon } from './types'
import { normalizePolygon } from './normalize'
import { signedArea } from './ops'

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

function isConvexVertex(prev: Point, cur: Point, next: Point, ccw: boolean): boolean {
  const c = cross(prev, cur, next)
  return ccw ? c > geomEps() : c < -geomEps()
}

function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const c1 = cross(a, b, p)
  const c2 = cross(b, c, p)
  const c3 = cross(c, a, p)
  const hasNeg = c1 < -geomEps() || c2 < -geomEps() || c3 < -geomEps()
  const hasPos = c1 > geomEps() || c2 > geomEps() || c3 > geomEps()
  return !(hasNeg && hasPos)
}

/** Ear-clip convex pieces (triangles) for a simple polygon. Falls back to hull triangle fan. */
export function convexDecompose(polygon: Polygon): Polygon[] {
  const norm = normalizePolygon(polygon.points, true)
  if (!norm.ok) return []
  let pts = norm.polygon.points.map((p) => ({ ...p }))
  if (pts.length === 3) return [{ points: pts }]
  if (pts.length < 3) return []

  // Fast path: already convex
  let convex = true
  const n0 = pts.length
  for (let i = 0; i < n0; i++) {
    if (
      !isConvexVertex(
        pts[(i - 1 + n0) % n0]!,
        pts[i]!,
        pts[(i + 1) % n0]!,
        true,
      )
    ) {
      convex = false
      break
    }
  }
  if (convex) return [{ points: pts }]

  const pieces: Polygon[] = []
  let guard = 0
  while (pts.length > 3 && guard++ < 10_000) {
    let ear = -1
    const n = pts.length
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n]!
      const cur = pts[i]!
      const next = pts[(i + 1) % n]!
      if (!isConvexVertex(prev, cur, next, true)) continue
      let empty = true
      for (let j = 0; j < n; j++) {
        if (j === (i - 1 + n) % n || j === i || j === (i + 1) % n) continue
        if (pointInTriangle(pts[j]!, prev, cur, next)) {
          empty = false
          break
        }
      }
      if (empty) {
        ear = i
        break
      }
    }
    if (ear < 0) break
    const m = pts.length
    const tri = [
      pts[(ear - 1 + m) % m]!,
      pts[ear]!,
      pts[(ear + 1) % m]!,
    ]
    if (Math.abs(signedArea(tri)) > geomEps() * geomEps()) {
      pieces.push({ points: tri.map((p) => ({ ...p })) })
    }
    pts.splice(ear, 1)
  }
  if (pts.length >= 3 && Math.abs(signedArea(pts)) > geomEps() * geomEps()) {
    pieces.push({ points: pts.map((p) => ({ ...p })) })
  }
  return pieces
}

export function isConvexPolygon(polygon: Polygon): boolean {
  const norm = normalizePolygon(polygon.points, true)
  if (!norm.ok) return false
  const pts = norm.polygon.points
  const n = pts.length
  for (let i = 0; i < n; i++) {
    if (
      !isConvexVertex(
        pts[(i - 1 + n) % n]!,
        pts[i]!,
        pts[(i + 1) % n]!,
        true,
      )
    ) {
      return false
    }
  }
  return true
}
