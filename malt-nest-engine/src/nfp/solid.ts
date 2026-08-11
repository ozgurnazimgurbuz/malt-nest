import { Clipper, ClipType, FillRule, JoinType, EndType } from 'clipper2-ts'
import type { Polygon, Ring, Shape } from '../geometry/types'
import {
  clipperPrecision,
  DEFAULT_TOLERANCE,
  type GeometryTolerance,
} from '../geometry/tolerance'
import {
  normalizeShape,
  pointInRing,
  pointOnSegment,
  ringCentroid,
  shapeCentroid,
  translateShape,
} from '../geometry'
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
  const out: { x: number; y: number }[][] = []
  for (const poly of shape.polygons) {
    out.push(...solidPolygonPaths(poly, tol))
  }
  return out
}

export function solidPolygonPaths(
  poly: Polygon,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): { x: number; y: number }[][] {
  let paths = toPathsD(poly.outer)
  for (const h of poly.holes) {
    paths = Clipper.differenceD(
      paths,
      toPathsD(h),
      FillRule.NonZero,
      clipperPrecision(tol),
    )
  }
  return paths
}

export function inflatePaths(
  paths: { x: number; y: number }[][],
  delta: number,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): { x: number; y: number }[][] {
  if (!paths.length || !(Math.abs(delta) > 0)) return paths
  return Clipper.inflatePathsD(
    paths,
    delta,
    JoinType.Round,
    EndType.Polygon,
    2,
    clipperPrecision(tol),
  )
}

/**
 * Convert flat Clipper paths to regions by assigning each CW hole to the
 * smallest CCW outer that contains it. This handles multiple disjoint outers
 * without depending on Clipper's output order.
 */
export function normalizeMinkowskiPaths(
  paths: { x: number; y: number }[][],
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): NfpRegion[] {
  if (!paths.length) return []
  const contours = paths
    .map((p) => ({ p, a: Clipper.area(p) }))
    .filter((entry) => Math.abs(entry.a) > tol.abs)
    .sort((a, b) => Math.abs(b.a) - Math.abs(a.a))
  const outers = contours.filter((entry) => entry.a > 0)
  if (!outers.length) return []

  const regions: { outer: Ring; holes: Ring[]; area: number }[] = outers.map(
    ({ p, a }) => ({ outer: fromPathD(p), holes: [], area: a }),
  )
  for (const { p } of contours.filter((entry) => entry.a < 0)) {
    const hole = fromPathD(p)
    const probe = interiorPoint(hole, tol) ?? hole[0]
    if (!probe) continue
    let owner: (typeof regions)[number] | null = null
    for (const region of regions) {
      if (!pointInRing(probe, region.outer, tol)) continue
      if (!owner || region.area < owner.area) owner = region
    }
    if (owner) owner.holes.push(hole)
  }
  return regions.map(({ outer, holes }) => ({ outer, holes }))
}

/** A point strictly inside a simple ring, used to classify NFP hole contours. */
export function interiorPoint(
  ring: Ring,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): { x: number; y: number } | null {
  const centroid = ringCentroid(ring, tol)
  if (
    centroid &&
    pointInRing(centroid, ring, tol) &&
    !pointOnRingBoundary(centroid, ring, tol)
  ) {
    return centroid
  }

  const ys = [...new Set(ring.map((point) => point.y))].sort((a, b) => a - b)
  for (let index = 0; index + 1 < ys.length; index++) {
    const y = (ys[index]! + ys[index + 1]!) / 2
    const xs: number[] = []
    for (let edge = 0; edge < ring.length; edge++) {
      const a = ring[edge]!
      const b = ring[(edge + 1) % ring.length]!
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
      }
    }
    xs.sort((a, b) => a - b)
    for (let pair = 0; pair + 1 < xs.length; pair += 2) {
      if (xs[pair + 1]! - xs[pair]! <= tol.abs) continue
      return { x: (xs[pair]! + xs[pair + 1]!) / 2, y }
    }
  }
  return null
}

function pointOnRingBoundary(
  point: { x: number; y: number },
  ring: Ring,
  tolerance: GeometryTolerance,
): boolean {
  for (let index = 0; index < ring.length; index++) {
    if (
      pointOnSegment(
        point,
        ring[index]!,
        ring[(index + 1) % ring.length]!,
        tolerance,
      )
    ) {
      return true
    }
  }
  return false
}

/**
 * Clipper's Minkowski output can contain negative contours that are either
 * real concavity pockets or artifacts inside a colliding solid. Retain a hole
 * only when an interior pose has zero material intersection.
 */
export function retainFreeMinkowskiHoles(
  regions: readonly NfpRegion[],
  stationarySolid: { x: number; y: number }[][],
  orbitingAtOrigin: { x: number; y: number }[][],
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): NfpRegion[] {
  return regions.map((region) => ({
    outer: region.outer,
    holes: region.holes.filter((hole) => {
      const probe = interiorPoint(hole, tol)
      if (!probe) return false
      return !poseHasMaterialOverlap(
        stationarySolid,
        orbitingAtOrigin,
        probe,
        tol,
      )
    }),
  }))
}

export function poseHasMaterialOverlap(
  stationarySolid: { x: number; y: number }[][],
  orbitingAtOrigin: { x: number; y: number }[][],
  position: { x: number; y: number },
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  const moved = orbitingAtOrigin.map((path) =>
    path.map((point) => ({
      x: point.x + position.x,
      y: point.y + position.y,
    })),
  )
  const overlap = Clipper.intersectD(
    stationarySolid,
    moved,
    FillRule.NonZero,
    clipperPrecision(tol),
  )
  return Math.abs(Clipper.areaPathsD(overlap)) > tol.abs
}

/** Orbiting shape with centroid at origin (matches Placement reference). */
export function centerAtCentroid(
  shape: Shape,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): Shape {
  const n = normalizeShape(shape, tol)
  const c = shapeCentroid(n, tol)
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
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
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
  return Clipper.booleanOpD(
    ClipType.Union,
    acc,
    null,
    FillRule.NonZero,
    clipperPrecision(tol),
  )
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
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): NfpRegion[] {
  return normalizeMinkowskiPaths(paths, tol)
}
