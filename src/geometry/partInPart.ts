import { type Solid } from './collide'
import { solidsCollide } from './spacingCollide'
import { solidInsideHole, holeAsContainer } from './containment'
import { offsetPolygonComponents } from './offset'
import { boundingBox, centroid, polygonArea } from './ops'
import { normalizePolygon } from './normalize'
import { clipperInnerFitPolygons } from './backend/clipperAdapter'
import { difference } from './boolean'
import { computeNfp } from './nfp'
import { geomEps } from './tolerance'
import { isConvexPolygon } from './convex'
import type { MultiPolygon, Point, Polygon } from './types'

export type HoleFitResult = {
  fits: boolean
  holeIndex: number
  reason?:
    | 'disabled'
    | 'no_hole'
    | 'too_large'
    | 'spacing'
    | 'not_contained'
    | 'ok'
  /** Suggested translation of guest local → world (when fits). */
  translation?: Point
}

/**
 * Configuration-space inner-fit search for part-in-part.
 * Does not force optimizer usage — callers check allowPartInPart.
 */
export function canFitInHole(
  host: Solid,
  guest: Solid,
  holeIndex: number,
  spacingMm: number,
  obstacles: Solid[] = [],
  signal?: AbortSignal,
): HoleFitResult {
  const search = holeFitTranslations(
    host,
    guest,
    holeIndex,
    spacingMm,
    obstacles,
    1,
    signal,
  )
  const translation = search.translations[0]
  return translation
    ? { fits: true, holeIndex, reason: 'ok', translation }
    : { fits: false, holeIndex, reason: search.reason }
}

function holeFitTranslations(
  host: Solid,
  guest: Solid,
  holeIndex: number,
  spacingMm: number,
  obstacles: Solid[],
  maxResults = Number.POSITIVE_INFINITY,
  signal?: AbortSignal,
): { translations: Point[]; reason: HoleFitResult['reason'] } {
  const hole = host.holes[holeIndex]
  if (!hole) {
    return { translations: [], reason: 'no_hole' }
  }

  const spacing = Math.max(0, spacingMm)
  const container = holeAsContainer(hole)

  // Shrink hole by spacing for geometrically meaningful clearance from hole wall
  let effectiveComponents: Polygon[] = [container]
  if (spacing > geomEps()) {
    const off = offsetPolygonComponents(container, -spacing)
    effectiveComponents = off.polygons.filter(
      (polygon) => polygon.points.length >= 3,
    )
    if (effectiveComponents.length === 0) {
      return { translations: [], reason: 'spacing' }
    }
  }

  const gb = guest.bounds
  const translations: Point[] = []
  const alreadyAccepted = pointDeduper()
  let sizeEligible = false
  for (const effective of effectiveComponents) {
    if (signal?.aborted) break
    const hb = boundingBox(effective.points)
    if (gb.width > hb.width + geomEps() || gb.height > hb.height + geomEps()) {
      continue
    }
    sizeEligible = true
    const accept = (translation: Point): boolean => {
      if (alreadyAccepted.has(translation)) return false
      const placed = translateLocal(guest, translation.x, translation.y)
      if (
        placed.bounds.minX < hb.minX - geomEps() ||
        placed.bounds.minY < hb.minY - geomEps() ||
        placed.bounds.maxX > hb.maxX + geomEps() ||
        placed.bounds.maxY > hb.maxY + geomEps()
      ) {
        return false
      }
      if (!solidInsideHole(placed, effective)) return false
      if (
        obstacles.some(
          (obstacle) =>
            obstacle !== host && solidsCollide(obstacle, placed, spacing),
        )
      ) {
        return false
      }
      alreadyAccepted.add(translation)
      translations.push(translation)
      return translations.length >= maxResults
    }

    const holePoints = canonicalTopologyRing(effective.points)
    const guestPoints = canonicalTopologyRing(guest.outer.points)
    const containerArea = polygonArea(holePoints)
    const guestArea = polygonArea(guestPoints)
    const areaTolerance =
      geomEps() * Math.max(1, Math.abs(containerArea), Math.abs(guestArea))
    if (guestArea > containerArea + areaTolerance) continue
    const areaDifference = Math.abs(containerArea - guestArea)
    if (areaDifference <= areaTolerance) {
      const holeCenter = centroid(holePoints)
      const guestCenter = centroid(guestPoints)
      accept({
        x: holeCenter.x - guestCenter.x,
        y: holeCenter.y - guestCenter.y,
      })
      if (translations.length >= maxResults) {
        return { translations, reason: 'ok' }
      }
      // Equal-area convex polygons can fit by translation only when their
      // centroids align. Avoid an expensive Minkowski calculation once that
      // sole pose has failed; near-equal geometry still falls through.
      const roundoff =
        Number.EPSILON *
        Math.max(1, containerArea, guestArea) *
        Math.max(holePoints.length, guestPoints.length) *
        16
      if (
        areaDifference <= roundoff &&
        isConvexPolygon({ points: holePoints }) &&
        isConvexPolygon({ points: guestPoints })
      ) {
        continue
      }
    }
    const innerFit = clipperInnerFitPolygons(holePoints, guestPoints)
    const available = subtractObstacleNfps(
      innerFit.polygons,
      host,
      guest,
      spacing,
      obstacles,
      signal,
    )
    for (const translation of regionCandidates(available)) {
      if (accept(translation)) return { translations, reason: 'ok' }
    }
    // Convex IFPs have one dimensionality. Concave containers can have a
    // positive room plus separate point/line branches that Clipper omits.
    if (
      innerFit.polygons.length > 0 &&
      isConvexPolygon({ points: holePoints })
    ) {
      continue
    }

    for (const translation of axisAlignedCandidates(holePoints, guestPoints)) {
      if (accept(translation)) return { translations, reason: 'ok' }
    }

    // Clipper omits line/point IFPs. A tolerance expansion turns those into
    // finite regions with bounded Minkowski work; every probe is still
    // validated against the original, unexpanded geometry above.
    const expanded = offsetPolygonComponents(
      effective,
      Math.max(geomEps() * 1_000, 1e-3),
    )
    for (const component of expanded.polygons) {
      if (signal?.aborted) break
      const probeFit = clipperInnerFitPolygons(
        canonicalTopologyRing(component.points),
        guestPoints,
      )
      const probeRegions = subtractObstacleNfps(
        probeFit.polygons,
        host,
        guest,
        spacing,
        obstacles,
        signal,
      )
      for (const translation of regionCandidates(probeRegions)) {
        if (accept(translation)) return { translations, reason: 'ok' }
      }
    }
  }

  return {
    translations,
    reason: translations.length
      ? 'ok'
      : sizeEligible
        ? 'not_contained'
        : 'too_large',
  }
}

