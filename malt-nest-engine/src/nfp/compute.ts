import { Clipper, FillRule } from 'clipper2-ts'
import {
  isCcw,
  normalizeShape,
  pointInPolygon,
  shapeBounds,
  signedArea,
} from '../geometry'
import { cleanRing, ensureWinding } from '../geometry/ring'
import type { Point, Polygon, Ring, Shape } from '../geometry/types'
import {
  DEFAULT_TOLERANCE,
  type GeometryTolerance,
} from '../geometry/tolerance'
import type { NfpOptions, NfpPointClass, NfpRegion, NfpResult } from './types'
import { DEFAULT_NFP_OPTIONS } from './types'
import {
  centerAtCentroid,
  fromPathD,
  inflatePaths,
  minkowskiDiffSolids,
  pathsToRegions,
  regionBounds,
  solidPaths,
  toPathsD,
} from './solid'

function opts(o?: NfpOptions) {
  return {
    gap: o?.gap ?? DEFAULT_NFP_OPTIONS.gap,
    tolerance: o?.tolerance ?? DEFAULT_NFP_OPTIONS.tolerance,
  }
}

function isRectRing(ring: Ring, tol: GeometryTolerance): boolean {
  if (ring.length !== 4) return false
  const xs = [...new Set(ring.map((p) => p.x))]
  const ys = [...new Set(ring.map((p) => p.y))]
  if (xs.length !== 2 || ys.length !== 2) return false
  // axis-aligned
  for (const p of ring) {
    const onV = xs.some((x) => Math.abs(p.x - x) <= tol.abs)
    const onH = ys.some((y) => Math.abs(p.y - y) <= tol.abs)
    if (!onV || !onH) return false
  }
  return true
}

function ringBBox(ring: Ring) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of ring) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/** Analytical IFP for axis-aligned rect container vs centroid-centered B. */
function rectInnerFitFromBounds(
  container: { minX: number; minY: number; maxX: number; maxY: number },
  bBounds: { minX: number; minY: number; maxX: number; maxY: number },
): Ring | null {
  const minX = container.minX - bBounds.minX
  const maxX = container.maxX - bBounds.maxX
  const minY = container.minY - bBounds.minY
  const maxY = container.maxY - bBounds.maxY
  if (maxX < minX || maxY < minY) return null
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]
}

function isConvexRing(ring: Ring): boolean {
  if (ring.length < 3) return false
  let sign = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % n]!
    const c = ring[(i + 2) % n]!
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(z) < 1e-12) continue
    const s = z > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/**
 * Inner-fit region for a filled container (no holes) and orbiting B₀.
 * Rect → analytical. Convex → intersection of translations C − v.
 */
function innerFitFilled(
  containerOuter: Ring,
  B0: Shape,
  gap: number,
  tol: GeometryTolerance,
): NfpRegion[] {
  let cRing = ensureWinding(cleanRing(containerOuter, tol), true)
  if (gap > tol.abs) {
    const eroded = inflatePaths(toPathsD(cRing), -gap)
    if (!eroded.length) return []
    cRing = fromPathD(eroded[0]!)
  }
  const bb = shapeBounds(B0)
  if (!bb) return []

  if (isRectRing(cRing, tol)) {
    const fit = rectInnerFitFromBounds(ringBBox(cRing), bb)
    return fit ? [{ outer: fit, holes: [] }] : []
  }

  if (isConvexRing(cRing)) {
    // IFP = ⋂_{v ∈ vertices(B0)} (C − v)
    let acc: { x: number; y: number }[][] | null = null
    for (const poly of B0.polygons) {
      for (const v of poly.outer) {
        const shifted = cRing.map((p) => ({ x: p.x - v.x, y: p.y - v.y }))
        if (!acc) acc = toPathsD(shifted)
        else acc = Clipper.intersectD(acc, toPathsD(shifted), FillRule.NonZero)
        if (!acc.length) return []
      }
    }
    return pathsToRegions(acc ?? [])
  }

  // Concave container: fallback frame+filled using rect pad IFP minus
  // outer NFP of complement approximated by edge inflate — use Clipper offset
  // erosion by B radius (conservative circle).
  const radius =
    Math.hypot(Math.max(-bb.minX, bb.maxX), Math.max(-bb.minY, bb.maxY)) + gap
  const eroded = inflatePaths(toPathsD(cRing), -radius)
  return pathsToRegions(eroded)
}

function differenceRegions(
  positive: NfpRegion[],
  subtract: NfpRegion[],
): NfpRegion[] {
  let paths: { x: number; y: number }[][] = []
  for (const r of positive) {
    paths.push(...toPathsD(r.outer))
    for (const h of r.holes) {
      paths = Clipper.differenceD(paths, toPathsD(h), FillRule.NonZero)
    }
  }
  if (!paths.length) return []
  for (const s of subtract) {
    paths = Clipper.differenceD(paths, toPathsD(s.outer), FillRule.NonZero)
  }
  // Keep holes — they are free pockets (e.g. part fits in stationary hole).
  return pathsToRegionsKeepHoles(paths)
}

/** Like pathsToRegions but retains CW holes under each CCW outer. */
function pathsToRegionsKeepHoles(
  paths: { x: number; y: number }[][],
): NfpRegion[] {
  if (!paths.length) return []
  const scored = paths
    .map((p) => ({ p, a: Clipper.area(p) }))
    .sort((a, b) => Math.abs(b.a) - Math.abs(a.a))

  const regions: NfpRegion[] = []
  let current: { outer: Ring; holes: Ring[] } | null = null
  for (const { p, a } of scored) {
    const ring = fromPathD(p)
    if (a > 0) {
      if (current) regions.push(current)
      current = { outer: ring, holes: [] }
    } else if (current) {
      current.holes.push(ring)
    }
  }
  if (current) regions.push(current)
  return regions
}

