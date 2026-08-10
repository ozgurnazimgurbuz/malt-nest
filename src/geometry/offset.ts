import { normalizePolygon } from './normalize'
import { geomEps, GeometryError, type GeometryIssue } from './tolerance'
import type { Point, Polygon } from './types'
import { signedArea } from './ops'
import type { Solid } from './collide'
import { solidFromRings } from './collide'
import {
  clipperInflate,
  multiPolygonToSolid,
  pathsDToMultiPolygons,
  ringToPathD,
  solidToPathsD,
} from './backend/clipperAdapter'
import { isPositiveD } from 'clipper2-ts'

const MITER_LIMIT = 4

function unit(dx: number, dy: number): Point {
  const len = Math.hypot(dx, dy)
  if (len <= geomEps()) return { x: 0, y: 0 }
  return { x: dx / len, y: dy / len }
}

/** Legacy miter offset — fallback if Clipper inflate fails. */
function offsetPolygonMiter(
  polygon: Polygon,
  distance: number,
): { polygon: Polygon; issues: GeometryIssue[] } {
  const issues: GeometryIssue[] = []
  const norm = normalizePolygon(polygon.points, signedArea(polygon.points) >= 0)
  issues.push(...norm.issues)
  if (!norm.ok) return { polygon: { points: [] }, issues }
  const ring = norm.polygon.points
  if (Math.abs(distance) <= geomEps()) {
    return { polygon: { points: ring.map((p) => ({ ...p })) }, issues }
  }

  const n = ring.length
  const outs: Point[] = []
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n]!
    const cur = ring[i]!
    const next = ring[(i + 1) % n]!
    const e1 = unit(cur.x - prev.x, cur.y - prev.y)
    const e2 = unit(next.x - cur.x, next.y - cur.y)
    const n1 = { x: e1.y, y: -e1.x }
    const n2 = { x: e2.y, y: -e2.x }
    const sin = e1.x * e2.y - e1.y * e2.x
    const cos = e1.x * e2.x + e1.y * e2.y
    let ox = n1.x + n2.x
    let oy = n1.y + n2.y
    const ol = Math.hypot(ox, oy)
    if (ol <= geomEps()) {
      outs.push({
        x: cur.x + n1.x * distance,
        y: cur.y + n1.y * distance,
      })
      continue
    }
    ox /= ol
    oy /= ol
    const q = Math.max(geomEps(), (1 + cos) / 2)
    let miter = distance / Math.sqrt(q)
    if (Math.abs(miter) > Math.abs(distance) * MITER_LIMIT) {
      outs.push({
        x: cur.x + n1.x * distance,
        y: cur.y + n1.y * distance,
      })
      outs.push({
        x: cur.x + n2.x * distance,
        y: cur.y + n2.y * distance,
      })
      continue
    }
    if (sin < 0 && distance > 0) miter = distance
    outs.push({ x: cur.x + ox * miter, y: cur.y + oy * miter })
  }

  const cleaned = normalizePolygon(outs, signedArea(ring) >= 0)
  issues.push(...cleaned.issues)
  if (!cleaned.ok) {
    issues.push({
      code: 'offset_failed',
      message: 'Offset produced degenerate polygon',
    })
    return { polygon: { points: [] }, issues }
  }
  return { polygon: cleaned.polygon, issues }
}

/**
 * Offset a closed ring by `distance` mm (Clipper round join).
 * Positive expands a CCW outer; use offsetSolid for solids with holes.
 */
export function offsetPolygon(
  polygon: Polygon,
  distance: number,
): { polygon: Polygon; issues: GeometryIssue[]; backend: 'clipper' | 'miter' } {
  const issues: GeometryIssue[] = []
  if (!Number.isFinite(distance)) {
    throw new GeometryError('offsetPolygon: non-finite distance', [
      { code: 'offset_failed', message: 'Non-finite distance' },
    ])
  }
  const norm = normalizePolygon(polygon.points, signedArea(polygon.points) >= 0)
  issues.push(...norm.issues)
  if (!norm.ok) {
    return { polygon: { points: [] }, issues, backend: 'clipper' }
  }
  if (Math.abs(distance) <= geomEps()) {
    return {
      polygon: { points: norm.polygon.points.map((p) => ({ ...p })) },
      issues,
      backend: 'clipper',
    }
  }

  let path = ringToPathD(norm.polygon.points)
  const wantPositive = signedArea(norm.polygon.points) >= 0
  if (wantPositive && !isPositiveD(path)) path = [...path].reverse()
  if (!wantPositive && isPositiveD(path)) path = [...path].reverse()

  const inflated = clipperInflate([path], distance)
  issues.push(...inflated.issues)
  const mps = pathsDToMultiPolygons(inflated.paths)
  if (mps.length && mps[0]!.outer.points.length >= 3) {
    // For a single ring offset, take the primary outer (or hole if negative)
    if (distance < 0 && mps[0]!.holes.length === 0) {
      return { polygon: mps[0]!.outer, issues, backend: 'clipper' }
    }
    return { polygon: mps[0]!.outer, issues, backend: 'clipper' }
  }

  const fallback = offsetPolygonMiter(polygon, distance)
  issues.push(...fallback.issues)
  issues.push({
    code: 'offset_failed',
    message: 'Clipper inflate empty; used miter fallback',
  })
  return { polygon: fallback.polygon, issues, backend: 'miter' }
}

/** Offset a solid: outer expands with +d, holes shrink with +d (solid grows). */
export function offsetSolid(
  solid: Solid,
  distance: number,
): { solid: Solid; issues: GeometryIssue[]; backend: 'clipper' | 'miter' } {
  const issues: GeometryIssue[] = []
  if (Math.abs(distance) <= geomEps()) {
    return {
      solid: solidFromRings(
        solid.outer.points.map((p) => ({ ...p })),
        solid.holes.map((h) => h.points.map((p) => ({ ...p }))),
      ),
      issues,
      backend: 'clipper',
    }
  }

  const paths = solidToPathsD(solid)
  const inflated = clipperInflate(paths, distance)
  issues.push(...inflated.issues)
  const mps = pathsDToMultiPolygons(inflated.paths)
  if (mps.length) {
    // Largest outer by area
    let best = mps[0]!
    let bestA = Math.abs(signedArea(best.outer.points))
    for (const mp of mps.slice(1)) {
      const a = Math.abs(signedArea(mp.outer.points))
      if (a > bestA) {
        best = mp
        bestA = a
      }
    }
    return {
      solid: multiPolygonToSolid(best),
      issues,
      backend: 'clipper',
    }
  }

  // Miter fallback (outer + holes separately)
  const outerRes = offsetPolygonMiter(solid.outer, distance)
  issues.push(...outerRes.issues)
  if (outerRes.polygon.points.length < 3) {
    return { solid: solidFromRings([], []), issues, backend: 'miter' }
  }
  const holes: Point[][] = []
  for (const h of solid.holes) {
    const ccw = normalizePolygon(h.points, true)
    const ho = offsetPolygonMiter(ccw.polygon, -distance)
    issues.push(...ho.issues)
    if (ho.polygon.points.length >= 3) {
      const cw = normalizePolygon(ho.polygon.points, false)
      if (cw.ok) holes.push(cw.polygon.points)
    }
  }
  issues.push({
    code: 'offset_failed',
    message: 'Clipper solid inflate empty; used miter fallback',
  })
  return {
    solid: solidFromRings(outerRes.polygon.points, holes),
    issues,
    backend: 'miter',
  }
}
