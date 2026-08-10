import { geomEps, type GeometryIssue } from './tolerance'
import type { Point, Polygon } from './types'
import {
  cleanClosedRing,
  normalizeWinding,
  polygonArea,
  signedArea,
} from './ops'

export type NormalizeResult = {
  polygon: Polygon
  issues: GeometryIssue[]
  ok: boolean
}

/** Remove duplicates, zero-length edges, NaNs; enforce winding. */
export function normalizePolygon(
  points: Point[],
  wantCcw: boolean,
): NormalizeResult {
  const issues: GeometryIssue[] = []
  const finite = points.filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
  )
  if (finite.length < points.length) {
    issues.push({ code: 'nan', message: 'Dropped non-finite coordinates' })
  }
  let ring = cleanClosedRing(finite, geomEps())
  // Drop zero-length edges after clean
  const compact: Point[] = []
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!
    const q = ring[(i + 1) % ring.length]!
    if (Math.hypot(p.x - q.x, p.y - q.y) > geomEps()) compact.push(p)
  }
  ring = compact
  if (ring.length < 3) {
    issues.push({ code: 'degenerate', message: 'Polygon has < 3 vertices' })
    return { polygon: { points: ring }, issues, ok: false }
  }
  if (polygonArea(ring) <= geomEps() * geomEps()) {
    issues.push({ code: 'degenerate', message: 'Polygon area near zero' })
    return { polygon: { points: ring }, issues, ok: false }
  }
  ring = normalizeWinding(ring, wantCcw)
  return { polygon: { points: ring }, issues, ok: true }
}

export function validateGeometry(points: Point[]): GeometryIssue[] {
  const { issues, ok } = normalizePolygon(points, signedArea(points) >= 0)
  if (!ok && !issues.length) {
    issues.push({ code: 'empty', message: 'Invalid geometry' })
  }
  return issues
}
