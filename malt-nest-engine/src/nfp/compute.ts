import { Clipper, ClipType, EndType, FillRule, JoinType } from 'clipper2-ts'
import {
  normalizeShape,
  pointInPolygon,
  pointOnSegment,
  ringCentroid,
  shapeBounds,
  shapeCentroid,
  signedArea,
} from '../geometry'
import { cleanRing, ensureWinding } from '../geometry/ring'
import type { Point, Polygon, Ring, Shape } from '../geometry/types'
import {
  areaTolerance,
  clipperPrecision,
  DEFAULT_TOLERANCE,
  type GeometryTolerance,
} from '../geometry/tolerance'
import type {
  NfpContactSegment,
  NfpOptions,
  NfpPointClass,
  NfpRegion,
  NfpResult,
} from './types'
import { DEFAULT_NFP_OPTIONS } from './types'
import {
  centerAtCentroid,
  fromPathD,
  inflatePaths,
  interiorPoint,
  minkowskiDiffPaths,
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

function isConvexRing(ring: Ring, tolerance: GeometryTolerance): boolean {
  if (ring.length < 3) return false
  let sign = 0
  for (let index = 0; index < ring.length; index++) {
    const a = ring[index]!
    const b = ring[(index + 1) % ring.length]!
    const c = ring[(index + 2) % ring.length]!
    const cross =
      (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) <= areaTolerance(tolerance)) continue
    const current = Math.sign(cross)
    if (sign !== 0 && current !== sign) return false
    sign = current
  }
  return sign !== 0
}

function convexHull(points: Point[], tolerance: GeometryTolerance): Ring {
  const sorted = [...points].sort((first, second) =>
    first.x !== second.x ? first.x - second.x : first.y - second.y,
  )
  const cross = (origin: Point, a: Point, b: Point) =>
    (a.x - origin.x) * (b.y - origin.y) -
    (a.y - origin.y) * (b.x - origin.x)
  const build = (ordered: Point[]) => {
    const half: Point[] = []
    for (const point of ordered) {
      while (
        half.length >= 2 &&
        cross(half[half.length - 2]!, half[half.length - 1]!, point) <=
          areaTolerance(tolerance)
      ) {
        half.pop()
      }
      half.push(point)
    }
    return half
  }
  const lower = build(sorted)
  const upper = build([...sorted].reverse())
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

function convexOuterPaths(
  stationary: Ring,
  orbiting: Ring,
  gap: number,
  tolerance: GeometryTolerance,
): { x: number; y: number }[][] {
  const hull = convexHull(
    stationary.flatMap((a) =>
      orbiting.map((b) => ({ x: a.x - b.x, y: a.y - b.y })),
    ),
    tolerance,
  )
  let paths = toPathsD(hull)
  if (gap > tolerance.abs) paths = inflatePaths(paths, gap, tolerance)
  return paths
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
    if (Math.abs(signedArea(region.outer)) > areaTolerance(tolerance)) continue
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
  contactSegments: readonly NfpContactSegment[] = [],
) {
  const bounds = regionBounds(regions)
  if (!contactPoints.length && !contactSegments.length) return bounds
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
  for (const segment of contactSegments) {
    for (const point of [segment.a, segment.b]) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }
  if (minX === Infinity) return null
  return { minX, minY, maxX, maxY }
}

function poseFitsPermitted(
  point: Point,
  orbitingSolid: readonly (readonly Point[])[],
  permitted: { x: number; y: number }[][],
  tolerance: GeometryTolerance,
): boolean {
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
  return Math.abs(Clipper.areaPathsD(outside)) <= areaTolerance(tolerance)
}

type ContactSegment = NfpContactSegment

type ContactSegmentIndex = {
  coordinates: Float64Array
  cells: Map<string, number[]>
  cellSize: number
}

function buildContactSegmentIndex(
  permitted: { x: number; y: number }[][],
  B0: Shape,
  searchRadius: number,
): ContactSegmentIndex {
  const containerPoints = permitted.flat()
  const guestPoints = B0.polygons.flatMap((polygon) => polygon.outer)
  const containerBounds = ringBBox(containerPoints)
  const guestBounds = ringBBox(guestPoints)
  const span = Math.max(
    containerBounds.maxX - containerBounds.minX + guestBounds.maxX - guestBounds.minX,
    containerBounds.maxY - containerBounds.minY + guestBounds.maxY - guestBounds.minY,
  )
  const cellSize = Math.max(searchRadius * 4, span / 64)
  const segmentCount = permitted.reduce(
    (total, container) =>
      total +
      B0.polygons.reduce(
        (polygonTotal, polygon) => polygonTotal + 2 * container.length * polygon.outer.length,
        0,
      ),
    0,
  )
  const coordinates = new Float64Array(segmentCount * 4)
  const cells = new Map<string, number[]>()
  let segmentIndex = 0
  const add = (a: Point, b: Point) => {
    const offset = segmentIndex * 4
    coordinates[offset] = a.x
    coordinates[offset + 1] = a.y
    coordinates[offset + 2] = b.x
    coordinates[offset + 3] = b.y
    const minX = Math.floor((Math.min(a.x, b.x) - searchRadius) / cellSize)
    const maxX = Math.floor((Math.max(a.x, b.x) + searchRadius) / cellSize)
    const minY = Math.floor((Math.min(a.y, b.y) - searchRadius) / cellSize)
    const maxY = Math.floor((Math.max(a.y, b.y) + searchRadius) / cellSize)
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = `${x},${y}`
        const cell = cells.get(key)
        if (cell) cell.push(segmentIndex)
        else cells.set(key, [segmentIndex])
      }
    }
    segmentIndex++
  }

  for (const container of permitted) {
    for (let containerIndex = 0; containerIndex < container.length; containerIndex++) {
      const containerA = container[containerIndex]!
      const containerB = container[(containerIndex + 1) % container.length]!
      for (const polygon of B0.polygons) {
        for (const guestVertex of polygon.outer) {
          add(
            {
              x: containerA.x - guestVertex.x,
              y: containerA.y - guestVertex.y,
            },
            {
              x: containerB.x - guestVertex.x,
              y: containerB.y - guestVertex.y,
            },
          )
        }
        for (let guestIndex = 0; guestIndex < polygon.outer.length; guestIndex++) {
          const guestA = polygon.outer[guestIndex]!
          const guestB = polygon.outer[(guestIndex + 1) % polygon.outer.length]!
          add(
            {
              x: containerA.x - guestA.x,
              y: containerA.y - guestA.y,
            },
            {
              x: containerA.x - guestB.x,
              y: containerA.y - guestB.y,
            },
          )
        }
      }
    }
  }
  return { coordinates, cells, cellSize }
}

