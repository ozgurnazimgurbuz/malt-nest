import { canonicalizeAngle } from '../rotation/angle'
import type { Shape } from '../geometry/types'
import {
  DEFAULT_TOLERANCE,
  type GeometryTolerance,
} from '../geometry/tolerance'
import type { AnglePrecision } from '../rotation/types'
import { DEFAULT_ANGLE_PRECISION } from '../rotation/types'

/**
 * Session NFP cache. Geometry identity deliberately excludes public shape IDs,
 * so identical instances reuse pose-equivalent NFPs.
 */
export type NfpCacheKey = string

export type NfpCacheStats = {
  hits: number
  misses: number
}

export function makeNfpCacheKey(parts: {
  kind: 'outer' | 'inner'
  stationaryId: string
  orbitingId: string
  rotationStationaryDeg: number
  rotationOrbitingDeg: number
  gap: number
  precision?: AnglePrecision
  stationaryGeometry?: Shape
  orbitingGeometry?: Shape
  tolerance?: GeometryTolerance
}): NfpCacheKey {
  const prec = parts.precision ?? DEFAULT_ANGLE_PRECISION
  const tolerance = parts.tolerance ?? DEFAULT_TOLERANCE
  return JSON.stringify([
    parts.kind,
    parts.stationaryGeometry
      ? geometryFingerprint(parts.stationaryGeometry)
      : `id:${parts.stationaryId}`,
    parts.orbitingGeometry
      ? geometryFingerprint(parts.orbitingGeometry)
      : `id:${parts.orbitingId}`,
    canonicalizeAngle(parts.rotationStationaryDeg, prec),
    canonicalizeAngle(parts.rotationOrbitingDeg, prec),
    parts.gap,
    tolerance.abs,
    tolerance.rel,
    tolerance.edgeMinLen2,
    tolerance.curveTolerance,
    tolerance.clipperScale,
  ])
}

const geometryDigests = new WeakMap<Shape, string>()
const numberBuffer = new ArrayBuffer(8)
const numberView = new DataView(numberBuffer)

/** Fixed-size deterministic topology + coordinate digest, intentionally ID-free. */
export function geometryFingerprint(shape: Shape): string {
  const cached = geometryDigests.get(shape)
  if (cached) return cached

  const hashes = [
    0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35,
    0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5,
  ]
  const mix = (word: number) => {
    for (let index = 0; index < hashes.length; index++) {
      hashes[index] = Math.imul(
        (hashes[index]! ^ word ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0,
        0x01000193,
      ) >>> 0
    }
  }
  const mixNumber = (value: number) => {
    numberView.setFloat64(0, value === 0 ? 0 : value, true)
    mix(numberView.getUint32(0, true))
    mix(numberView.getUint32(4, true))
  }
  const mixRing = (ring: readonly { x: number; y: number }[]) => {
    mix(ring.length)
    for (const point of ring) {
      mixNumber(point.x)
      mixNumber(point.y)
    }
  }

  mix(shape.polygons.length)
  for (const polygon of shape.polygons) {
    mix(0x6f757465)
    mixRing(polygon.outer)
    mix(polygon.holes.length)
    for (const hole of polygon.holes) {
      mix(0x686f6c65)
      mixRing(hole)
    }
  }
  const digest = hashes
    .map((hash) => {
      let value = hash
      value ^= value >>> 16
      value = Math.imul(value, 0x85ebca6b)
      value ^= value >>> 13
      value = Math.imul(value, 0xc2b2ae35)
      value ^= value >>> 16
      return (value >>> 0).toString(16).padStart(8, '0')
    })
    .join('')
  geometryDigests.set(shape, digest)
  return digest
}

export type NfpCache<T> = {
  get(key: NfpCacheKey): T | undefined
  set(key: NfpCacheKey, value: T): void
  readonly size: number
  readonly stats: NfpCacheStats
}

const DEFAULT_MAX_NFP_CACHE_ENTRIES = 512
const DEFAULT_MAX_NFP_CACHE_POINTS = 100_000

function nfpPointWeight(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 1
  const candidate = value as {
    regions?: Array<{
      outer?: unknown[]
      holes?: Array<unknown[]>
    }>
    contactPoints?: unknown[]
    contactSegments?: unknown[]
  }
  let points =
    (candidate.contactPoints?.length ?? 0) +
    2 * (candidate.contactSegments?.length ?? 0)
  for (const region of candidate.regions ?? []) {
    points += region.outer?.length ?? 0
    for (const hole of region.holes ?? []) points += hole.length
  }
  return Math.max(1, points)
}

export function createNfpCache<T>(
  maxEntries = DEFAULT_MAX_NFP_CACHE_ENTRIES,
  maxPoints = DEFAULT_MAX_NFP_CACHE_POINTS,
): NfpCache<T> {
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    throw new Error('NFP cache maxEntries must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxPoints) || maxPoints <= 0) {
    throw new Error('NFP cache maxPoints must be a positive safe integer')
  }
  const map = new Map<NfpCacheKey, { value: T; points: number }>()
  const stats: NfpCacheStats = { hits: 0, misses: 0 }
  let retainedPoints = 0
  return {
    get: (k) => {
      const entry = map.get(k)
      if (entry !== undefined) {
        map.delete(k)
        map.set(k, entry)
        stats.hits++
        return entry.value
      }
      stats.misses++
      return undefined
    },
    set: (k, v) => {
      const replaced = map.get(k)
      if (replaced) {
        retainedPoints -= replaced.points
        map.delete(k)
      }
      const points = nfpPointWeight(v)
      if (points > maxPoints) return
      map.set(k, { value: v, points })
      retainedPoints += points
      while (map.size > maxEntries || retainedPoints > maxPoints) {
        const oldest = map.keys().next().value as NfpCacheKey | undefined
        if (oldest === undefined) break
        retainedPoints -= map.get(oldest)!.points
        map.delete(oldest)
      }
    },
    get size() {
      return map.size
    },
    get stats() {
      return { hits: stats.hits, misses: stats.misses }
    },
  }
}
