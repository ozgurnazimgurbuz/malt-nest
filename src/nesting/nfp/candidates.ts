import type { Point } from '../../geometry'
import {
  computeNfp,
  GEOMETRY_BACKEND_ID,
  getSharedNfpCache,
  nfpBoundaryTranslations,
  solidFingerprint,
  type Solid,
} from '../../geometry'
import type { PreparedVariant } from '../core/prepare'
import {
  blfProfileCandidateSource,
  blfProfileRecordNfp,
  blfProfileRecordNfpKey,
  isBlfProfiling,
} from '../../geometry/debug/blfProfiler'
import {
  compareByPackBias,
  resolvePackBias,
  type PackBias,
} from '../placement/packBias'

export type Translation = { x: number; y: number }

/** Translation-normalized shape hash (measure / future local-frame cache key). */
function localSolidFingerprint(solid: Solid): string {
  let minX = Infinity
  let minY = Infinity
  for (const p of solid.outer.points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
  }
  for (const h of solid.holes) {
    for (const p of h.points) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0
    minY = 0
  }
  const parts: number[] = [solid.outer.points.length, solid.holes.length]
  for (const p of solid.outer.points) {
    parts.push(Math.round((p.x - minX) * 1e4), Math.round((p.y - minY) * 1e4))
  }
  for (const h of solid.holes) {
    parts.push(h.points.length)
    for (const p of h.points) {
      parts.push(Math.round((p.x - minX) * 1e4), Math.round((p.y - minY) * 1e4))
    }
  }
  let hash = 2166136261
  for (const n of parts) {
    hash ^= n >>> 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

/**
 * NFP-derived contact translations for orbiting B relative to stationary A.
 */
export function nfpCandidateTranslations(
  placed: Solid,
  orbitingLocal: Solid,
  spacingMm: number,
  cacheIds?: {
    stationaryPartId: string
    movingPartId: string
    rotationA: number
    rotationB: number
  },
): Translation[] {
  const out: Translation[] = []
  const seen = new Set<string>()
  const profiling = isBlfProfiling()
  let boundaryPushes = 0
  let vertexPushes = 0
  let edgePushes = 0

  const push = (x: number, y: number, source?: 'nfpBoundary' | 'vertexPairs' | 'edgeVertex') => {
    const key = `${x.toFixed(5)},${y.toFixed(5)}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ x, y })
    if (profiling && source) {
      if (source === 'nfpBoundary') boundaryPushes++
      else if (source === 'vertexPairs') vertexPushes++
      else edgePushes++
    }
  }

  const aOuter = placed.outer.points
  const bOuter = orbitingLocal.outer.points
  if (aOuter.length === 0 || bOuter.length === 0) return out

  const spacing = Math.max(0, spacingMm)
  const cache = getSharedNfpCache()
  const geometryVersion = `${solidFingerprint(placed)}:${solidFingerprint(orbitingLocal)}`
  const stationaryPartId = cacheIds?.stationaryPartId ?? geometryVersion.slice(0, 8)
  const movingPartId = cacheIds?.movingPartId ?? geometryVersion.slice(8, 16)
  const rotationA = cacheIds?.rotationA ?? 0
  const rotationB = cacheIds?.rotationB ?? 0
  const key = {
    stationaryPartId,
    movingPartId,
    rotationA,
    rotationB,
    spacing,
    geometryVersion,
    backend: GEOMETRY_BACKEND_ID,
  }

  let nfp = cache.get(key)
  const cacheHit = !!nfp
  const tNfp = performance.now()
  if (!nfp) {
    nfp = computeNfp(placed, orbitingLocal, spacing)
    cache.set(key, nfp)
  }
  const nfpMs = performance.now() - tNfp
  if (profiling) {
    blfProfileRecordNfp({
      ms: nfpMs,
      cacheHit,
    })
    const localA = localSolidFingerprint(placed)
    const localB = localSolidFingerprint(orbitingLocal)
    const idRotKey = [
      stationaryPartId,
      movingPartId,
      rotationA.toFixed(4),
      rotationB.toFixed(4),
      spacing.toFixed(6),
    ].join('|')
    const localShapeKey = `${localA}|${localB}|${spacing.toFixed(6)}`
    const idRotLocalKey = `${idRotKey}|${localA}|${localB}`
    const currentFullKey = [
      stationaryPartId,
      movingPartId,
      rotationA.toFixed(4),
      rotationB.toFixed(4),
      spacing.toFixed(6),
      geometryVersion,
      GEOMETRY_BACKEND_ID,
    ].join('|')
    blfProfileRecordNfpKey({
      currentFullKey,
      idRotKey,
      localShapeKey,
      idRotLocalKey,
      stationaryPartId,
      movingPartId,
      rotationA,
      rotationB,
      spacing,
      vertsA: aOuter.length,
      vertsB: bOuter.length,
      ms: nfpMs,
      cacheHit,
    })
  }
  for (const t of nfpBoundaryTranslations(nfp)) {
    push(t.x, t.y, 'nfpBoundary')
  }
  const boundaryUnique = out.length

  // Sample vertex pairs on dense rings (NFP boundary already covers contacts).
  const sampleCap = 24
  const stepA = Math.max(1, Math.ceil(aOuter.length / sampleCap))
  const stepB = Math.max(1, Math.ceil(bOuter.length / sampleCap))
  for (let i = 0; i < aOuter.length; i += stepA) {
    const a = aOuter[i]!
    for (let j = 0; j < bOuter.length; j += stepB) {
      const b = bOuter[j]!
      push(a.x - b.x, a.y - b.y, 'vertexPairs')
    }
  }
  // ponytail: Stage 10B — full edge×vertex was ~93% of candidates / multi-second BLF stalls.
  // Skip edge flood when NFP boundary already provides dense contacts; else subsample ≤24×24.
  if (boundaryUnique < 64) {
    addEdgeVertexContacts(
      aOuter,
      bOuter,
      spacing,
      (x, y) => push(x, y, 'edgeVertex'),
      false,
      sampleCap,
    )
    addEdgeVertexContacts(
      bOuter,
      aOuter,
      spacing,
      (x, y) => push(x, y, 'edgeVertex'),
      true,
      sampleCap,
    )
  }
  if (profiling) {
    blfProfileCandidateSource('nfpBoundary', boundaryPushes)
    blfProfileCandidateSource('vertexPairs', vertexPushes)
    blfProfileCandidateSource('edgeVertex', edgePushes)
  }

  return out
}

function ringEdges(points: Point[]): Array<{ a: Point; b: Point; nx: number; ny: number }> {
  const edges: Array<{ a: Point; b: Point; nx: number; ny: number }> = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const nx = dy / len
    const ny = -dx / len
    edges.push({ a, b, nx, ny })
  }
  return edges
}

function addEdgeVertexContacts(
  edgeRing: Point[],
  vertexRing: Point[],
  spacing: number,
  push: (x: number, y: number) => void,
  invert: boolean,
  sampleCap = 24,
): void {
  const edges = ringEdges(edgeRing)
  const stepE = Math.max(1, Math.ceil(edges.length / sampleCap))
  const stepV = Math.max(1, Math.ceil(vertexRing.length / sampleCap))
  for (let ei = 0; ei < edges.length; ei += stepE) {
    const e = edges[ei]!
    for (let vi = 0; vi < vertexRing.length; vi += stepV) {
      const v = vertexRing[vi]!
      if (!invert) {
        push(e.a.x - v.x, e.a.y - v.y)
        push(e.b.x - v.x, e.b.y - v.y)
        if (spacing > 0) {
          push(e.a.x - v.x + e.nx * spacing, e.a.y - v.y + e.ny * spacing)
          push(e.b.x - v.x + e.nx * spacing, e.b.y - v.y + e.ny * spacing)
        }
      } else {
        push(v.x - e.a.x, v.y - e.a.y)
        push(v.x - e.b.x, v.y - e.b.y)
        if (spacing > 0) {
          push(v.x - e.a.x - e.nx * spacing, v.y - e.a.y - e.ny * spacing)
          push(v.x - e.b.x - e.nx * spacing, v.y - e.b.y - e.ny * spacing)
        }
      }
    }
  }
}

export function clampToIfp(
  t: Translation,
  ifp: { minX: number; minY: number; maxX: number; maxY: number },
): Translation {
  return {
    x: Math.min(ifp.maxX, Math.max(ifp.minX, t.x)),
    y: Math.min(ifp.maxY, Math.max(ifp.minY, t.y)),
  }
}

export function collectPlacementCandidates(
  variant: PreparedVariant,
  placedSolids: Solid[],
  ifp: { minX: number; minY: number; maxX: number; maxY: number },
  spacingMm: number,
  placedMeta?: Array<{ partId: string; rotation: number }>,
  signal?: AbortSignal,
  packBias?: Partial<PackBias> | null,
): Translation[] {
  const list: Translation[] = []
  const seen = new Set<string>()
  const add = (t: Translation) => {
    const c = clampToIfp(t, ifp)
    const key = `${c.x.toFixed(5)},${c.y.toFixed(5)}`
    if (seen.has(key)) return
    seen.add(key)
    list.push(c)
  }

  add({ x: ifp.minX, y: ifp.minY })
  add({ x: ifp.minX, y: ifp.maxY })
  add({ x: ifp.maxX, y: ifp.minY })

  for (let i = 0; i < placedSolids.length; i++) {
    if (signal?.aborted) break
    const placed = placedSolids[i]!
    const meta = placedMeta?.[i]
    for (const t of nfpCandidateTranslations(placed, variant.solid, spacingMm, {
      stationaryPartId: meta?.partId ?? `placed-${i}`,
      movingPartId: variant.partId,
      rotationA: meta?.rotation ?? 0,
      rotationB: variant.rotation,
    })) {
      add(t)
    }
  }

  const bias = resolvePackBias(packBias)
  list.sort((a, b) =>
    compareByPackBias(a, b, bias, { minX: ifp.minX, minY: ifp.minY }),
  )
  return list
}