function queryContactSegments(
  index: ContactSegmentIndex,
  point: Point,
  searchRadius: number,
): ContactSegment[] {
  const minX = Math.floor((point.x - searchRadius) / index.cellSize)
  const maxX = Math.floor((point.x + searchRadius) / index.cellSize)
  const minY = Math.floor((point.y - searchRadius) / index.cellSize)
  const maxY = Math.floor((point.y + searchRadius) / index.cellSize)
  const ids = new Set<number>()
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (const id of index.cells.get(`${x},${y}`) ?? []) ids.add(id)
    }
  }
  const nearby: ContactSegment[] = []
  for (const id of ids) {
    const offset = id * 4
    const segment = {
      a: {
        x: index.coordinates[offset]!,
        y: index.coordinates[offset + 1]!,
      },
      b: {
        x: index.coordinates[offset + 2]!,
        y: index.coordinates[offset + 3]!,
      },
    }
    const closest = closestPointOnSegment(point, segment)
    if (Math.hypot(closest.x - point.x, closest.y - point.y) <= searchRadius) {
      nearby.push(segment)
    }
  }
  return nearby
}

function closestPointOnSegment(point: Point, segment: ContactSegment): Point {
  const dx = segment.b.x - segment.a.x
  const dy = segment.b.y - segment.a.y
  const length2 = dx * dx + dy * dy
  if (length2 === 0) return segment.a
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) /
        length2,
    ),
  )
  return { x: segment.a.x + t * dx, y: segment.a.y + t * dy }
}

