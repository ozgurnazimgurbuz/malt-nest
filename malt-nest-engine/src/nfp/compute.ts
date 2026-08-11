import { Clipper, ClipType, FillRule } from 'clipper2-ts'
import {
  isCcw,
  normalizeShape,
  pointInPolygon,
  shapeArea,
  shapeBounds,
  shapeCentroid,
  signedArea,
} from '../geometry'
import { cleanRing, ensureWinding } from '../geometry/ring'
import type { Point, Polygon, Ring, Shape } from '../geometry/types'
import {
  clipperPrecision,
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
  poseHasMaterialOverlap,
  retainFreeMinkowskiHoles,
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

function zeroMeasureCandidates(
  regions: readonly NfpRegion[],
  tolerance: GeometryTolerance,
): Point[] {
  const candidates: Point[] = []
  for (const region of regions) {
    if (Math.abs(signedArea(region.outer)) > tolerance.abs) continue
    for (let index = 0; index < region.outer.length; index++) {
      const a = region.outer[index]!
      const b = region.outer[(index + 1) % region.outer.length]!
      candidates.push(a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    }
  }
  return dedupePoints(candidates, tolerance)
}

function reflectFitRegions(
  regions: readonly NfpRegion[],
  center: Point,
): NfpRegion[] {
  const reflect = (ring: Ring) =>
    ring.map((point) => ({
      x: center.x - point.x,
      y: center.y - point.y,
    }))
  return regions.map((region) => ({
    outer: reflect(region.outer),
    holes: region.holes.map(reflect),
  }))
}

function dedupePoints(
  points: readonly Point[],
  tolerance: GeometryTolerance,
): Point[] {
  const unique: Point[] = []
  const buckets = new Map<string, Point[]>()
  const bucketSize = tolerance.abs
  for (const point of points) {
    if (bucketSize === 0) {
      const key = `${point.x},${point.y}`
      if (buckets.has(key)) continue
      buckets.set(key, [point])
      unique.push(point)
      continue
    }

    const bucketX = Math.floor(point.x / bucketSize)
    const bucketY = Math.floor(point.y / bucketSize)
    let duplicate = false
    for (let dx = -1; dx <= 1 && !duplicate; dx++) {
      for (let dy = -1; dy <= 1 && !duplicate; dy++) {
        const nearby = buckets.get(`${bucketX + dx},${bucketY + dy}`) ?? []
        duplicate = nearby.some(
          (existing) =>
            Math.abs(existing.x - point.x) <= tolerance.abs &&
            Math.abs(existing.y - point.y) <= tolerance.abs,
        )
      }
    }
    if (duplicate) continue

    const key = `${bucketX},${bucketY}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(point)
    else buckets.set(key, [point])
    unique.push(point)
  }
  return unique
}

function boundsIncludingContacts(
  regions: readonly NfpRegion[],
  contactPoints: readonly Point[],
) {
  const bounds = regionBounds(regions)
  if (!contactPoints.length) return bounds
  let minX = bounds?.minX ?? Infinity
  let minY = bounds?.minY ?? Infinity
  let maxX = bounds?.maxX ?? -Infinity
  let maxY = bounds?.maxY ?? -Infinity
  for (const point of contactPoints) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return { minX, minY, maxX, maxY }
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
    const eroded = inflatePaths(toPathsD(cRing), -gap, tol)
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
        else {
          acc = Clipper.intersectD(
            acc,
            toPathsD(shifted),
            FillRule.NonZero,
            clipperPrecision(tol),
          )
        }
        if (!acc.length) return []
      }
    }
    return pathsToRegions(acc ?? [], tol)
  }

  // Concave container: fallback frame+filled using rect pad IFP minus
  // outer NFP of complement approximated by edge inflate — use Clipper offset
  // erosion by B radius (conservative circle).
  const radius = Math.hypot(
    Math.max(-bb.minX, bb.maxX),
    Math.max(-bb.minY, bb.maxY),
  )
  const eroded = inflatePaths(toPathsD(cRing), -radius, tol)
  return pathsToRegions(eroded, tol)
}

const MAX_INNER_CONTACT_CONTAINER_ANCHORS = 256
const MAX_INNER_CONTACT_ORBITING_ANCHORS = 16

function selectBoundaryAnchors(
  paths: readonly (readonly { x: number; y: number }[])[],
  maxAnchors: number,
  tolerance: GeometryTolerance,
): Point[] {
  const all = dedupePoints(paths.flat(), tolerance)
  if (all.length <= maxAnchors) return all

  const selected: Point[] = []
  const selectedIndices = new Set<number>()
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 },
  ]
  for (const direction of directions) {
    let best = 0
    for (let index = 1; index < all.length; index++) {
      const score = all[index]!.x * direction.x + all[index]!.y * direction.y
      const bestScore = all[best]!.x * direction.x + all[best]!.y * direction.y
      if (score > bestScore) best = index
    }
    selectedIndices.add(best)
  }

  for (let sample = 0; sample < maxAnchors; sample++) {
    selectedIndices.add(Math.floor((sample * all.length) / maxAnchors))
  }
  for (let index = 0; selectedIndices.size < maxAnchors; index++) {
    selectedIndices.add(index)
  }
  for (const index of selectedIndices) selected.push(all[index]!)
  return selected.slice(0, maxAnchors)
}

/**
 * Recover boundary-only convex fits and concave-container poses omitted by the
 * conservative circular erosion. Work is capped before forming candidate
 * pairs; every returned point is revalidated against permitted container area.
 */
function innerFitBoundaryContacts(
  containerOuter: Ring,
  orbitingAtOrigin: Shape,
  gap: number,
  tolerance: GeometryTolerance,
  represented: readonly NfpRegion[],
): Point[] {
  let permitted = toPathsD(
    ensureWinding(cleanRing(containerOuter, tolerance), true),
  )
  if (gap > tolerance.abs) {
    permitted = inflatePaths(permitted, -gap, tolerance)
  }
  if (!permitted.length) return []

  const orbitingSolid = solidPaths(orbitingAtOrigin, tolerance)
  if (
    Math.abs(Clipper.areaPathsD(orbitingSolid)) >
    Math.abs(Clipper.areaPathsD(permitted)) + tolerance.abs
  ) {
    return []
  }

  const containerAnchors = selectBoundaryAnchors(
    permitted,
    MAX_INNER_CONTACT_CONTAINER_ANCHORS,
    tolerance,
  )
  const orbitingAnchors = selectBoundaryAnchors(
    orbitingAtOrigin.polygons.map((polygon) => polygon.outer),
    MAX_INNER_CONTACT_ORBITING_ANCHORS,
    tolerance,
  )
  const orbitingBounds = shapeBounds(orbitingAtOrigin)
  if (!containerAnchors.length || !orbitingAnchors.length || !orbitingBounds) {
    return []
  }

  const permittedBounds = ringBBox(permitted.flat())
  const candidates: Point[] = []
  for (const containerAnchor of containerAnchors) {
    for (const orbitingAnchor of orbitingAnchors) {
      const point = {
        x: containerAnchor.x - orbitingAnchor.x,
        y: containerAnchor.y - orbitingAnchor.y,
      }
      if (
        point.x + orbitingBounds.minX < permittedBounds.minX - tolerance.abs ||
        point.x + orbitingBounds.maxX > permittedBounds.maxX + tolerance.abs ||
        point.y + orbitingBounds.minY < permittedBounds.minY - tolerance.abs ||
        point.y + orbitingBounds.maxY > permittedBounds.maxY + tolerance.abs ||
        represented.some((region) =>
          pointInPolygon(
            point,
            { outer: region.outer, holes: region.holes },
            tolerance,
          ),
        )
      ) {
        continue
      }

      const moved = orbitingSolid.map((path) =>
        path.map((vertex) => ({
          x: vertex.x + point.x,
          y: vertex.y + point.y,
        })),
      )
      const outside = Clipper.differenceD(
        moved,
        permitted,
        FillRule.NonZero,
        clipperPrecision(tolerance),
      )
      if (Math.abs(Clipper.areaPathsD(outside)) <= tolerance.abs) {
        candidates.push(point)
      }
    }
  }
  return dedupePoints(candidates, tolerance)
}

function differenceRegions(
  positive: NfpRegion[],
  subtract: NfpRegion[],
  tolerance: GeometryTolerance,
): NfpRegion[] {
  let paths: { x: number; y: number }[][] = []
  for (const r of positive) {
    paths.push(...toPathsD(r.outer))
    for (const h of r.holes) {
      paths = Clipper.differenceD(
        paths,
        toPathsD(h),
        FillRule.NonZero,
        clipperPrecision(tolerance),
      )
    }
  }
  if (!paths.length) return []
  for (const s of subtract) {
    let solid = toPathsD(s.outer)
    for (const hole of s.holes) {
      solid = Clipper.differenceD(
        solid,
        toPathsD(hole),
        FillRule.NonZero,
        clipperPrecision(tolerance),
      )
    }
    paths = Clipper.differenceD(
      paths,
      solid,
      FillRule.NonZero,
      clipperPrecision(tolerance),
    )
  }
  // Keep holes — they are free pockets (e.g. part fits in stationary hole).
  return pathsToRegions(paths, tolerance)
}

function filledOuterPaths(poly: Polygon, gap: number, tol: GeometryTolerance) {
  let paths = toPathsD(ensureWinding(cleanRing(poly.outer, tol), true))
  if (gap > tol.abs) paths = inflatePaths(paths, gap, tol)
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
  const A = normalizeShape(stationary, tolerance)
  const B0 = centerAtCentroid(orbiting, tolerance)
  const bSolid = solidPaths(B0, tolerance)

  const all: NfpRegion[] = []
  const contactPoints: Point[] = []
  for (const poly of A.polygons) {
    const filled = filledOuterPaths(poly, gap, tolerance)
    const raw = minkowskiDiffSolids(filled, bSolid, tolerance)
    let forbidden: NfpRegion[] = retainFreeMinkowskiHoles(
      pathsToRegions(raw, tolerance),
      filled,
      bSolid,
      tolerance,
    ).map((r) => ({
      outer: r.outer,
      holes: r.holes,
    }))

    for (const hole of poly.holes) {
      const holeFit = innerFitFilled(hole, B0, gap, tolerance)
      contactPoints.push(...zeroMeasureCandidates(holeFit, tolerance))
      if (
        (holeFit.length === 0 || !isConvexRing(hole)) &&
        shapeArea(B0) <= Math.abs(signedArea(hole)) + tolerance.abs
      ) {
        contactPoints.push(
          ...innerFitBoundaryContacts(hole, B0, gap, tolerance, holeFit),
        )
      }
      forbidden = differenceRegions(forbidden, holeFit, tolerance)
    }
    all.push(...forbidden)
  }

  // Union forbidden outers while preserving free holes via boolean
  let paths: { x: number; y: number }[][] = []
  for (const r of all) {
    if (!paths.length) {
      paths = toPathsD(r.outer)
      for (const h of r.holes) {
        paths = Clipper.differenceD(
          paths,
          toPathsD(h),
          FillRule.NonZero,
          clipperPrecision(tolerance),
        )
      }
    } else {
      let piece = toPathsD(r.outer)
      for (const h of r.holes) {
        piece = Clipper.differenceD(
          piece,
          toPathsD(h),
          FillRule.NonZero,
          clipperPrecision(tolerance),
        )
      }
      paths = Clipper.booleanOpD(
        ClipType.Union,
        [...paths, ...piece],
        null,
        FillRule.NonZero,
        clipperPrecision(tolerance),
      )
    }
  }
  let regions = pathsToRegions(paths, tolerance)

  // Symmetric hole case: the stationary solid can sit wholly inside a hole of
  // the orbiting part. Convert the stationary-centroid IFP into orbiting-
  // centroid coordinates and subtract those collision-free pockets.
  const stationaryCentroid = shapeCentroid(A, tolerance)
  if (stationaryCentroid) {
    const A0 = centerAtCentroid(A, tolerance)
    const orbitingHoleFits: NfpRegion[] = []
    for (const polygon of B0.polygons) {
      for (const hole of polygon.holes) {
        const fits = innerFitFilled(hole, A0, gap, tolerance)
        if (
          (fits.length === 0 || !isConvexRing(hole)) &&
          shapeArea(A) <= Math.abs(signedArea(hole)) + tolerance.abs
        ) {
          contactPoints.push(
            ...innerFitBoundaryContacts(hole, A0, gap, tolerance, fits).map(
              (point) => ({
                x: stationaryCentroid.x - point.x,
                y: stationaryCentroid.y - point.y,
              }),
            ),
          )
        }
        const pointFits = zeroMeasureCandidates(fits, tolerance).map(
          (point) => ({
            x: stationaryCentroid.x - point.x,
            y: stationaryCentroid.y - point.y,
          }),
        )
        contactPoints.push(...pointFits)
        orbitingHoleFits.push(
          ...reflectFitRegions(
            fits.filter(
              (fit) => Math.abs(signedArea(fit.outer)) > tolerance.abs,
            ),
            stationaryCentroid,
          ),
        )
      }
    }
    if (orbitingHoleFits.length) {
      regions = differenceRegions(regions, orbitingHoleFits, tolerance)
    }
  }

  let stationaryClearance = solidPaths(A, tolerance)
  if (gap > tolerance.abs) {
    stationaryClearance = inflatePaths(stationaryClearance, gap, tolerance)
  }
  const validContactPoints = dedupePoints(contactPoints, tolerance).filter(
    (point) =>
      !poseHasMaterialOverlap(
        stationaryClearance,
        bSolid,
        point,
        tolerance,
      ),
  )

  return normalizeNfp({
    kind: 'outer',
    stationaryId: stationary.id,
    orbitingId: orbiting.id,
    reference: 'centroid',
    gap: Math.max(0, gap),
    regions,
    contactPoints: validContactPoints.length ? validContactPoints : undefined,
    bounds: boundsIncludingContacts(regions, validContactPoints),
    algorithm: 'minkowski-clipper2',
  }, tolerance)
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
  const C = normalizeShape(container, tolerance)
  const B0 = centerAtCentroid(orbiting, tolerance)

  const regions: NfpRegion[] = []
  const contactPoints: Point[] = []
  for (const poly of C.polygons) {
    // Fit inside outer, then subtract fits that collide with hole rims —
    // for solid container with holes, free = IFP(outer) \ ∪ expanded holes...
    // Simpler: IFP(outer) then subtract OuterNFP(hole-as-obstacle)...
    let free = innerFitFilled(poly.outer, B0, gap, tolerance)
    let freeContacts = zeroMeasureCandidates(free, tolerance)
    if (free.length === 0 || !isConvexRing(poly.outer)) {
      freeContacts.push(
        ...innerFitBoundaryContacts(poly.outer, B0, gap, tolerance, free),
      )
    }
    for (let index = 0; index < poly.holes.length; index++) {
      const hole = poly.holes[index]!
      const obstacle = computeOuterNfp(
        {
          id: `${container.id}#hole-${index}`,
          polygons: [{ outer: hole, holes: [] }],
        },
        B0,
        { gap, tolerance },
      )
      free = differenceRegions(free, [...obstacle.regions], tolerance)
      freeContacts = freeContacts.filter(
        (point) => !nfpContainsPoint(point, obstacle, tolerance),
      )
    }
    contactPoints.push(...freeContacts)
    regions.push(...free)
  }

  const validContactPoints = dedupePoints(contactPoints, tolerance)

  return normalizeNfp({
    kind: 'inner',
    stationaryId: container.id,
    orbitingId: orbiting.id,
    reference: 'centroid',
    gap: Math.max(0, gap),
    regions,
    contactPoints: validContactPoints.length ? validContactPoints : undefined,
    bounds: boundsIncludingContacts(regions, validContactPoints),
    algorithm: 'minkowski-clipper2',
  }, tolerance)
}

export function classifyNfpPoint(
  p: Point,
  nfp: NfpResult,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): NfpPointClass {
  const onContact = nfp.contactPoints?.some(
    (contact) =>
      Math.abs(contact.x - p.x) <= tol.abs &&
      Math.abs(contact.y - p.y) <= tol.abs,
  )
  if (onContact) return nfp.kind === 'inner' ? 'boundary' : 'outside'
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

export function normalizeNfp(
  nfp: NfpResult,
  tolerance: GeometryTolerance = DEFAULT_TOLERANCE,
): NfpResult {
  const regions = nfp.regions
    .map((r) => ({
      outer: ensureWinding(cleanRing(r.outer, tolerance), true),
      holes: r.holes.map((h) =>
        ensureWinding(cleanRing(h, tolerance), false),
      ),
    }))
    .filter(
      (r) =>
        r.outer.length >= 3 &&
        Math.abs(signedArea(r.outer)) > tolerance.abs,
    )
  const contactPoints = dedupePoints(nfp.contactPoints ?? [], tolerance)
  return {
    ...nfp,
    regions,
    contactPoints: contactPoints.length ? contactPoints : undefined,
    bounds: boundsIncludingContacts(regions, contactPoints),
  }
}

void isCcw
