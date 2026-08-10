import {
  differenceD,
  FillRule,
  inflatePathsD,
  intersectD,
  isPositiveD,
  JoinType,
  EndType,
  minkowskiDiffD,
  unionD,
  xorD,
  areaD,
  type PathD,
  type PathsD,
} from 'clipper2-ts'
import type { Point, Polygon, MultiPolygon } from '../types'
import { solidFromRings, type Solid } from '../collide'
import { geomEps, type GeometryIssue } from '../tolerance'
import { normalizePolygon } from '../normalize'
import { signedArea } from '../ops'
import {
  blfProfileRecordClipper,
  isBlfProfiling,
  type ClipperOp,
} from '../debug/blfProfiler'

function timedClipper<T>(op: ClipperOp, fn: () => T): T {
  if (!isBlfProfiling()) return fn()
  const t0 = performance.now()
  try {
    return fn()
  } finally {
    blfProfileRecordClipper(op, performance.now() - t0)
  }
}

export function ringToPathD(points: Point[]): PathD {
  return points.map((p) => ({ x: p.x, y: p.y }))
}

export function pathDToRing(path: PathD): Point[] {
  return path.map((p) => ({ x: p.x, y: p.y }))
}

function ensurePositive(path: PathD): PathD {
  return isPositiveD(path) ? path : [...path].reverse()
}

function ensureNegative(path: PathD): PathD {
  return isPositiveD(path) ? [...path].reverse() : path
}

export function solidToPathsD(solid: Solid): PathsD {
  const paths: PathsD = []
  if (solid.outer.points.length >= 3) {
    paths.push(ensurePositive(ringToPathD(solid.outer.points)))
  }
  for (const h of solid.holes) {
    if (h.points.length < 3) continue
    paths.push(ensureNegative(ringToPathD(h.points)))
  }
  return paths
}

export function pathsDToMultiPolygons(paths: PathsD): MultiPolygon[] {
  const outers: Polygon[] = []
  const holes: Polygon[] = []
  for (const path of paths) {
    if (path.length < 3) continue
    const ring = pathDToRing(path)
    const area = signedArea(ring)
    if (Math.abs(area) <= geomEps() * geomEps()) continue
    if (isPositiveD(path) || area > 0) {
      const n = normalizePolygon(ring, true)
      if (n.ok) outers.push(n.polygon)
    } else {
      const n = normalizePolygon(ring, false)
      if (n.ok) holes.push(n.polygon)
    }
  }

  if (!outers.length) return []

  const result: MultiPolygon[] = outers.map((outer) => ({
    outer,
    holes: [] as Polygon[],
  }))

  for (const hole of holes) {
    const c = centroidOf(hole.points)
    let assigned = false
    for (const mp of result) {
      if (pointInRing(c, mp.outer.points)) {
        mp.holes.push(hole)
        assigned = true
        break
      }
    }
    if (!assigned && result[0]) result[0].holes.push(hole)
  }
  return result
}

function centroidOf(pts: Point[]): Point {
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p.x
    y += p.y
  }
  const n = pts.length || 1
  return { x: x / n, y: y / n }
}

function pointInRing(p: Point, ring: Point[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i]!
    const pj = ring[j]!
    const inter =
      pi.y > p.y !== pj.y > p.y &&
      p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y + 1e-30) + pi.x
    if (inter) inside = !inside
  }
  return inside
}

export function multiPolygonToSolid(mp: MultiPolygon): Solid {
  return solidFromRings(
    mp.outer.points,
    mp.holes.map((h) => h.points),
  )
}

export function clipperUnion(a: PathsD, b: PathsD): PathsD {
  return timedClipper('union', () => unionD(a, b, FillRule.NonZero))
}

export function clipperDifference(a: PathsD, b: PathsD): PathsD {
  return timedClipper('difference', () => differenceD(a, b, FillRule.NonZero))
}

export function clipperIntersect(a: PathsD, b: PathsD): PathsD {
  return timedClipper('intersect', () => intersectD(a, b, FillRule.NonZero))
}

export function clipperXor(a: PathsD, b: PathsD): PathsD {
  return timedClipper('xor', () => xorD(a, b, FillRule.NonZero))
}

export function clipperInflate(
  paths: PathsD,
  delta: number,
): { paths: PathsD; issues: GeometryIssue[] } {
  return timedClipper('offset', () => {
    const issues: GeometryIssue[] = []
    try {
      // Round+default arcTol=0 densified corners (Demo 110→241) and made
      // minkowskiDiffD O(n·m) dominate BLF. Miter keeps vertex count ≈ input
      // (110→~108) and is ≥ Round at convex corners (miter flares), so spacing
      // envelope stays conservative; final collide still enforces spacingMm.
      const precision = 2
      const out = inflatePathsD(
        paths,
        delta,
        JoinType.Miter,
        EndType.Polygon,
        4,
        precision,
      )
      return { paths: out, issues }
    } catch (err) {
      issues.push({
        code: 'offset_failed',
        message: err instanceof Error ? err.message : 'inflatePathsD failed',
      })
      return { paths: [], issues }
    }
  })
}

