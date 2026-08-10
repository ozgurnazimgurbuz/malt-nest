import type { BoundingBox, Point, Polygon } from './types'

const EPS = 1e-9

export function nearlyEqual(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol
}

export function pointsEqual(a: Point, b: Point, tol = 1e-9): boolean {
  return nearlyEqual(a.x, b.x, tol) && nearlyEqual(a.y, b.y, tol)
}

/** Signed shoelace area. Positive = CCW. */
export function signedArea(points: Point[]): number {
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const q = points[(i + 1) % points.length]!
    sum += p.x * q.y - q.x * p.y
  }
  return sum / 2
}

export function polygonArea(points: Point[]): number {
  return Math.abs(signedArea(points))
}

export function ensureClosed(points: Point[]): Point[] {
  if (points.length === 0) return points
  const first = points[0]!
  const last = points[points.length - 1]!
  if (pointsEqual(first, last)) return points.slice(0, -1)
  return points
}

export function cleanPolyline(points: Point[], tol = EPS): Point[] {
  if (points.length === 0) return []
  const out: Point[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    if (!pointsEqual(out[out.length - 1]!, p, tol)) out.push(p)
  }
  return out
}

export function cleanClosedRing(points: Point[], tol = EPS): Point[] {
  const open = ensureClosed(cleanPolyline(points, tol))
  if (open.length >= 3 && pointsEqual(open[0]!, open[open.length - 1]!, tol)) {
    open.pop()
  }
  return open
}

export function reversePoints(points: Point[]): Point[] {
  return points.slice().reverse()
}

/** Normalize ring winding: CCW if wantCcw, else CW. */
export function normalizeWinding(points: Point[], wantCcw: boolean): Point[] {
  const ring = cleanClosedRing(points)
  if (ring.length < 3) return ring
  const ccw = signedArea(ring) > 0
  return ccw === wantCcw ? ring : reversePoints(ring)
}

export function boundingBox(points: Point[]): BoundingBox {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

export function unionBounds(boxes: BoundingBox[]): BoundingBox | null {
  if (boxes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of boxes) {
    minX = Math.min(minX, b.minX)
    minY = Math.min(minY, b.minY)
    maxX = Math.max(maxX, b.maxX)
    maxY = Math.max(maxY, b.maxY)
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/** Polygon centroid (area-weighted). Falls back to average for degenerate rings. */
export function centroid(points: Point[]): Point {
  const ring = cleanClosedRing(points)
  if (ring.length === 0) return { x: 0, y: 0 }
  if (ring.length < 3) {
    let x = 0
    let y = 0
    for (const p of ring) {
      x += p.x
      y += p.y
    }
    return { x: x / ring.length, y: y / ring.length }
  }
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!
    const q = ring[(i + 1) % ring.length]!
    const cross = p.x * q.y - q.x * p.y
    a += cross
    cx += (p.x + q.x) * cross
    cy += (p.y + q.y) * cross
  }
  a *= 0.5
  if (Math.abs(a) < EPS) {
    let x = 0
    let y = 0
    for (const p of ring) {
      x += p.x
      y += p.y
    }
    return { x: x / ring.length, y: y / ring.length }
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

/** Ray-cast point-in-polygon (even-odd). Ring may be open or closed. */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  const ring = cleanClosedRing(polygon)
  if (ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i]!
    const pj = ring[j]!
    const intersect =
      pi.y > point.y !== pj.y > point.y &&
      point.x <
        ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y + EPS) + pi.x
    if (intersect) inside = !inside
  }
  return inside
}

export function netArea(outer: Polygon, holes: Polygon[]): number {
  let a = polygonArea(outer.points)
  for (const h of holes) a -= polygonArea(h.points)
  return Math.max(0, a)
}

export function toPolygon(points: Point[]): Polygon {
  return { points: cleanClosedRing(points) }
}
