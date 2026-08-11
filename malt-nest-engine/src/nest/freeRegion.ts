import { Clipper, FillRule } from 'clipper2-ts'
import { makeShape, pointOnSegment, shapeBounds } from '../geometry'
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
  if (
    Math.abs(maxX - minX) > tolerance.abs ||
    Math.abs(maxY - minY) > tolerance.abs
  ) {
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

type BoundarySegment = {
  a: Point
  b: Point
  source: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function boundarySegments(nfp: NfpResult, source: number): BoundarySegment[] {
  const segments: BoundarySegment[] = []
  for (const segment of nfp.contactSegments ?? []) {
    segments.push({
      a: segment.a,
      b: segment.b,
      source,
      minX: Math.min(segment.a.x, segment.b.x),
      minY: Math.min(segment.a.y, segment.b.y),
      maxX: Math.max(segment.a.x, segment.b.x),
      maxY: Math.max(segment.a.y, segment.b.y),
    })
  }
  for (const region of nfp.regions) {
    for (const ring of [region.outer, ...region.holes]) {
      for (let index = 0; index < ring.length; index++) {
        const a = ring[index]!
        const b = ring[(index + 1) % ring.length]!
        segments.push({
          a,
          b,
          source,
          minX: Math.min(a.x, b.x),
          minY: Math.min(a.y, b.y),
          maxX: Math.max(a.x, b.x),
          maxY: Math.max(a.y, b.y),
        })
      }
    }
  }
  return segments
}

function segmentIntersections(
  first: BoundarySegment,
  second: BoundarySegment,
  tolerance: GeometryTolerance,
): Point[] {
  const rx = first.b.x - first.a.x
  const ry = first.b.y - first.a.y
  const sx = second.b.x - second.a.x
  const sy = second.b.y - second.a.y
  const firstLength = Math.hypot(rx, ry)
  const secondLength = Math.hypot(sx, sy)
  if (
    firstLength <= Math.sqrt(tolerance.edgeMinLen2) ||
    secondLength <= Math.sqrt(tolerance.edgeMinLen2)
  ) {
    return []
  }
  const denominator = rx * sy - ry * sx
  const parallelTolerance =
    tolerance.abs * Math.max(firstLength, secondLength) +
    tolerance.rel * firstLength * secondLength
  if (Math.abs(denominator) > parallelTolerance) {
    const qpx = second.a.x - first.a.x
    const qpy = second.a.y - first.a.y
    const t = (qpx * sy - qpy * sx) / denominator
    const u = (qpx * ry - qpy * rx) / denominator
    const firstParameterTolerance = tolerance.abs / firstLength
    const secondParameterTolerance = tolerance.abs / secondLength
    if (
      t < -firstParameterTolerance ||
      t > 1 + firstParameterTolerance ||
      u < -secondParameterTolerance ||
      u > 1 + secondParameterTolerance
    ) {
      return []
    }
    return [{ x: first.a.x + t * rx, y: first.a.y + t * ry }]
  }

  const endpoints = [first.a, first.b, second.a, second.b].filter(
    (point) =>
      pointOnSegment(point, first.a, first.b, tolerance) &&
      pointOnSegment(point, second.a, second.b, tolerance),
  )
  if (!endpoints.length) return []
  endpoints.sort((a, b) =>
    Math.abs(rx) >= Math.abs(ry) ? a.x - b.x : a.y - b.y,
  )
  const start = endpoints[0]!
  const end = endpoints[endpoints.length - 1]!
  return [
    start,
    end,
    { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
  ]
}

/**
 * Boolean difference cannot retain a point/line remainder. Sweep boundaries
 * from different NFPs and return their exact intersections for final
 * placement validation.
 */
export function collectNfpBoundaryIntersections(
  ifp: NfpResult,
  forbidden: readonly NfpResult[],
  tolerance: GeometryTolerance = DEFAULT_TOLERANCE,
): Point[] {
  const segments = [
    ...boundarySegments(ifp, 0),
    ...forbidden.flatMap((nfp, index) => boundarySegments(nfp, index + 1)),
  ].sort((a, b) => a.minX - b.minX || a.minY - b.minY)
  const active: BoundarySegment[] = []
  const points: Point[] = []
  const seen = new Set<string>()
  const push = (point: Point) => {
    const key = `${point.x},${point.y}`
    if (seen.has(key)) return
    seen.add(key)
    points.push(point)
  }

  for (const segment of segments) {
    for (let index = active.length - 1; index >= 0; index--) {
      if (active[index]!.maxX < segment.minX - tolerance.abs) {
        active.splice(index, 1)
      }
    }
    for (const other of active) {
      if (other.source === segment.source) continue
      if (
        other.maxY < segment.minY - tolerance.abs ||
        segment.maxY < other.minY - tolerance.abs
      ) {
        continue
      }
      for (const point of segmentIntersections(other, segment, tolerance)) {
        push(point)
      }
    }
    active.push(segment)
  }
  return points.sort((a, b) => a.y - b.y || a.x - b.x)
}

function roundKey(n: number): string {
  return String(Object.is(n, -0) ? 0 : n)
}
