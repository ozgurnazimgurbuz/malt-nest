import { solidFromRings, type Solid } from './collide'
import { isConvexPolygon } from './convex'
import { minkowskiDifferenceConvex, convexHull } from './minkowski'
import { normalizePolygon } from './normalize'
import { boundingBox, pointInPolygon, signedArea } from './ops'
import { geomEps, type GeometryIssue } from './tolerance'
import type { MultiPolygon, Point, Polygon } from './types'
import {
  clipperMinkowskiDiffNfp,
  clipperInflate,
  clipperUnion,
  pathsDToMultiPolygons,
  ringToPathD,
  solidToPathsD,
} from './backend/clipperAdapter'
import { GEOMETRY_BACKEND_ID } from './backend/id'
import { convexDecompose } from './convex'
import { isPositiveD } from 'clipper2-ts'

export type NfpResult = {
  /**
   * Forbidden translation MultiPolygons (outer + holes in forbidden region).
   * A translation t is forbidden (overlap) when strictly inside solid of any region.
   * Boundary ⇒ touching (allowed when spacing = 0).
   */
  regions: MultiPolygon[]
  /** Flat list of outer contours (compat / candidate sampling). */
  outers: Polygon[]
  /** Visualization hull / primary outer. */
  outer: Polygon
  method:
    | 'minkowski-convex'
    | 'minkowski-clipper'
    | 'minkowski-convex-decomp-union'
  /** True only when both outers are convex (analytic Minkowski). */
  exact: boolean
  spacingMm: number
  backend: string
  issues: GeometryIssue[]
}

export type NfpOptions = {
  /** Preserve every source vertex; cheap ranking defaults to simplified. */
  fidelity?: 'simplified' | 'exact'
}

function pointStrictlyIn(p: Point, ring: Point[]): boolean {
  if (!pointInPolygon(p, ring)) return false
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % n]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    if (len2 < geomEps() * geomEps()) continue
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const qx = a.x + t * dx
    const qy = a.y + t * dy
    if (Math.hypot(p.x - qx, p.y - qy) <= geomEps() * 10) return false
  }
  return true
}

function pointInMulti(p: Point, mp: MultiPolygon): boolean {
  if (!pointStrictlyIn(p, mp.outer.points)) return false
  for (const h of mp.holes) {
    if (pointInPolygon(p, h.points)) return false
  }
  return true
}

/** Whether translation t places moving into forbidden (overlap) region. */
export function translationInNfp(t: Point, nfp: NfpResult): boolean {
  for (const r of nfp.regions) {
    if (pointInMulti(t, r)) return true
  }
  return false
}

function packResult(
  regions: MultiPolygon[],
  method: NfpResult['method'],
  exact: boolean,
  spacing: number,
  issues: GeometryIssue[],
): NfpResult {
  const outers = regions.map((r) => r.outer)
  const allPts = regions.flatMap((r) => [
    ...r.outer.points,
    ...r.holes.flatMap((h) => h.points),
  ])
  const hull = allPts.length
    ? { points: convexHull(allPts) }
    : outers[0] ?? { points: [] }
  return {
    regions,
    outers,
    outer: outers[0] ?? hull,
    method,
    exact,
    spacingMm: spacing,
    backend: GEOMETRY_BACKEND_ID,
    issues,
  }
}

function packSpacedResult(
  regions: MultiPolygon[],
  method: NfpResult['method'],
  exact: boolean,
  spacing: number,
  issues: GeometryIssue[],
  fidelity: NfpOptions['fidelity'],
): NfpResult {
  if (spacing <= geomEps() || regions.length === 0) {
    return packResult(regions, method, exact, spacing, issues)
  }
  const paths = regions.flatMap((region) =>
    solidToPathsD(
      solidFromRings(
        region.outer.points,
        region.holes.map((hole) => hole.points),
      ),
    ),
  )
  const inflated = clipperInflate(
    paths,
    spacing,
    fidelity === 'simplified' ? 'miter' : 'round',
  )
  issues.push(...inflated.issues)
  const spaced = pathsDToMultiPolygons(inflated.paths)
  if (spaced.length > 0) {
    return packResult(spaced, method, exact, spacing, issues)
  }
  issues.push({
    code: 'nfp_failed',
    message: 'Spacing offset failed; using unspaced NFP candidates',
  })
  return packResult(regions, method, exact, spacing, issues)
}

/**
 * No-Fit Polygon for moving solid B relative to stationary solid A.
 *
 * Spacing: dilate the completed forbidden region by the Euclidean clearance.
 * This is equivalent to offsetting A first, without multiplying round-arc
 * vertices through the quadratic Minkowski operation.
 * Holes of A are not solid in NFP (outers only) — part-in-part is separate.
 */
