import { Clipper, FillRule, JoinType, EndType } from 'clipper2-ts'
import type { Polygon, Ring, Shape } from '../geometry/types'
import {
  DEFAULT_TOLERANCE,
  type GeometryTolerance,
} from '../geometry/tolerance'
import { normalizeShape, shapeCentroid, translateShape } from '../geometry'
import type { NfpRegion } from './types'

export function toPathsD(ring: Ring) {
  return [ring.map((p) => ({ x: p.x, y: p.y }))]
}

export function fromPathD(path: { x: number; y: number }[]): Ring {
  return path.map((p) => ({ x: p.x, y: p.y }))
}

/** Solid paths = outer − holes (Clipper). */
export function solidPaths(
  shape: Shape,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): { x: number; y: number }[][] {
  void tol
  const out: { x: number; y: number }[][] = []
  for (const poly of shape.polygons) {
    out.push(...solidPolygonPaths(poly))
  }
  return out
}

export function solidPolygonPaths(poly: Polygon): { x: number; y: number }[][] {
  let paths = toPathsD(poly.outer)
  for (const h of poly.holes) {
    paths = Clipper.differenceD(paths, toPathsD(h), FillRule.NonZero)
  }
  return paths
}

export function inflatePaths(
  paths: { x: number; y: number }[][],
  delta: number,
): { x: number; y: number }[][] {
  if (!paths.length || !(Math.abs(delta) > 0)) return paths
  return Clipper.inflatePathsD(
    paths,
    delta,
    JoinType.Miter,
    EndType.Polygon,
    2,
  )
}

/**
 * Clipper minkowskiDiffD often returns a positive outer + spurious negative
 * hole for convex×convex. Minkowski sum of simply-connected solids is
 * simply-connected — keep positive outer(s) only for collision NFP solids.
 */
export function normalizeMinkowskiPaths(
  paths: { x: number; y: number }[][],
): NfpRegion[] {
  if (!paths.length) return []
  const positives = paths
    .map((p) => ({ p, a: Clipper.area(p) }))
    .filter((x) => x.a > 0)
    .sort((a, b) => b.a - a.a)
  if (!positives.length) return []

  // Union positives to a clean solid (drops artifactual holes).
  const united = Clipper.unionD(
    positives.map((x) => x.p),
    FillRule.NonZero,
  )
  const regions: NfpRegion[] = []
  // PolyTree would be better; for NonZero union of solids we get outers.
  const scored = united
    .map((p) => ({ p, a: Clipper.area(p) }))
    .sort((a, b) => Math.abs(b.a) - Math.abs(a.a))

  // Pair CW holes with previous CCW outer heuristically by containment bbox.
  let current: NfpRegion | null = null
  for (const { p, a } of scored) {
    const ring = fromPathD(p)
    if (a > 0) {
      if (current) regions.push(current)
      current = { outer: ring, holes: [] }
    } else if (current) {
      current = { outer: current.outer, holes: [...current.holes, ring] }
    }
  }
  if (current) regions.push(current)
  return regions
}

/** Orbiting shape with centroid at origin (matches Placement reference). */
export function centerAtCentroid(shape: Shape): Shape {
  const n = normalizeShape(shape)
  const c = shapeCentroid(n)
  if (!c) throw new Error(`NFP: degenerate centroid for "${shape.id}"`)
  return translateShape(n, -c.x, -c.y)
}

/**
 * Minkowski difference A ⊕ (−B) with B already referenced at origin.
 * Clipper: minkowskiDiffD(pattern=B, path=A).
 */
export function minkowskiDiffSolids(
  stationarySolid: { x: number; y: number }[][],
  orbitingAtOrigin: { x: number; y: number }[][],
): { x: number; y: number }[][] {
  const acc: { x: number; y: number }[][] = []
  for (const a of stationarySolid) {
    for (const b of orbitingAtOrigin) {
      if (a.length < 3 || b.length < 3) continue
      const part = Clipper.minkowskiDiffD(b, a, true)
      for (const p of part) acc.push(p)
    }
  }
  if (!acc.length) return []
  return Clipper.unionD(acc, FillRule.NonZero)
}

export function regionBounds(regions: readonly NfpRegion[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let any = false
  for (const r of regions) {
    for (const p of r.outer) {
      any = true
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  return any ? { minX, minY, maxX, maxY } : null
}

export function pathsToRegions(
  paths: { x: number; y: number }[][],
): NfpRegion[] {
  return normalizeMinkowskiPaths(paths)
}
