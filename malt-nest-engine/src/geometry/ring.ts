import type { BoundingBox, Point, Ring } from './types'
import {
  DEFAULT_TOLERANCE,
  nearlyEqual,
  nearlyZero,
  type GeometryTolerance,
} from './tolerance'

/** Shoelace signed area. >0 ⇒ CCW in this coordinate system. */
export function signedArea(ring: Ring): number {
  if (ring.length < 3) return 0
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    s += a.x * b.y - b.x * a.y
  }
  return s * 0.5
}

export function absoluteArea(ring: Ring): number {
  return Math.abs(signedArea(ring))
}

/** Perimeter of closed ring. */
export function perimeter(ring: Ring): number {
  if (ring.length < 2) return 0
  let p = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    p += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return p
}

/** Area-weighted centroid of a simple ring (no holes). */
export function ringCentroid(
  ring: Ring,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): Point | null {
  if (ring.length < 3) return null
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < ring.length; i++) {
    const p0 = ring[i]!
    const p1 = ring[(i + 1) % ring.length]!
    const cross = p0.x * p1.y - p1.x * p0.y
    a += cross
    cx += (p0.x + p1.x) * cross
    cy += (p0.y + p1.y) * cross
  }
  a *= 0.5
  if (nearlyZero(a, tol)) return null
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

export function ringBounds(ring: Ring): BoundingBox | null {
  if (ring.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of ring) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export function isCcw(ring: Ring): boolean {
  return signedArea(ring) > 0
}

export function reverseRing(ring: Ring): Ring {
  return [...ring].reverse()
}

/** Drop consecutive duplicates and collinear middle vertices (within tol). */
export function cleanRing(
  ring: Ring,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): Ring {
  if (ring.length === 0) return ring
  const out: Point[] = []
  for (const p of ring) {
    const prev = out[out.length - 1]
    if (
      prev &&
      nearlyEqual(prev.x, p.x, tol) &&
      nearlyEqual(prev.y, p.y, tol)
    ) {
      continue
    }
    out.push(p)
  }
  // Close duplicate: last == first
  if (
    out.length >= 2 &&
    nearlyEqual(out[0]!.x, out[out.length - 1]!.x, tol) &&
    nearlyEqual(out[0]!.y, out[out.length - 1]!.y, tol)
  ) {
    out.pop()
  }

  // Remove collinear points
  if (out.length < 3) return out
  const cleaned: Point[] = []
  for (let i = 0; i < out.length; i++) {
    const prev = out[(i - 1 + out.length) % out.length]!
    const cur = out[i]!
    const next = out[(i + 1) % out.length]!
    const ax = cur.x - prev.x
    const ay = cur.y - prev.y
    const bx = next.x - cur.x
    const by = next.y - cur.y
    const cross = ax * by - ay * bx
    const lenScale = Math.hypot(ax, ay) * Math.hypot(bx, by)
    if (Math.abs(cross) <= tol.abs + tol.rel * lenScale) continue
    cleaned.push(cur)
  }
  return cleaned.length >= 3 ? cleaned : out
}

export function ensureWinding(ring: Ring, wantCcw: boolean): Ring {
  const ccw = isCcw(ring)
  if (ccw === wantCcw) return ring
  return reverseRing(ring)
}