export function computeNfp(
  stationary: Solid,
  moving: Solid,
  spacingMm = 0,
  options: NfpOptions = {},
): NfpResult {
  const issues: GeometryIssue[] = []
  const spacing = Math.max(0, spacingMm)
  const aOuter = stationary.outer
  const bOuter = moving.outer
  if (aOuter.points.length < 3 || bOuter.points.length < 3) {
    issues.push({ code: 'nfp_failed', message: 'Degenerate solid for NFP' })
    return packResult([], 'minkowski-convex', false, spacing, issues)
  }

  const aConvex = isConvexPolygon(aOuter)
  const bConvex = isConvexPolygon(bOuter)

  if (aConvex && bConvex) {
    const region = minkowskiDifferenceConvex(aOuter, bOuter)
    const cleaned = normalizePolygon(region.points, true)
    const poly = cleaned.ok ? cleaned.polygon : region
    return packSpacedResult(
      poly.points.length >= 3 ? [{ outer: poly, holes: [] }] : [],
      'minkowski-convex',
      true,
      spacing,
      issues,
      options.fidelity,
    )
  }

  // Primary: Clipper Minkowski difference (handles concave topology)
  const clip = clipperMinkowskiDiffNfp(aOuter.points, bOuter.points, options)
  issues.push(...clip.issues)
  let regions = pathsDToMultiPolygons(clip.paths)
  if (regions.length) {
    return packSpacedResult(
      regions,
      'minkowski-clipper',
      false,
      spacing,
      issues,
      options.fidelity,
    )
  }

  // Fallback: convex decomp → Minkowski pieces → boolean union
  const aPieces = convexDecompose(aOuter)
  const bPieces = convexDecompose(bOuter)
  if (!aPieces.length || !bPieces.length) {
    issues.push({
      code: 'nfp_failed',
      message: 'Clipper + decomposition failed; hull fallback',
    })
    const hullA = { points: convexHull(aOuter.points) }
    const hullB = { points: convexHull(bOuter.points) }
    const region = minkowskiDifferenceConvex(hullA, hullB)
    return packSpacedResult(
      region.points.length >= 3 ? [{ outer: region, holes: [] }] : [],
      'minkowski-convex-decomp-union',
      false,
      spacing,
      issues,
      options.fidelity,
    )
  }

  let acc: ReturnType<typeof ringToPathD>[] = []
  for (const ap of aPieces) {
    for (const bp of bPieces) {
      const diff = minkowskiDifferenceConvex(ap, bp)
      if (
        diff.points.length >= 3 &&
        Math.abs(signedArea(diff.points)) > geomEps() * geomEps()
      ) {
        let path = ringToPathD(diff.points)
        if (!isPositiveD(path)) path = [...path].reverse()
        if (!acc.length) acc = [path]
        else acc = clipperUnion(acc, [path])
      }
    }
  }
  regions = pathsDToMultiPolygons(acc)
  if (!regions.length) {
    issues.push({ code: 'nfp_failed', message: 'Union of Minkowski pieces empty' })
  }
  return packSpacedResult(
    regions,
    'minkowski-convex-decomp-union',
    false,
    spacing,
    issues,
    options.fidelity,
  )
}

/** Sample contact translations from NFP boundaries. */
export function nfpBoundaryTranslations(nfp: NfpResult): Point[] {
  const out: Point[] = []
  const seen = new Set<string>()
  const eps = geomEps()
  const push = (p: Point) => {
    const key = `${Math.round(p.x / eps)},${Math.round(p.y / eps)}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(p)
  }
  const sampleRing = (pts: Point[]) => {
    for (const p of pts) push(p)
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!
      const b = pts[(i + 1) % pts.length]!
      push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    }
  }
  // Prefer bottom-left contacts: densify only outer extrema (fewer mid-edge samples)
  for (const r of nfp.regions) {
    sampleRing(r.outer.points)
    // Sample hole boundaries (useful when forbidden region has holes)
    for (const h of r.holes) {
      for (const p of h.points) push(p)
    }
  }
  for (const o of nfp.outers) sampleRing(o.points)
  return out
}

export function nfpAsSolid(nfp: NfpResult): Solid {
  const r = nfp.regions[0]
  if (r) {
    return solidFromRings(
      r.outer.points,
      r.holes.map((h) => h.points),
    )
  }
  return solidFromRings(nfp.outer.points, [])
}

export function nfpBounds(nfp: NfpResult) {
  return boundingBox(nfp.outer.points)
}

export { GEOMETRY_BACKEND_ID }
