import {
  absoluteArea,
  cleanRing,
  ensureWinding,
  perimeter,
  ringBounds,
  ringCentroid,
  signedArea,
} from './ring'
import type { BoundingBox, Point, Polygon, Ring, Shape } from './types'
import { DEFAULT_TOLERANCE, type GeometryTolerance } from './tolerance'

export function polygonArea(poly: Polygon): number {
  let a = absoluteArea(poly.outer)
  for (const h of poly.holes) a -= absoluteArea(h)
  return Math.max(0, a)
}

export function polygonPerimeter(poly: Polygon): number {
  let p = perimeter(poly.outer)
  for (const h of poly.holes) p += perimeter(h)
  return p
}

export function polygonCentroid(poly: Polygon): Point | null {
  // Approximate: outer centroid weighted by area minus holes (first-order).
  const oc = ringCentroid(poly.outer)
  if (!oc) return null
  let a = signedArea(poly.outer)
  let cx = oc.x * a
  let cy = oc.y * a
  for (const h of poly.holes) {
    const hc = ringCentroid(h)
    if (!hc) continue
    const ha = signedArea(h) // holes CW ⇒ negative if normalized
    cx += hc.x * ha
    cy += hc.y * ha
    a += ha
  }
  if (Math.abs(a) < 1e-18) return oc
  return { x: cx / a, y: cy / a }
}

export function polygonBounds(poly: Polygon): BoundingBox | null {
  return ringBounds(poly.outer)
}

/** Normalize: clean rings; outer CCW; holes CW. */
export function normalizePolygon(
  poly: Polygon,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): Polygon {
  const outer = ensureWinding(cleanRing(poly.outer, tol), true)
  const holes = poly.holes.map((h) =>
    ensureWinding(cleanRing(h, tol), false),
  )
  return { outer, holes }
}

export function normalizeShape(
  shape: Shape,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): Shape {
  return {
    id: shape.id,
    polygons: shape.polygons.map((p) => normalizePolygon(p, tol)),
  }
}

export function shapeArea(shape: Shape): number {
  return shape.polygons.reduce((s, p) => s + polygonArea(p), 0)
}

export function shapePerimeter(shape: Shape): number {
  return shape.polygons.reduce((s, p) => s + polygonPerimeter(p), 0)
}

export function shapeCentroid(shape: Shape): Point | null {
  let a = 0
  let cx = 0
  let cy = 0
  for (const p of shape.polygons) {
    const c = polygonCentroid(p)
    if (!c) continue
    const pa = polygonArea(p)
    cx += c.x * pa
    cy += c.y * pa
    a += pa
  }
  if (a <= 0) return null
  return { x: cx / a, y: cy / a }
}

export function shapeBounds(shape: Shape): BoundingBox | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let any = false
  for (const p of shape.polygons) {
    const b = polygonBounds(p)
    if (!b) continue
    any = true
    if (b.minX < minX) minX = b.minX
    if (b.minY < minY) minY = b.minY
    if (b.maxX > maxX) maxX = b.maxX
    if (b.maxY > maxY) maxY = b.maxY
  }
  return any ? { minX, minY, maxX, maxY } : null
}

export function makePolygon(outer: Ring, holes: Ring[] = []): Polygon {
  return { outer, holes }
}

export function makeShape(
  id: string,
  outer: Ring,
  holes: Ring[] = [],
): Shape {
  return { id, polygons: [makePolygon(outer, holes)] }
}