function subtractObstacleNfps(
  innerFits: Polygon[],
  host: Solid,
  guest: Solid,
  spacing: number,
  obstacles: Solid[],
  signal?: AbortSignal,
): MultiPolygon[] {
  let available: MultiPolygon[] = innerFits.map((outer) => ({ outer, holes: [] }))
  for (const obstacle of obstacles) {
    if (signal?.aborted || available.length === 0) break
    if (obstacle === host) continue
    const forbidden = computeNfp(obstacle, guest, spacing, {
      fidelity: 'exact',
    })
    for (const region of forbidden.regions) {
      const next: MultiPolygon[] = []
      for (const candidate of available) {
        const cut = difference(candidate, region)
        if (cut.ok) next.push(...cut.polygons)
        else next.push(candidate)
      }
      available = next
      if (available.length === 0) break
    }
  }
  return available
}

function regionCandidates(regions: MultiPolygon[]): Point[] {
  const out: Point[] = []
  const seen = pointDeduper()
  const add = (x: number, y: number) => {
    const point = { x, y }
    if (seen.has(point)) return
    seen.add(point)
    out.push(point)
  }
  for (const region of regions) {
    for (const ring of [region.outer, ...region.holes]) {
      for (const point of ring.points) add(point.x, point.y)
    }
    const bounds = boundingBox(region.outer.points)
    const xs = [bounds.minX, (bounds.minX + bounds.maxX) / 2, bounds.maxX]
    const ys = [bounds.minY, (bounds.minY + bounds.maxY) / 2, bounds.maxY]
    for (const x of xs) for (const y of ys) add(x, y)
    const count = region.outer.points.length
    if (count) {
      const sum = region.outer.points.reduce(
        (value, point) => ({ x: value.x + point.x, y: value.y + point.y }),
        { x: 0, y: 0 },
      )
      add(sum.x / count, sum.y / count)
    }
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x)
  return out
}

function pointDeduper(): {
  has(point: Point): boolean
  add(point: Point): void
} {
  const epsilon = geomEps()
  const buckets = new Map<string, Point[]>()
  const bucket = (point: Point) => ({
    x: Math.floor(point.x / epsilon),
    y: Math.floor(point.y / epsilon),
  })
  return {
    has(point) {
      const center = bucket(point)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nearby = buckets.get(`${center.x + dx},${center.y + dy}`)
          if (
            nearby?.some(
              (candidate) =>
                Math.hypot(candidate.x - point.x, candidate.y - point.y) <=
                epsilon,
            )
          ) {
            return true
          }
        }
      }
      return false
    },
    add(point) {
      const key = bucket(point)
      const id = `${key.x},${key.y}`
      const values = buckets.get(id)
      if (values) values.push(point)
      else buckets.set(id, [point])
    },
  }
}

