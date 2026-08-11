import { Clipper, FillRule } from 'clipper2-ts'
import { makeShape, shapeBounds } from '../geometry'
import type { Point, Shape } from '../geometry/types'
import {
  clipperPrecision,
  DEFAULT_TOLERANCE,
  type GeometryTolerance,
} from '../geometry/tolerance'
import type { NfpRegion, NfpResult } from '../nfp'
import { pathsToRegions, toPathsD } from '../nfp/solid'
import type { Sheet } from '../placement'
import { usableRegion } from '../placement'

/** Usable sheet rectangle as a container Shape for Inner NFP. */
export function sheetContainerShape(sheet: Sheet): Shape {
  const u = usableRegion(sheet)
  return makeShape('__sheet__', [
    { x: u.minX, y: u.minY },
    { x: u.maxX, y: u.minY },
    { x: u.maxX, y: u.maxY },
    { x: u.minX, y: u.maxY },
  ])
}

/**
 * Analytical AABB Inner-Fit corners for orbiting (centroid at origin).
 * Handles exact-fit (zero-area IFP) that Clipper drops.
 */
export function sheetAabbFitCandidates(
  orbitingAtOrigin: Shape,
  sheet: Sheet,
  tolerance: GeometryTolerance = DEFAULT_TOLERANCE,
): Point[] {
  const b = shapeBounds(orbitingAtOrigin)
  if (!b) return []
  const u = usableRegion(sheet)
  const minX = u.minX - b.minX
  const maxX = u.maxX - b.maxX
  const minY = u.minY - b.minY
  const maxY = u.maxY - b.maxY
  if (maxX < minX - tolerance.abs || maxY < minY - tolerance.abs) return []
  const pts: Point[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: minX, y: maxY },
    { x: maxX, y: maxY },
  ]
  if (Math.abs(maxX - minX) > 1e-12 || Math.abs(maxY - minY) > 1e-12) {
    pts.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 })
  }
  pts.sort((a, c) => (a.y !== c.y ? a.y - c.y : a.x - c.x))
  return pts
}

/** Clipper solid paths for an NFP region (outer − holes). */
export function regionSolidPaths(
  region: NfpRegion,
  tolerance: GeometryTolerance = DEFAULT_TOLERANCE,
): { x: number; y: number }[][] {
  let paths = toPathsD(region.outer)
  for (const h of region.holes) {
    paths = Clipper.differenceD(
      paths,
      toPathsD(h),
      FillRule.NonZero,
      clipperPrecision(tolerance),
    )
  }
  return paths
}

export function nfpSolidPaths(
  nfp: NfpResult,
  tolerance: GeometryTolerance = DEFAULT_TOLERANCE,
): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = []
  for (const r of nfp.regions) out.push(...regionSolidPaths(r, tolerance))
  return out
}

/**
 * Free region = InnerFit(sheet) \\ ∪ OuterNFP(placed_i).
 * Returns polygon regions where orbiting centroid may lie (before final validate).
 */
export function computeFreeRegions(
  ifp: NfpResult,
  forbidden: readonly NfpResult[],
  tolerance: GeometryTolerance = DEFAULT_TOLERANCE,
): NfpRegion[] {
  let paths = nfpSolidPaths(ifp, tolerance)
  if (!paths.length) return []

  for (const nfp of forbidden) {
    const solid = nfpSolidPaths(nfp, tolerance)
    if (!solid.length) continue
    paths = Clipper.differenceD(
      paths,
      solid,
      FillRule.NonZero,
      clipperPrecision(tolerance),
    )
    if (!paths.length) return []
  }

  return pathsToRegions(paths, tolerance)
}

/** Collect candidate reference points from free-region geometry. */
export function collectCandidatesFromRegions(
  regions: readonly NfpRegion[],
): Point[] {
  const out: Point[] = []
  const seen = new Set<string>()

  const push = (p: Point) => {
    const k = `${roundKey(p.x)},${roundKey(p.y)}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ x: p.x, y: p.y })
  }

  for (const r of regions) {
    for (const ring of [r.outer, ...r.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!
        const b = ring[(i + 1) % ring.length]!
        push(a)
        // Edge midpoint — denser contact without AABB grid
        push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      }
    }
  }

  // Bottom-left preference encoded in sort
  out.sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y
    if (a.x !== b.x) return a.x - b.x
    return 0
  })
  return out
}

function roundKey(n: number): string {
  return String(Object.is(n, -0) ? 0 : n)
}
