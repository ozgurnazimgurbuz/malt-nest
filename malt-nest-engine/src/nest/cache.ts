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

/** Deterministic topology + coordinate fingerprint, intentionally ID-free. */
export function geometryFingerprint(shape: Shape): string {
  return JSON.stringify(
    shape.polygons.map((polygon) => [
      polygon.outer.map((point) => [point.x, point.y]),
      polygon.holes.map((hole) =>
        hole.map((point) => [point.x, point.y]),
      ),
    ]),
  )
}

export type NfpCache<T> = {
  get(key: NfpCacheKey): T | undefined
  set(key: NfpCacheKey, value: T): void
  readonly size: number
  readonly stats: NfpCacheStats
}

const DEFAULT_MAX_NFP_CACHE_ENTRIES = 512

export function createNfpCache<T>(
  maxEntries = DEFAULT_MAX_NFP_CACHE_ENTRIES,
): NfpCache<T> {
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    throw new Error('NFP cache maxEntries must be a positive safe integer')
  }
  const map = new Map<NfpCacheKey, T>()
  const stats: NfpCacheStats = { hits: 0, misses: 0 }
  return {
    get: (k) => {
      const v = map.get(k)
      if (v !== undefined) {
        map.delete(k)
        map.set(k, v)
        stats.hits++
        return v
      }
      stats.misses++
      return undefined
    },
    set: (k, v) => {
      map.delete(k)
      map.set(k, v)
      while (map.size > maxEntries) {
        const oldest = map.keys().next().value as NfpCacheKey | undefined
        if (oldest === undefined) break
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
