import { solidFromRings, type Solid } from './collide'
import { isConvexPolygon } from './convex'
import { minkowskiDifferenceConvex, convexHull } from './minkowski'
import { normalizePolygon } from './normalize'
import { offsetSolid } from './offset'
import { boundingBox, pointInPolygon, signedArea } from './ops'
import { geomEps, type GeometryIssue } from './tolerance'
import type { MultiPolygon, Point, Polygon } from './types'
import {
  clipperMinkowskiDiffNfp,
  clipperUnion,
  pathsDToMultiPolygons,
  ringToPathD,
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

/**
 * No-Fit Polygon for moving solid B relative to stationary solid A.
 *
 * Spacing: geometric offset of A by +spacing before Minkowski.
 * Holes of A are not solid in NFP (outers only) — part-in-part is separate.
 */
export function computeNfp(
  stationary: Solid,
  moving: Solid,
  spacingMm = 0,
): NfpResult {
  const issues: GeometryIssue[] = []
  const spacing = Math.max(0, spacingMm)

  let A = stationary
  if (spacing > geomEps()) {
    const off = offsetSolid(stationary, spacing)
    issues.push(...off.issues)
    if (off.solid.outer.points.length >= 3) A = off.solid
    else {
      issues.push({
        code: 'nfp_failed',
        message: 'Spacing offset failed; using unspaced NFP',
      })
    }
  }

  const aOuter = A.outer
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
    return packResult(
      poly.points.length >= 3 ? [{ outer: poly, holes: [] }] : [],
      'minkowski-convex',
      true,
      spacing,
      issues,
    )
  }

  // Primary: Clipper Minkowski difference (handles concave topology)
  const clip = clipperMinkowskiDiffNfp(aOuter.points, bOuter.points)
  issues.push(...clip.issues)
  let regions = pathsDToMultiPolygons(clip.paths)
  if (regions.length) {
    return packResult(regions, 'minkowski-clipper', false, spacing, issues)
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
    return packResult(
      region.points.length >= 3 ? [{ outer: region, holes: [] }] : [],
      'minkowski-convex-decomp-union',
      false,
      spacing,
      issues,
    )
  }

  let acc: ReturnType<typeof ringToPathD>[] = []
  for (const ap of aPieces) {
    for (const bp of bPieces) {
      const diff = minkowskiDifferenceConvex(ap, bp)
      if (diff.points.length >= 3 && Math.abs(signedArea(diff.points)) > geomEps()) {
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
  return packResult(
    regions,
    'minkowski-convex-decomp-union',
    false,
    spacing,
    issues,
  )
}

/** Sample contact translations from NFP boundaries. */
export function nfpBoundaryTranslations(nfp: NfpResult): Point[] {
  const out: Point[] = []
  const seen = new Set<string>()
  const push = (p: Point) => {
    const key = `${p.x.toFixed(5)},${p.y.toFixed(5)}`
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

export function solidFingerprint(solid: Solid): string {
  const parts: number[] = [solid.outer.points.length, solid.holes.length]
  for (const p of solid.outer.points) {
    parts.push(Math.round(p.x * 1e4), Math.round(p.y * 1e4))
  }
  for (const h of solid.holes) {
    parts.push(h.points.length)
    for (const p of h.points) {
      parts.push(Math.round(p.x * 1e4), Math.round(p.y * 1e4))
    }
  }
  let hash = 2166136261
  for (const n of parts) {
    hash ^= n >>> 0
    hash = Math.imul(hash, 16777619)
  }
  return `${GEOMETRY_BACKEND_ID}:${(hash >>> 0).toString(16)}`
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