function axisAlignedCandidates(hole: Point[], guest: Point[]): Point[] {
  const hb = boundingBox(hole)
  const gb = boundingBox(guest)
  const out: Point[] = []
  const xs = [
    hb.minX - gb.minX,
    (hb.minX + hb.maxX - gb.minX - gb.maxX) / 2,
    hb.maxX - gb.maxX,
  ]
  const ys = [
    hb.minY - gb.minY,
    (hb.minY + hb.maxY - gb.minY - gb.maxY) / 2,
    hb.maxY - gb.maxY,
  ]
  for (const x of xs) {
    for (const y of ys) out.push({ x, y })
  }
  return out
}

function canonicalTopologyRing(points: Point[]): Point[] {
  const normalized = normalizePolygon(points, true)
  const normalizedRing = normalized.ok ? normalized.polygon.points : points
  const ring = normalizedRing.filter((point, index) => {
    const previous =
      normalizedRing[(index - 1 + normalizedRing.length) % normalizedRing.length]!
    const next = normalizedRing[(index + 1) % normalizedRing.length]!
    const cross =
      (point.x - previous.x) * (next.y - point.y) -
      (point.y - previous.y) * (next.x - point.x)
    const scale = Math.max(
      1,
      Math.hypot(point.x - previous.x, point.y - previous.y),
      Math.hypot(next.x - point.x, next.y - point.y),
    )
    return Math.abs(cross) > geomEps() * scale
  })
  if (ring.length < 2) return ring
  let start = 0
  for (let i = 1; i < ring.length; i++) {
    const point = ring[i]!
    const best = ring[start]!
    if (point.y < best.y || (point.y === best.y && point.x < best.x)) {
      start = i
    }
  }
  return [...ring.slice(start), ...ring.slice(0, start)]
}

function translateLocal(solid: Solid, dx: number, dy: number): Solid {
  return {
    outer: {
      points: solid.outer.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    },
    holes: solid.holes.map((h) => ({
      points: h.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    })),
    bounds: {
      minX: solid.bounds.minX + dx,
      minY: solid.bounds.minY + dy,
      maxX: solid.bounds.maxX + dx,
      maxY: solid.bounds.maxY + dy,
      width: solid.bounds.width,
      height: solid.bounds.height,
    },
  }
}

/** Enumerate host holes that could admit guest (bbox filter). */
export function candidateHolesForPart(
  host: Solid,
  guest: Solid,
  spacingMm: number,
): number[] {
  const out: number[] = []
  const gw = guest.bounds.width + spacingMm * 2
  const gh = guest.bounds.height + spacingMm * 2
  for (let i = 0; i < host.holes.length; i++) {
    const hb = boundingBox(host.holes[i]!.points)
    if (hb.width + geomEps() >= gw && hb.height + geomEps() >= gh) {
      out.push(i)
    }
  }
  return out
}

export function findPartInPartPlacement(
  host: Solid,
  guest: Solid,
  spacingMm: number,
  obstacles: Solid[] = [],
  signal?: AbortSignal,
): HoleFitResult | null {
  const idxs = candidateHolesForPart(host, guest, spacingMm)
  for (const i of idxs) {
    const search = holeFitTranslations(
      host,
      guest,
      i,
      spacingMm,
      obstacles,
      1,
      signal,
    )
    const translation = search.translations[0]
    if (translation) {
      return { fits: true, holeIndex: i, reason: 'ok', translation }
    }
  }
  return null
}

export function findPartInPartPlacements(
  host: Solid,
  guest: Solid,
  spacingMm: number,
  obstacles: Solid[] = [],
  signal?: AbortSignal,
): HoleFitResult[] {
  const idxs = candidateHolesForPart(host, guest, spacingMm)
  const results: HoleFitResult[] = []
  for (const i of idxs) {
    if (signal?.aborted) break
    const search = holeFitTranslations(
      host,
      guest,
      i,
      spacingMm,
      obstacles,
      Number.POSITIVE_INFINITY,
      signal,
    )
    for (const translation of search.translations) {
      results.push({
        fits: true,
        holeIndex: i,
        reason: 'ok',
        translation,
      })
    }
  }
  return results
}