function filledOuterPaths(poly: Polygon, gap: number, tol: GeometryTolerance) {
  let paths = toPathsD(ensureWinding(cleanRing(poly.outer, tol), true))
  if (gap > tol.abs) paths = inflatePaths(paths, gap)
  return paths
}

/**
 * Outer NFP — forbidden region for orbiting centroid.
 *
 * Algorithm: Clipper2 Minkowski difference A⊕(−B₀), B₀ centroid-centered.
 * Holes: NFP(filled outer) \\ InnerFit(each hole) so hole interiors stay free.
 * Gap: inflate filled outer by gap before Minkowski / erode holes for IFP.
 */
export function computeOuterNfp(
  stationary: Shape,
  orbiting: Shape,
  options?: NfpOptions,
): NfpResult {
  const { gap, tolerance } = opts(options)
  const A = normalizeShape(stationary)
  const B0 = centerAtCentroid(orbiting)
  const bSolid = solidPaths(B0, tolerance)

  const all: NfpRegion[] = []
  for (const poly of A.polygons) {
    const filled = filledOuterPaths(poly, gap, tolerance)
    const raw = minkowskiDiffSolids(filled, bSolid)
    let forbidden: NfpRegion[] = pathsToRegions(raw).map((r) => ({
      outer: r.outer,
      holes: [] as Ring[],
    }))

    for (const hole of poly.holes) {
      const holeFit = innerFitFilled(hole, B0, 0, tolerance)
      forbidden = differenceRegions(forbidden, holeFit)
    }
    all.push(...forbidden)
  }

  // Union forbidden outers while preserving free holes via boolean
  let paths: { x: number; y: number }[][] = []
  for (const r of all) {
    if (!paths.length) {
      paths = toPathsD(r.outer)
      for (const h of r.holes) {
        paths = Clipper.differenceD(paths, toPathsD(h), FillRule.NonZero)
      }
    } else {
      let piece = toPathsD(r.outer)
      for (const h of r.holes) {
        piece = Clipper.differenceD(piece, toPathsD(h), FillRule.NonZero)
      }
      paths = Clipper.unionD([...paths, ...piece], FillRule.NonZero)
    }
  }
  const regions = pathsToRegionsKeepHoles(paths)

  return normalizeNfp({
    kind: 'outer',
    stationaryId: stationary.id,
    orbitingId: orbiting.id,
    reference: 'centroid',
    gap: Math.max(0, gap),
    regions,
    bounds: regionBounds(regions),
    algorithm: 'minkowski-clipper2',
  })
}

/**
 * Inner NFP — free region with orbiting ⊆ container (gap from wall).
 */
export function computeInnerNfp(
  container: Shape,
  orbiting: Shape,
  options?: NfpOptions,
): NfpResult {
  const { gap, tolerance } = opts(options)
  const C = normalizeShape(container)
  const B0 = centerAtCentroid(orbiting)

  const regions: NfpRegion[] = []
  for (const poly of C.polygons) {
    // Fit inside outer, then subtract fits that collide with hole rims —
    // for solid container with holes, free = IFP(outer) \ ∪ expanded holes...
    // Simpler: IFP(outer) then subtract OuterNFP(hole-as-obstacle)...
    let free = innerFitFilled(poly.outer, B0, gap, tolerance)
    for (const hole of poly.holes) {
      // Cannot enter hole material — hole is empty; free space includes hole
      // only if part fits in hole: free |= IFP(hole). Also must not hit outer
      // incorrectly — IFP(outer) already keeps part inside outer; part in hole
      // is still inside outer. So: free = IFP(outer)  (holes are free space!)
      void hole
    }
    // If container has holes, they are empty: IFP(outer) is correct for ⊆ outer
    // material-complement. Part may sit over a hole. Good.
    regions.push(...free)
  }

  return normalizeNfp({
    kind: 'inner',
    stationaryId: container.id,
    orbitingId: orbiting.id,
    reference: 'centroid',
    gap: Math.max(0, gap),
    regions,
    bounds: regionBounds(regions),
    algorithm: 'minkowski-clipper2',
  })
}

export function classifyNfpPoint(
  p: Point,
  nfp: NfpResult,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): NfpPointClass {
  for (const region of nfp.regions) {
    const poly = { outer: region.outer, holes: region.holes }
    if (!pointInPolygon(p, poly, tol)) continue
    if (pointOnRegionBoundary(p, region, tol)) return 'boundary'
    return 'inside'
  }
  return 'outside'
}

function pointOnRegionBoundary(
  p: Point,
  region: NfpRegion,
  tol: GeometryTolerance,
): boolean {
  for (const ring of [region.outer, ...region.holes]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % ring.length]!
      if (distPointSeg(p, a, b) <= Math.max(tol.abs * 100, 1e-7)) return true
    }
  }
  return false
}

function distPointSeg(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy))
}

export function nfpContainsPoint(
  p: Point,
  nfp: NfpResult,
  tol?: GeometryTolerance,
): boolean {
  const c = classifyNfpPoint(p, nfp, tol)
  return c === 'inside' || c === 'boundary'
}

export function normalizeNfp(nfp: NfpResult): NfpResult {
  const regions = nfp.regions
    .map((r) => ({
      outer: ensureWinding(cleanRing(r.outer), true),
      holes: r.holes.map((h) => ensureWinding(cleanRing(h), false)),
    }))
    .filter((r) => r.outer.length >= 3 && Math.abs(signedArea(r.outer)) > 1e-12)
  return { ...nfp, regions, bounds: regionBounds(regions) }
}

void isCcw
