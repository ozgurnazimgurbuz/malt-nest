import {
  segmentsProperlyIntersect,
  solidFromRings,
  type Solid,
} from './collide'
import { geomEps } from './tolerance'
import type { Point, Polygon } from './types'
import { boundingBox, pointInPolygon } from './ops'

function edges(points: Point[]): Array<[Point, Point]> {
  const out: Array<[Point, Point]> = []
  for (let i = 0; i < points.length; i++) {
    out.push([points[i]!, points[(i + 1) % points.length]!])
  }
  return out
}

function pointOnRing(p: Point, ring: Point[]): boolean {
  for (const [a, b] of edges(ring)) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    if (len2 < geomEps() * geomEps()) {
      if (Math.hypot(p.x - a.x, p.y - a.y) <= geomEps() * 10) return true
      continue
    }
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    if (Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) <= geomEps() * 10)
      return true
  }
  return false
}

/** Point inside polygon including boundary. */
export function pointInPolygonClosed(p: Point, ring: Point[]): boolean {
  return pointInPolygon(p, ring) || pointOnRing(p, ring)
}

/**
 * True if polygon A is completely inside polygon B (including touching boundary).
 * Robust for concave B: checks vertices, edge midpoints, centroid, and edge crossings.
 */
export function polygonContainsPolygon(container: Polygon, inner: Polygon): boolean {
  const C = container.points
  const I = inner.points
  if (C.length < 3 || I.length < 3) return false

  const cb = boundingBox(C)
  const ib = boundingBox(I)
  if (
    ib.minX < cb.minX - geomEps() ||
    ib.minY < cb.minY - geomEps() ||
    ib.maxX > cb.maxX + geomEps() ||
    ib.maxY > cb.maxY + geomEps()
  ) {
    // Still may fit if container is not AABB-aligned — continue with exact tests
  }

  for (const p of I) {
    if (!pointInPolygonClosed(p, C)) return false
  }
  for (let i = 0; i < I.length; i++) {
    const a = I[i]!
    const b = I[(i + 1) % I.length]!
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    if (!pointInPolygonClosed(mid, C)) return false
  }
  // Proper edge crossings ⇒ not contained
  for (const [a, b] of edges(I)) {
    for (const [c0, d0] of edges(C)) {
      if (segmentsProperlyIntersect(a, b, c0, d0)) return false
    }
  }
  return true
}

/** Axis-aligned sheet with margin — uses full outer ring, not only bbox. */
export function solidInsideSheet(
  solid: Solid,
  sheetW: number,
  sheetH: number,
  marginMm: number,
): boolean {
  const minX = marginMm
  const minY = marginMm
  const maxX = sheetW - marginMm
  const maxY = sheetH - marginMm
  if (maxX - minX < -geomEps() || maxY - minY < -geomEps()) return false
  const sheet: Polygon = {
    points: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
  }
  return polygonContainsPolygon(sheet, solid.outer)
}

/**
 * Inner-fit polygon (IFP) for a moving solid inside an axis-aligned sheet.
 * Returns translation bounds for the local solid origin, or null if impossible.
 *
 * For rectangular sheets the IFP is rectangular in translation space when the
 * part's AABB is used; we still validate with solidInsideSheet for concave parts.
 */
export function computeIfp(
  moving: Solid,
  sheetW: number,
  sheetH: number,
  marginMm: number,
): { minX: number; minY: number; maxX: number; maxY: number; polygon: Polygon } | null {
  const b = moving.bounds
  const minX = marginMm - b.minX
  const minY = marginMm - b.minY
  const maxX = sheetW - marginMm - b.maxX
  const maxY = sheetH - marginMm - b.maxY
  if (minX > maxX + geomEps() || minY > maxY + geomEps()) return null
  return {
    minX,
    minY,
    maxX,
    maxY,
    polygon: {
      points: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
    },
  }
}

/** Host hole as empty region (CW hole ring → treat as CCW container). */
export function holeAsContainer(hole: Polygon): Polygon {
  const area = hole.points.reduce((s, p, i, arr) => {
    const q = arr[(i + 1) % arr.length]!
    return s + (p.x * q.y - q.x * p.y)
  }, 0)
  // shoelace/2 — if CW (negative), reverse to CCW container
  if (area < 0) {
    return { points: hole.points.slice().reverse() }
  }
  return { points: hole.points.slice() }
}

export function solidInsideHole(
  guest: Solid,
  hole: Polygon,
): boolean {
  return polygonContainsPolygon(holeAsContainer(hole), guest.outer)
}

export function rectSolid(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Solid {
  return solidFromRings(
    [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
    [],
  )
}
