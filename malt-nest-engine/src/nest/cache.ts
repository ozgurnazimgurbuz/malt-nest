import { canonicalizeAngle } from '../rotation/angle'
import type { AnglePrecision } from '../rotation/types'
import { DEFAULT_ANGLE_PRECISION } from '../rotation/types'

/**
 * Session NFP cache. Key includes canonical angles + gap + kind + ids.
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
}): NfpCacheKey {
  const prec = parts.precision ?? DEFAULT_ANGLE_PRECISION
  return [
    parts.kind,
    parts.stationaryId,
    parts.orbitingId,
    canonicalizeAngle(parts.rotationStationaryDeg, prec),
    canonicalizeAngle(parts.rotationOrbitingDeg, prec),
    parts.gap,
  ].join('|')
}

export type NfpCache<T> = {
  get(key: NfpCacheKey): T | undefined
  set(key: NfpCacheKey, value: T): void
  readonly size: number
  readonly stats: NfpCacheStats
}

export function createNfpCache<T>(): NfpCache<T> {
  const map = new Map<NfpCacheKey, T>()
  const stats: NfpCacheStats = { hits: 0, misses: 0 }
  return {
    get: (k) => {
      const v = map.get(k)
      if (v !== undefined) {
        stats.hits++
        return v
      }
      stats.misses++
      return undefined
    },
    set: (k, v) => {
      map.set(k, v)
    },
    get size() {
      return map.size
    },
    get stats() {
      return { hits: stats.hits, misses: stats.misses }
    },
  }
}
