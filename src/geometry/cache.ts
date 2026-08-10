import type { NfpResult } from './nfp'

export type NfpCacheKey = {
  stationaryPartId: string
  movingPartId: string
  rotationA: number
  rotationB: number
  spacing: number
  geometryVersion: string
  backend?: string
}

function keyString(k: NfpCacheKey): string {
  return [
    k.stationaryPartId,
    k.movingPartId,
    k.rotationA.toFixed(4),
    k.rotationB.toFixed(4),
    k.spacing.toFixed(6),
    k.geometryVersion,
    k.backend ?? '',
  ].join('|')
}

/**
 * Bounded LRU cache for NFP results.
 * Safe across nesting requests: call clearNfpCache() or create a fresh cache per run.
 */
export class NfpCache {
  private map = new Map<string, NfpResult>()
  private order: string[] = []
  hits = 0
  misses = 0
  private readonly maxEntries: number

  constructor(maxEntries = 256) {
    this.maxEntries = maxEntries
  }

  get(key: NfpCacheKey): NfpResult | undefined {
    const ks = keyString(key)
    const v = this.map.get(ks)
    if (v) {
      this.hits++
      // refresh LRU
      const i = this.order.indexOf(ks)
      if (i >= 0) {
        this.order.splice(i, 1)
        this.order.push(ks)
      }
      return v
    }
    this.misses++
    return undefined
  }

  set(key: NfpCacheKey, value: NfpResult): void {
    const ks = keyString(key)
    if (this.map.has(ks)) {
      this.map.set(ks, value)
      const i = this.order.indexOf(ks)
      if (i >= 0) {
        this.order.splice(i, 1)
        this.order.push(ks)
      }
      return
    }
    while (this.order.length >= this.maxEntries) {
      const old = this.order.shift()
      if (old) this.map.delete(old)
    }
    this.map.set(ks, value)
    this.order.push(ks)
  }

  clear(): void {
    this.map.clear()
    this.order = []
    this.hits = 0
    this.misses = 0
  }

  get size(): number {
    return this.map.size
  }

  hitRate(): number {
    const t = this.hits + this.misses
    return t > 0 ? this.hits / t : 0
  }
}

/** Module-level cache for a single nesting run — clear between requests. */
let shared: NfpCache | null = null

export function getSharedNfpCache(): NfpCache {
  if (!shared) shared = new NfpCache(256)
  return shared
}

export function clearSharedNfpCache(): void {
  shared?.clear()
  shared = null
}

export function beginNestingGeometrySession(): NfpCache {
  clearSharedNfpCache()
  shared = new NfpCache(256)
  return shared
}