function intersectContactSegments(
  first: ContactSegment,
  second: ContactSegment,
  tolerance: GeometryTolerance,
): Point | null {
  const rx = first.b.x - first.a.x
  const ry = first.b.y - first.a.y
  const sx = second.b.x - second.a.x
  const sy = second.b.y - second.a.y
  const denominator = rx * sy - ry * sx
  const scale = Math.hypot(rx, ry) * Math.hypot(sx, sy)
  if (Math.abs(denominator) <= areaTolerance(tolerance) + tolerance.rel * scale) {
    return null
  }
  const qpx = second.a.x - first.a.x
  const qpy = second.a.y - first.a.y
  const t = (qpx * sy - qpy * sx) / denominator
  const u = (qpx * ry - qpy * rx) / denominator
  const parameterTolerance = tolerance.abs / Math.max(Math.hypot(rx, ry), 1)
  if (
    t < -parameterTolerance ||
    t > 1 + parameterTolerance ||
    u < -parameterTolerance ||
    u > 1 + parameterTolerance
  ) {
    return null
  }
  return { x: first.a.x + t * rx, y: first.a.y + t * ry }
}

/** Refine a nearby offset-IFP probe using exact vertex/edge contact lines. */
function refineExactContact(
  approximate: Point,
  index: ContactSegmentIndex,
  searchRadius: number,
  tolerance: GeometryTolerance,
  seedSegments?: ContactSegment[],
): Point[] {
  const nearby = queryContactSegments(index, approximate, searchRadius)
  seedSegments?.push(...nearby)

  const candidates = nearby.map((segment) =>
    closestPointOnSegment(approximate, segment),
  )
  for (let first = 0; first < nearby.length; first++) {
    for (let second = first + 1; second < nearby.length; second++) {
      const intersection = intersectContactSegments(
        nearby[first]!,
        nearby[second]!,
        tolerance,
      )
      if (intersection) candidates.push(intersection)
    }
  }
  return candidates
}

function dedupeContactSegments(
  segments: readonly NfpContactSegment[],
  tolerance: GeometryTolerance,
): NfpContactSegment[] {
  const unique: NfpContactSegment[] = []
  const samePoint = (first: Point, second: Point) =>
    Math.abs(first.x - second.x) <= tolerance.abs &&
    Math.abs(first.y - second.y) <= tolerance.abs
  for (const segment of segments) {
    if (
      Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y) <=
      tolerance.abs
    ) {
      continue
    }
    if (
      unique.some(
        (existing) =>
          (samePoint(existing.a, segment.a) &&
            samePoint(existing.b, segment.b)) ||
          (samePoint(existing.a, segment.b) && samePoint(existing.b, segment.a)),
      )
    ) {
      continue
    }
    unique.push(segment)
  }
  return unique
}

/**
 * Contact-line events partition polygonal translation space into intervals
 * with constant containment. Join adjacent recovered events only when probes
 * throughout that interval still fit the original (unexpanded) container.
 */
function recoverContactSegments(
  points: readonly Point[],
  seedSegments: readonly ContactSegment[],
  orbitingSolid: readonly (readonly Point[])[],
  permitted: { x: number; y: number }[][],
  tolerance: GeometryTolerance,
): NfpContactSegment[] {
  const recovered: NfpContactSegment[] = []
  for (const seed of seedSegments) {
    const dx = seed.b.x - seed.a.x
    const dy = seed.b.y - seed.a.y
    const length2 = dx * dx + dy * dy
    if (length2 <= tolerance.edgeMinLen2) continue
    const events = points
      .filter((point) => pointOnSegment(point, seed.a, seed.b, tolerance))
      .map((point) => ({
        point,
        parameter:
          ((point.x - seed.a.x) * dx + (point.y - seed.a.y) * dy) /
          length2,
      }))
      .sort((first, second) => first.parameter - second.parameter)
    for (let index = 1; index < events.length; index++) {
      const a = events[index - 1]!.point
      const b = events[index]!.point
      if (Math.hypot(b.x - a.x, b.y - a.y) <= tolerance.abs) continue
      const probes = [0.25, 0.5, 0.75].map((ratio) => ({
        x: a.x + (b.x - a.x) * ratio,
        y: a.y + (b.y - a.y) * ratio,
      }))
      if (
        probes.every((probe) =>
          poseFitsPermitted(probe, orbitingSolid, permitted, tolerance),
        )
      ) {
        recovered.push({ a, b })
      }
    }
  }
  return dedupeContactSegments(recovered, tolerance)
}