/**
 * NFP forbidden region for moving B vs stationary A:
 * A ⊕ (−B) = Clipper minkowskiDiffD(pattern=B, path=A).
 *
 * Clipper builds |A|×|B| quads then unions them — vertex count dominates cost.
 * Pre-simplify rings within a tight Hausdorff budget before Minkowski.
 */
export function clipperMinkowskiDiffNfp(
  stationary: Point[],
  moving: Point[],
): { paths: PathsD; issues: GeometryIssue[] } {
  return timedClipper('minkowski', () => {
    const issues: GeometryIssue[] = []
    try {
      const pathA = ensurePositive(ringToPathD(simplifyRingForMinkowski(stationary)))
      const patternB = ensurePositive(ringToPathD(simplifyRingForMinkowski(moving)))
      const paths = minkowskiDiffD(patternB, pathA, true)
      return { paths, issues }
    } catch (err) {
      issues.push({
        code: 'nfp_failed',
        message: err instanceof Error ? err.message : 'minkowskiDiffD failed',
      })
      return { paths: [], issues }
    }
  })
}

/** Max Hausdorff error (mm) for Minkowski input simplification. ≪ typical spacing (5mm). */
const MINKOWSKI_SIMPLIFY_EPS_MM = 0.5
const MINKOWSKI_SIMPLIFY_MIN_VERTS = 32

function distPointToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 <= geomEps() * geomEps()) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function rdpMark(
  pts: Point[],
  i0: number,
  i1: number,
  eps: number,
  keep: Uint8Array,
): void {
  if (i1 <= i0 + 1) return
  const a = pts[i0]!
  const b = pts[i1 % pts.length]!
  let maxD = 0
  let maxI = -1
  for (let i = i0 + 1; i < i1; i++) {
    const d = distPointToSeg(pts[i]!, a, b)
    if (d > maxD) {
      maxD = d
      maxI = i
    }
  }
  if (maxD > eps && maxI >= 0) {
    keep[maxI] = 1
    rdpMark(pts, i0, maxI, eps, keep)
    rdpMark(pts, maxI, i1, eps, keep)
  }
}

/** Closed-ring RDP + collinear strip. No-op for small rings. */
export function simplifyRingForMinkowski(
  points: Point[],
  epsMm = MINKOWSKI_SIMPLIFY_EPS_MM,
): Point[] {
  const stripped = stripCollinearExact(points)
  if (stripped.length <= MINKOWSKI_SIMPLIFY_MIN_VERTS) return stripped

  const n = stripped.length
  const keep = new Uint8Array(n)
  keep[0] = 1
  let maxI = 1
  let maxD = 0
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(stripped[i]!.x - stripped[0]!.x, stripped[i]!.y - stripped[0]!.y)
    if (d > maxD) {
      maxD = d
      maxI = i
    }
  }
  keep[maxI] = 1
  rdpMark(stripped, 0, maxI, epsMm, keep)
  // second chain maxI → n → 0
  const wrap: Point[] = []
  for (let i = maxI; i < n; i++) wrap.push(stripped[i]!)
  wrap.push(stripped[0]!)
  const keepWrap = new Uint8Array(wrap.length)
  keepWrap[0] = 1
  keepWrap[wrap.length - 1] = 1
  rdpMark(wrap, 0, wrap.length - 1, epsMm, keepWrap)
  for (let i = 1; i < wrap.length - 1; i++) {
    if (keepWrap[i]) keep[(maxI + i) % n] = 1
  }

  const out: Point[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(stripped[i]!)
  const cleaned = stripCollinearExact(out)
  return cleaned.length >= 3 ? cleaned : stripped
}

/** Drop exact/near-exact collinear vertices; ring geometry unchanged within geomEps. */
function stripCollinearExact(points: Point[]): Point[] {
  const n = points.length
  if (n < 3) return points
  const eps = geomEps()
  const out: Point[] = []
  for (let i = 0; i < n; i++) {
    const a = points[(i - 1 + n) % n]!
    const b = points[i]!
    const c = points[(i + 1) % n]!
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    const ab = Math.hypot(b.x - a.x, b.y - a.y)
    const bc = Math.hypot(c.x - b.x, c.y - b.y)
    if (ab <= eps || bc <= eps) continue
    if (Math.abs(cross) <= eps * Math.max(ab, bc, 1)) continue
    out.push(b)
  }
  return out.length >= 3 ? out : points
}

export function pathsArea(paths: PathsD): number {
  let a = 0
  for (const p of paths) a += areaD(p)
  return a
}

export type { PathD, PathsD }
