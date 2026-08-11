import type { NfpResult } from './nfp'

export type NfpCacheKey = {
  stationaryPartId: string
  movingPartId: string
  rotationA: number
  rotationB: number
  spacing: number
  geometryVersion: string
  backend?: string
  fidelity?: 'simplified' | 'exact'
  tolerance?: number
  /** Exact local-coordinate identity used to reject digest collisions. */
  geometrySignature?: Float64Array
}

function keyString(k: NfpCacheKey): string {
  return [
    k.stationaryPartId,
    k.movingPartId,
    String(k.rotationA),
    String(k.rotationB),
    String(k.spacing),
    k.geometryVersion,
    k.backend ?? '',
    k.fidelity ?? 'simplified',
    (k.tolerance ?? 0).toExponential(),
  ].join('|')
}

/**
 * Bounded LRU cache for NFP results.
 * Safe across nesting requests: call clearNfpCache() or create a fresh cache per run.
 */
export class NfpCache {
  private map = new Map<
    string,
    { value: NfpResult; points: number; geometrySignature?: Float64Array }
  >()
  private cachedPoints = 0
  hits = 0
  misses = 0
  private readonly maxEntries: number
  private readonly maxPoints: number

  // ponytail: point-weighting approximates object memory; switch to measured
  // byte weights only if profiles show this bound is materially inaccurate.
  constructor(maxEntries = 4096, maxPoints = 200_000) {
    if (
      !Number.isSafeInteger(maxEntries) ||
      maxEntries <= 0 ||
      !Number.isSafeInteger(maxPoints) ||
      maxPoints <= 0
    ) {
      throw new RangeError('NFP cache limits must be positive safe integers')
    }
    this.maxEntries = maxEntries
    this.maxPoints = maxPoints
  }

  get(key: NfpCacheKey): NfpResult | undefined {
    const ks = keyString(key)
    const entry = this.map.get(ks)
    if (
      entry &&
      signaturesEqual(entry.geometrySignature, key.geometrySignature)
    ) {
      this.hits++
      this.map.delete(ks)
      this.map.set(ks, entry)
      return entry.value
    }
    this.misses++
    return undefined
  }

  set(key: NfpCacheKey, value: NfpResult): void {
    const ks = keyString(key)
    const existing = this.map.get(ks)
    if (existing) {
      this.cachedPoints -= existing.points
      this.map.delete(ks)
    }
    const points =
      nfpPointCount(value) + Math.ceil((key.geometrySignature?.length ?? 0) / 2)
    this.map.set(ks, {
      value,
      points,
      geometrySignature: key.geometrySignature,
    })
    this.cachedPoints += points
    while (
      this.map.size > this.maxEntries ||
      this.cachedPoints > this.maxPoints
    ) {
      const old = this.map.keys().next().value as string | undefined
      if (old === undefined) break
      this.cachedPoints -= this.map.get(old)?.points ?? 0
      this.map.delete(old)
    }
  }

  clear(): void {
    this.map.clear()
    this.cachedPoints = 0
    this.hits = 0
    this.misses = 0
  }

  get size(): number {
    return this.map.size
  }

  get pointCount(): number {
    return this.cachedPoints
  }

  hitRate(): number {
    const t = this.hits + this.misses
    return t > 0 ? this.hits / t : 0
  }
}

function signaturesEqual(a?: Float64Array, b?: Float64Array): boolean {
  if (!a || !b) return a === b
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false
  }
  return true
}

/** Module-level cache for a single nesting run — clear between requests. */
let shared: NfpCache | null = null

export function getSharedNfpCache(): NfpCache {
  if (!shared) shared = new NfpCache()
  return shared
}

function nfpPointCount(value: NfpResult): number {
  const rings = new Set<unknown>()
  let count = 0
  const add = (points: NfpResult['outer']['points']) => {
    if (rings.has(points)) return
    rings.add(points)
    count += points.length
  }
  for (const region of value.regions) {
    add(region.outer.points)
    for (const hole of region.holes) add(hole.points)
  }
  for (const outer of value.outers) add(outer.points)
  add(value.outer.points)
  return Math.max(1, count)
}

export function clearSharedNfpCache(): void {
  shared?.clear()
  shared = null
}

export function beginNestingGeometrySession(): NfpCache {
  clearSharedNfpCache()
  shared = new NfpCache()
  return shared
}