function pointRepresentedByRegions(
  point: Point,
  regions: readonly NfpRegion[],
  boundaryDistance: number,
  tolerance: GeometryTolerance,
): boolean {
  const boundaryTolerance = {
    ...tolerance,
    abs: Math.max(tolerance.abs, boundaryDistance),
  }
  return regions.some((region) => {
    if (
      pointInPolygon(
        point,
        { outer: region.outer, holes: region.holes },
        tolerance,
      )
    ) {
      return true
    }
    return [region.outer, ...region.holes].some((ring) =>
      ring.some((a, index) =>
        pointOnSegment(
          point,
          a,
          ring[(index + 1) % ring.length]!,
          boundaryTolerance,
        ),
      ),
    )
  })
}

function innerFitPaths(
  permitted: { x: number; y: number }[][],
  B0: Shape,
  tolerance: GeometryTolerance,
): { x: number; y: number }[][] {
  let allFits: { x: number; y: number }[][] = []
  for (const containerPath of permitted) {
    let componentFits: { x: number; y: number }[][] | null = null
    for (const polygon of B0.polygons) {
      const raw = minkowskiDiffPaths(
        polygon.outer.map((point) => ({ x: point.x, y: point.y })),
        containerPath,
        true,
        tolerance,
      )
      const fits = raw
        .filter((path) => Clipper.area(path) < -areaTolerance(tolerance))
        .map((path) => [...path].reverse())
      componentFits = componentFits
        ? Clipper.intersectD(
            componentFits,
            fits,
            FillRule.NonZero,
            clipperPrecision(tolerance),
          )
        : fits
      if (!componentFits.length) break
    }
    if (componentFits?.length) allFits.push(...componentFits)
  }
  if (allFits.length > 1) {
    allFits = Clipper.booleanOpD(
      ClipType.Union,
      allFits,
      null,
      FillRule.NonZero,
      clipperPrecision(tolerance),
    )
  }
  return allFits
}

/**
 * Clipper drops point/line IFPs. A one-grid outward offset turns them into
 * tiny positive regions; probes are then revalidated against the original
 * container, so the offset can only recover real exact-contact poses.
 */
