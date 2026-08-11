import { Clipper, FillRule, JoinType, EndType } from 'clipper2-ts'
import type { BoundingBox, Polygon, Ring, Shape } from '../geometry/types'
import {
  DEFAULT_TOLERANCE,
  type GeometryTolerance,
} from '../geometry/tolerance'
import type { Placement } from './types'

/** Broad-phase: AABB overlap, optionally expanded by gap. */
export function boundsOverlap(
  a: BoundingBox,
  b: BoundingBox,
  expand = 0,
): boolean {
  return !(
    a.maxX + expand < b.minX ||
    b.maxX + expand < a.minX ||
    a.maxY + expand < b.minY ||
    b.maxY + expand < a.minY
  )
}

function toPathsD(ring: Ring) {
  return [ring.map((p) => ({ x: p.x, y: p.y }))]
}

function subtractHoles(poly: Polygon) {
  let paths = toPathsD(poly.outer)
  for (const h of poly.holes) {
    paths = Clipper.differenceD(paths, toPathsD(h), FillRule.NonZero)
  }
  return paths
}

function solidPaths(shape: Shape) {
  const out: ReturnType<typeof toPathsD> = []
  for (const poly of shape.polygons) {
    out.push(...subtractHoles(poly))
  }
  return out
}

function inflateSolid(poly: Polygon, delta: number) {
  const solid = subtractHoles(poly)
  if (!solid.length || !(delta > 0)) return solid
  return Clipper.inflatePathsD(
    solid,
    delta,
    JoinType.Miter,
    EndType.Polygon,
    2,
  )
}

function solidOverlapArea(a: Shape, b: Shape): number {
  const pa = solidPaths(a)
  const pb = solidPaths(b)
  if (!pa.length || !pb.length) return 0
  const inter = Clipper.intersectD(pa, pb, FillRule.NonZero)
  return Math.abs(Clipper.areaPathsD(inter))
}

export type CollisionKind = 'none' | 'touch' | 'overlap' | 'gap-violation'

export type CollisionResult = {
  readonly kind: CollisionKind
  readonly broadHit: boolean
  readonly overlapArea: number
}

/**
 * Narrow-phase collision between two placements.
 * - gap ≈ 0: material area > 0 → overlap; else none/touch
 * - gap > 0: inflate A by gap; positive intersect with B → gap-violation
 */
export function collidePlacements(
  a: Placement,
  b: Placement,
  gap: number,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): CollisionResult {
  const g = Math.max(0, gap)
  const broadHit = boundsOverlap(a.bounds, b.bounds, g)
  if (!broadHit) {
    return { kind: 'none', broadHit: false, overlapArea: 0 }
  }

  if (g > tol.abs) {
    let violationArea = 0
    for (const pa of a.geometry.polygons) {
      const inflated = inflateSolid(pa, g)
      const solidB = solidPaths(b.geometry)
      const inter = Clipper.intersectD(inflated, solidB, FillRule.NonZero)
      violationArea += Math.abs(Clipper.areaPathsD(inter))
    }
    if (violationArea > tol.abs) {
      return {
        kind: 'gap-violation',
        broadHit: true,
        overlapArea: violationArea,
      }
    }
    return { kind: 'none', broadHit: true, overlapArea: 0 }
  }

  const ov = solidOverlapArea(a.geometry, b.geometry)
  if (ov > tol.abs) {
    return { kind: 'overlap', broadHit: true, overlapArea: ov }
  }

  // AABB hit, zero area → edge/corner touch (allowed when gap=0)
  if (boundsOverlap(a.bounds, b.bounds, tol.abs)) {
    return { kind: 'touch', broadHit: true, overlapArea: 0 }
  }
  return { kind: 'none', broadHit: true, overlapArea: 0 }
}

export function placementsCollide(
  a: Placement,
  b: Placement,
  gap: number,
  tol?: GeometryTolerance,
): boolean {
  const r = collidePlacements(a, b, gap, tol)
  return r.kind === 'overlap' || r.kind === 'gap-violation'
}

export type BBoxHit = { readonly broadHit: boolean }