function recoverExactInnerFitContacts(
  permitted: { x: number; y: number }[][],
  domain: Ring,
  B0: Shape,
  orbitingSolid: readonly (readonly Point[])[],
  tolerance: GeometryTolerance,
  recoveredSegments?: NfpContactSegment[],
  positiveRegions: readonly NfpRegion[] = [],
): Point[] {
  const directCandidates: Point[] = [{ x: 0, y: 0 }, ...domain]
  for (const path of permitted) {
    const centroid = ringCentroid(fromPathD(path), tolerance)
    if (centroid) directCandidates.push(centroid)
  }
  const delta = Math.max(2 / tolerance.clipperScale, tolerance.abs * 2)
  const isAlreadyRepresented = (candidate: Point) =>
    pointRepresentedByRegions(
      candidate,
      positiveRegions,
      delta * 1.5,
      tolerance,
    )
  const direct = dedupePoints(directCandidates, tolerance).filter(
    (candidate) =>
      !isAlreadyRepresented(candidate) &&
      poseFitsPermitted(candidate, orbitingSolid, permitted, tolerance),
  )

  const expanded = Clipper.inflatePathsD(
    permitted,
    delta,
    JoinType.Miter,
    EndType.Polygon,
    2,
    clipperPrecision(tolerance),
  )
  if (!expanded.length) return []
  const candidates: Point[] = []
  for (const region of pathsToRegions(
    innerFitPaths(expanded, B0, tolerance),
    tolerance,
  )) {
    const interior = interiorPoint(region.outer, tolerance)
    if (interior) candidates.push(interior)
    const centroid = ringCentroid(region.outer, tolerance)
    if (centroid) candidates.push(centroid)
    const bounds = ringBBox(region.outer)
    candidates.push({
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    })
    const isTiny =
      bounds.maxX - bounds.minX <= delta * 8 &&
      bounds.maxY - bounds.minY <= delta * 8
    const representedByDirectContact = direct.some(
      (point) =>
        point.x >= bounds.minX - tolerance.abs &&
        point.x <= bounds.maxX + tolerance.abs &&
        point.y >= bounds.minY - tolerance.abs &&
        point.y <= bounds.maxY + tolerance.abs,
    )
    if (!isTiny || !representedByDirectContact) {
      for (let index = 0; index < region.outer.length; index++) {
        const a = region.outer[index]!
        const b = region.outer[(index + 1) % region.outer.length]!
        candidates.push(a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      }
    }
  }
  const uniqueCandidates = dedupePoints(candidates, tolerance).filter(
    (candidate) => !isAlreadyRepresented(candidate),
  )
  const valid = [...direct, ...uniqueCandidates.filter((candidate) =>
    poseFitsPermitted(candidate, orbitingSolid, permitted, tolerance),
  )]
  let contactIndex: ContactSegmentIndex | undefined
  const seedSegments: ContactSegment[] = []
  for (const approximate of uniqueCandidates) {
    if (valid.includes(approximate)) continue
    contactIndex ??= buildContactSegmentIndex(permitted, B0, delta * 4)
    valid.push(
      ...refineExactContact(
        approximate,
        contactIndex,
        delta * 4,
        tolerance,
        seedSegments,
      ).filter((candidate) =>
        poseFitsPermitted(candidate, orbitingSolid, permitted, tolerance),
      ),
    )
  }
  const points = dedupePoints(valid, tolerance)
  if (recoveredSegments && seedSegments.length) {
    recoveredSegments.push(
      ...recoverContactSegments(
        points,
        seedSegments,
        orbitingSolid,
        permitted,
        tolerance,
      ),
    )
  }
  return points
}

/** Translational IFP from negative contours of C ⊕ −B. */
function innerFitFilled(
  containerOuter: Ring,
  B0: Shape,
  gap: number,
  tolerance: GeometryTolerance,
  recoveredContacts?: Point[],
  recoveredSegments?: NfpContactSegment[],
): NfpRegion[] {
  let permitted = toPathsD(
    ensureWinding(cleanRing(containerOuter, tolerance), true),
  )
  if (gap > tolerance.abs) {
    permitted = inflatePaths(permitted, -gap, tolerance)
  }
  if (!permitted.length) return []

  const orbitingBounds = shapeBounds(B0)
  if (!orbitingBounds) return []
  const permittedBounds = ringBBox(permitted.flat())
  const domain = rectInnerFitFromBounds(permittedBounds, orbitingBounds)
  if (!domain) return []
  const orbitingSolid = solidPaths(B0, tolerance)
  if (
    Math.abs(Clipper.areaPathsD(orbitingSolid)) >
    Math.abs(Clipper.areaPathsD(permitted)) + areaTolerance(tolerance)
  ) {
    return []
  }

  if (permitted.length === 1 && isRectRing(fromPathD(permitted[0]!), tolerance)) {
    if (
      recoveredSegments &&
      Math.abs(signedArea(domain)) <= areaTolerance(tolerance)
    ) {
      let longest: NfpContactSegment | undefined
      let longestLength = 0
      for (let first = 0; first < domain.length; first++) {
        for (let second = first + 1; second < domain.length; second++) {
          const a = domain[first]!
          const b = domain[second]!
          const length = Math.hypot(b.x - a.x, b.y - a.y)
          if (length > longestLength) {
            longest = { a, b }
            longestLength = length
          }
        }
      }
      if (longest && longestLength > tolerance.abs) {
        recoveredSegments.push(longest)
      }
    }
    return [{ outer: domain, holes: [] }]
  }

  const allFits = innerFitPaths(permitted, B0, tolerance)
  const regions = pathsToRegions(allFits, tolerance).filter((region) => {
    const probe = interiorPoint(region.outer, tolerance)
    return (
      probe !== null &&
      poseFitsPermitted(probe, orbitingSolid, permitted, tolerance)
    )
  })
  recoveredContacts?.push(
    ...recoverExactInnerFitContacts(
      permitted,
      domain,
      B0,
      orbitingSolid,
      tolerance,
      recoveredSegments,
      regions,
    ).filter(
      (point) =>
        !regions.some((region) =>
          pointInPolygon(
            point,
            { outer: region.outer, holes: region.holes },
            tolerance,
          ),
        ),
    ),
  )
  return regions
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
  const contactSegments: NfpContactSegment[] = []
  const orbitingPolygon =
    B0.polygons.length === 1 && B0.polygons[0]!.holes.length === 0
      ? B0.polygons[0]!
      : null
  for (const poly of A.polygons) {
    const cleanOuter = ensureWinding(cleanRing(poly.outer, tolerance), true)
    let forbidden: NfpRegion[]
    if (
      orbitingPolygon &&
      isConvexRing(cleanOuter, tolerance) &&
      isConvexRing(orbitingPolygon.outer, tolerance)
    ) {
      forbidden = pathsToRegions(
        convexOuterPaths(
          cleanOuter,
          orbitingPolygon.outer,
          gap,
          tolerance,
        ),
        tolerance,
      )
    } else {
      const filled = filledOuterPaths(poly, gap, tolerance)
      const raw = minkowskiDiffSolids(filled, bSolid, tolerance)
      forbidden = retainFreeMinkowskiHoles(
        pathsToRegions(raw, tolerance),
        filled,
        bSolid,
        tolerance,
      ).map((r) => ({
        outer: r.outer,
        holes: r.holes,
      }))
    }

    for (const hole of poly.holes) {
      const recovered: Point[] = []
      const recoveredSegments: NfpContactSegment[] = []
      const holeFit = innerFitFilled(
        hole,
        B0,
        gap,
        tolerance,
        recovered,
        recoveredSegments,
      )
      contactPoints.push(...recovered)
      contactSegments.push(...recoveredSegments)
      contactPoints.push(...zeroMeasureCandidates(holeFit, tolerance))
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
        const recovered: Point[] = []
        const recoveredSegments: NfpContactSegment[] = []
        const fits = innerFitFilled(
          hole,
          A0,
          gap,
          tolerance,
          recovered,
          recoveredSegments,
        )
        contactPoints.push(
          ...recovered.map((point) => ({
            x: stationaryCentroid.x - point.x,
            y: stationaryCentroid.y - point.y,
          })),
        )
        const pointFits = zeroMeasureCandidates(fits, tolerance).map(
          (point) => ({
            x: stationaryCentroid.x - point.x,
            y: stationaryCentroid.y - point.y,
          }),
        )
        contactPoints.push(...pointFits)
        contactSegments.push(
          ...recoveredSegments.map((segment) => ({
            a: {
              x: stationaryCentroid.x - segment.a.x,
              y: stationaryCentroid.y - segment.a.y,
            },
            b: {
              x: stationaryCentroid.x - segment.b.x,
              y: stationaryCentroid.y - segment.b.y,
            },
          })),
        )
        orbitingHoleFits.push(
          ...reflectFitRegions(
            fits.filter(
              (fit) =>
                Math.abs(signedArea(fit.outer)) > areaTolerance(tolerance),
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
  const validContactSegments = dedupeContactSegments(
    contactSegments,
    tolerance,
  ).filter((segment) =>
    [segment.a, segment.b, {
      x: (segment.a.x + segment.b.x) / 2,
      y: (segment.a.y + segment.b.y) / 2,
    }].every(
      (point) =>
        !poseHasMaterialOverlap(
          stationaryClearance,
          bSolid,
          point,
          tolerance,
        ),
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
    contactSegments: validContactSegments.length
      ? validContactSegments
      : undefined,
    bounds: boundsIncludingContacts(
      regions,
      validContactPoints,
      validContactSegments,
    ),
    algorithm: 'minkowski-clipper2',
  }, tolerance)
}

function subtractForbiddenFromContactSegments(
  segments: readonly NfpContactSegment[],
  forbidden: NfpResult,
  tolerance: GeometryTolerance,
): NfpContactSegment[] {
  const kept: NfpContactSegment[] = []
  for (const segment of segments) {
    const dx = segment.b.x - segment.a.x
    const dy = segment.b.y - segment.a.y
    const length2 = dx * dx + dy * dy
    if (length2 <= tolerance.edgeMinLen2) continue
    const parameters = [0, 1]
    for (const region of forbidden.regions) {
      for (const ring of [region.outer, ...region.holes]) {
        for (let index = 0; index < ring.length; index++) {
          const intersection = intersectContactSegments(
            segment,
            { a: ring[index]!, b: ring[(index + 1) % ring.length]! },
            tolerance,
          )
          if (!intersection) continue
          parameters.push(
            ((intersection.x - segment.a.x) * dx +
              (intersection.y - segment.a.y) * dy) /
              length2,
          )
        }
      }
    }
    parameters.sort((first, second) => first - second)
    for (let index = 1; index < parameters.length; index++) {
      const start = Math.max(0, parameters[index - 1]!)
      const end = Math.min(1, parameters[index]!)
      if ((end - start) * Math.sqrt(length2) <= tolerance.abs) continue
      const middle = (start + end) / 2
      const probe = {
        x: segment.a.x + middle * dx,
        y: segment.a.y + middle * dy,
      }
      if (classifyNfpPoint(probe, forbidden, tolerance) === 'inside') continue
      kept.push({
        a: {
          x: segment.a.x + start * dx,
          y: segment.a.y + start * dy,
        },
        b: {
          x: segment.a.x + end * dx,
          y: segment.a.y + end * dy,
        },
      })
    }
  }
  return dedupeContactSegments(kept, tolerance)
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
  const contactSegments: NfpContactSegment[] = []
  for (const poly of C.polygons) {
    // Fit inside outer, then subtract fits that collide with hole rims —
    // for solid container with holes, free = IFP(outer) \ ∪ expanded holes...
    // Simpler: IFP(outer) then subtract OuterNFP(hole-as-obstacle)...
    let freeContacts: Point[] = []
    let freeSegments: NfpContactSegment[] = []
    let free = innerFitFilled(
      poly.outer,
      B0,
      gap,
      tolerance,
      freeContacts,
      freeSegments,
    )
    freeContacts.push(...zeroMeasureCandidates(free, tolerance))
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
        (point) => classifyNfpPoint(point, obstacle, tolerance) !== 'inside',
      )
      freeSegments = subtractForbiddenFromContactSegments(
        freeSegments,
        obstacle,
        tolerance,
      )
    }
    contactPoints.push(...freeContacts)
    contactSegments.push(...freeSegments)
    regions.push(...free)
  }

  const validContactPoints = dedupePoints(contactPoints, tolerance)
  const validContactSegments = dedupeContactSegments(contactSegments, tolerance)

  return normalizeNfp({
    kind: 'inner',
    stationaryId: container.id,
    orbitingId: orbiting.id,
    reference: 'centroid',
    gap: Math.max(0, gap),
    regions,
    contactPoints: validContactPoints.length ? validContactPoints : undefined,
    contactSegments: validContactSegments.length
      ? validContactSegments
      : undefined,
    bounds: boundsIncludingContacts(
      regions,
      validContactPoints,
      validContactSegments,
    ),
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
  const onContactSegment = nfp.contactSegments?.some((segment) =>
    pointOnSegment(p, segment.a, segment.b, tol),
  )
  if (onContact || onContactSegment) {
    return nfp.kind === 'inner' ? 'boundary' : 'outside'
  }
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
      if (pointOnSegment(p, a, b, tol)) return true
    }
  }
  return false
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
        Math.abs(signedArea(r.outer)) > areaTolerance(tolerance),
    )
  const contactPoints = dedupePoints(nfp.contactPoints ?? [], tolerance)
  const contactSegments = dedupeContactSegments(
    nfp.contactSegments ?? [],
    tolerance,
  )
  return {
    ...nfp,
    regions,
    contactPoints: contactPoints.length ? contactPoints : undefined,
    contactSegments: contactSegments.length ? contactSegments : undefined,
    bounds: boundsIncludingContacts(regions, contactPoints, contactSegments),
  }
}
