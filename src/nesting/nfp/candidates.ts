import type { Point } from '../../geometry'
import {
  computeNfp,
  findPartInPartPlacements,
  GEOMETRY_BACKEND_ID,
  geomEps,
  getSharedNfpCache,
  nfpBoundaryTranslations,
  translateSolid,
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
export type TranslationSegment = { a: Translation; b: Translation }

function localSolidIdentity(solid: Solid): {
  source: Solid
  x: number
  y: number
  fingerprint: string
  signature: Float64Array
} {
  const x = solid.bounds.minX
  const y = solid.bounds.minY
  const identity = solidDigest(solid, x, y)
  return {
    source: solid,
    x,
    y,
    fingerprint: identity.fingerprint,
    signature: identity.signature,
  }
}

/** Fixed-size digest plus exact coordinate signature for collision-safe cache hits. */
function solidDigest(
  solid: Solid,
  offsetX: number,
  offsetY: number,
): { fingerprint: string; signature: Float64Array } {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  const bytes = new DataView(new ArrayBuffer(8))
  const coordinateCount =
    solid.outer.points.length +
    solid.holes.reduce((sum, hole) => sum + hole.points.length, 0)
  const signature = new Float64Array(
    2 + solid.holes.length + coordinateCount * 2,
  )
  let signatureIndex = 0
  const word = (value: number) => {
    a = Math.imul(a ^ (value >>> 0), 0x01000193)
    b = Math.imul(b ^ (value >>> 0), 0x85ebca6b)
    b ^= b >>> 13
  }
  const number = (value: number) => {
    signature[signatureIndex++] = value
    bytes.setFloat64(0, value)
    word(bytes.getUint32(0))
    word(bytes.getUint32(4))
  }
  const ring = (points: Point[]) => {
    number(points.length)
    for (const point of points) {
      number(point.x - offsetX)
      number(point.y - offsetY)
    }
  }
  ring(solid.outer.points)
  number(solid.holes.length)
  for (const hole of solid.holes) ring(hole.points)
  return {
    fingerprint: `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`,
    signature,
  }
}

function pairSignature(a: Float64Array, b: Float64Array): Float64Array {
  const signature = new Float64Array(1 + a.length + b.length)
  signature[0] = a.length
  signature.set(a, 1)
  signature.set(b, 1 + a.length)
  return signature
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
    fidelity?: 'simplified' | 'exact'
  },
  signal?: AbortSignal,
  boundarySegments?: TranslationSegment[],
  deadline?: { expired(): boolean },
): Translation[] {
  const out: Translation[] = []
  const seen = new Set<string>()
  const profiling = isBlfProfiling()
  let boundaryPushes = 0
  let vertexPushes = 0
  let edgePushes = 0
  const eps = geomEps()

  const push = (x: number, y: number, source?: 'nfpBoundary' | 'vertexPairs' | 'edgeVertex') => {
    const key = `${Math.round(x / eps)},${Math.round(y / eps)}`
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
  if (
    aOuter.length === 0 ||
    bOuter.length === 0 ||
    signal?.aborted === true ||
    deadline?.expired() === true
  ) return out

  const spacing = Math.max(0, spacingMm)
  const cache = getSharedNfpCache()
  const localA = localSolidIdentity(placed)
  const localB = localSolidIdentity(orbitingLocal)
  const geometryVersion = `${localA.fingerprint}:${localB.fingerprint}`
  const stationaryPartId = localA.fingerprint
  const movingPartId = localB.fingerprint
  const rotationA = cacheIds?.rotationA ?? 0
  const rotationB = cacheIds?.rotationB ?? 0
  const fidelity = cacheIds?.fidelity ?? 'simplified'
  const tolerance = geomEps()
  const key = {
    stationaryPartId,
    movingPartId,
    rotationA,
    rotationB,
    spacing,
    geometryVersion,
    backend: GEOMETRY_BACKEND_ID,
    fidelity,
    tolerance,
    geometrySignature: pairSignature(localA.signature, localB.signature),
  }

  let nfp = cache.get(key)
  const cacheHit = !!nfp
  const tNfp = performance.now()
  if (!nfp) {
    nfp = computeNfp(
      translateSolid(localA.source, -localA.x, -localA.y),
      translateSolid(localB.source, -localB.x, -localB.y),
      spacing,
      { fidelity },
    )
    cache.set(key, nfp)
  }
  const nfpMs = performance.now() - tNfp
  if (profiling) {
    blfProfileRecordNfp({
      ms: nfpMs,
      cacheHit,
    })
    const localAFingerprint = localA.fingerprint
    const localBFingerprint = localB.fingerprint
    const diagnosticStationaryId =
      cacheIds?.stationaryPartId ?? localAFingerprint
    const diagnosticMovingId = cacheIds?.movingPartId ?? localBFingerprint
    const idRotKey = [
      diagnosticStationaryId,
      diagnosticMovingId,
      rotationA.toFixed(4),
      rotationB.toFixed(4),
      spacing.toFixed(6),
    ].join('|')
    const localShapeKey = `${localAFingerprint}|${localBFingerprint}|${spacing.toFixed(6)}`
    const idRotLocalKey = `${idRotKey}|${localAFingerprint}|${localBFingerprint}`
    const currentFullKey = [
      stationaryPartId,
      movingPartId,
      rotationA.toFixed(4),
      rotationB.toFixed(4),
      spacing.toFixed(6),
      geometryVersion,
      GEOMETRY_BACKEND_ID,
      fidelity,
      tolerance.toExponential(),
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
  const poseX = localA.x - localB.x
  const poseY = localA.y - localB.y
  if (boundarySegments) {
    for (const region of nfp.regions) {
      if (signal?.aborted || deadline?.expired()) break
      for (const ring of [region.outer, ...region.holes]) {
        for (let i = 0; i < ring.points.length; i++) {
          const a = ring.points[i]!
          const b = ring.points[(i + 1) % ring.points.length]!
          boundarySegments.push({
            a: { x: a.x + poseX, y: a.y + poseY },
            b: { x: b.x + poseX, y: b.y + poseY },
          })
        }
      }
    }
  }
  for (const t of nfpBoundaryTranslations(nfp)) {
    if (signal?.aborted || deadline?.expired()) break
    push(t.x + poseX, t.y + poseY, 'nfpBoundary')
  }
  const boundaryUnique = out.length

  // NFP outers alone cannot reveal the inverse case where the moving part is
  // a frame placed around an already-stationary part inside one of its holes.
  for (const fit of findPartInPartPlacements(
    orbitingLocal,
    placed,
    spacing,
    [],
    signal,
  )) {
    if (signal?.aborted || deadline?.expired()) break
    if (fit.translation) {
      push(-fit.translation.x, -fit.translation.y, 'nfpBoundary')
    }
  }

  // Sample vertex pairs on dense rings (NFP boundary already covers contacts).
  const sampleCap = 24
  const stepA = Math.max(1, Math.ceil(aOuter.length / sampleCap))
  const stepB = Math.max(1, Math.ceil(bOuter.length / sampleCap))
  for (let i = 0; i < aOuter.length; i += stepA) {
    if (signal?.aborted || deadline?.expired()) break
    const a = aOuter[i]!
    for (let j = 0; j < bOuter.length; j += stepB) {
      if (signal?.aborted || deadline?.expired()) break
      const b = bOuter[j]!
      push(a.x - b.x, a.y - b.y, 'vertexPairs')
    }
  }
  // ponytail: Stage 10B — full edge×vertex was ~93% of candidates / multi-second BLF stalls.
  // Skip edge flood when NFP boundary already provides dense contacts; else subsample ≤24×24.
  if (boundaryUnique < 64) {
    if (signal?.aborted || deadline?.expired()) return out
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

function boundaryIntersection(
  first: TranslationSegment,
  second: TranslationSegment,
): Translation | null {
  const rx = first.b.x - first.a.x
  const ry = first.b.y - first.a.y
  const sx = second.b.x - second.a.x
  const sy = second.b.y - second.a.y
  const denominator = rx * sy - ry * sx
  const firstLength = Math.hypot(rx, ry)
  const secondLength = Math.hypot(sx, sy)
  const eps = geomEps()
  if (
    firstLength <= eps ||
    secondLength <= eps ||
    Math.abs(denominator) <= eps * Math.max(firstLength, secondLength)
  ) {
    return null
  }
  const qx = second.a.x - first.a.x
  const qy = second.a.y - first.a.y
  const t = (qx * sy - qy * sx) / denominator
  const u = (qx * ry - qy * rx) / denominator
  const tTolerance = eps / firstLength
  const uTolerance = eps / secondLength
  if (
    t < -tTolerance ||
    t > 1 + tTolerance ||
    u < -uTolerance ||
    u > 1 + uTolerance
  ) {
    return null
  }
  return { x: first.a.x + t * rx, y: first.a.y + t * ry }
}

function crossObstacleBoundaryIntersections(
  groups: TranslationSegment[][],
  signal?: AbortSignal,
  deadline?: { expired(): boolean },
): Translation[] {
  type SweepSegment = TranslationSegment & {
    owner: number
    minX: number
    maxX: number
    minY: number
    maxY: number
  }
  const segments: SweepSegment[] = groups.flatMap((group, owner) =>
    group.map((segment) => ({
      ...segment,
      owner,
      minX: Math.min(segment.a.x, segment.b.x),
      maxX: Math.max(segment.a.x, segment.b.x),
      minY: Math.min(segment.a.y, segment.b.y),
      maxY: Math.max(segment.a.y, segment.b.y),
    })),
  )
  segments.sort((a, b) => a.minX - b.minX || a.minY - b.minY)
  let active: SweepSegment[] = []
  const intersections: Translation[] = []
  const eps = geomEps()
  let comparisons = 0
  for (const segment of segments) {
    if (
      (comparisons & 255) === 0 &&
      (signal?.aborted || deadline?.expired())
    ) break
    active = active.filter((candidate) => candidate.maxX >= segment.minX - eps)
    for (const candidate of active) {
      if (candidate.owner === segment.owner) continue
      if (
        candidate.maxY < segment.minY - eps ||
        segment.maxY < candidate.minY - eps
      ) {
        continue
      }
      comparisons += 1
      const point = boundaryIntersection(candidate, segment)
      if (point) intersections.push(point)
    }
    active.push(segment)
  }
  return intersections
}

export function collectPlacementCandidates(
  variant: PreparedVariant,
  placedSolids: Solid[],
  ifp: { minX: number; minY: number; maxX: number; maxY: number },
  spacingMm: number,
  placedMeta?: Array<{ partId: string; rotation: number }>,
  signal?: AbortSignal,
  packBias?: Partial<PackBias> | null,
  exactNfp = false,
  deadline?: { expired(): boolean },
): Translation[] {
  const list: Translation[] = []
  const seen = new Set<string>()
  const boundaryGroups: TranslationSegment[][] = []
  const eps = geomEps()
  const add = (t: Translation) => {
    const c = clampToIfp(t, ifp)
    const key = `${Math.round(c.x / eps)},${Math.round(c.y / eps)}`
    if (seen.has(key)) return
    seen.add(key)
    list.push(c)
  }

  add({ x: ifp.minX, y: ifp.minY })
  add({ x: ifp.minX, y: ifp.maxY })
  add({ x: ifp.maxX, y: ifp.minY })

  for (let i = 0; i < placedSolids.length; i++) {
    if (signal?.aborted || deadline?.expired()) break
    const placed = placedSolids[i]!
    const meta = placedMeta?.[i]
    const boundarySegments: TranslationSegment[] = []
    for (const t of nfpCandidateTranslations(
      placed,
      variant.solid,
      spacingMm,
      {
        stationaryPartId: meta?.partId ?? `placed-${i}`,
        movingPartId: variant.partId,
        rotationA: meta?.rotation ?? 0,
        rotationB: variant.rotation,
        fidelity: exactNfp ? 'exact' : 'simplified',
      },
      signal,
      exactNfp ? boundarySegments : undefined,
      deadline,
    )) {
      add(t)
    }
    if (exactNfp) boundaryGroups.push(boundarySegments)
  }

  if (exactNfp && boundaryGroups.length > 1) {
    for (const point of crossObstacleBoundaryIntersections(
      boundaryGroups,
      signal,
      deadline,
    )) {
      add(point)
    }
  }

  const bias = resolvePackBias(packBias)
  list.sort((a, b) =>
    compareByPackBias(a, b, bias, { minX: ifp.minX, minY: ifp.minY }),
  )
  return list
}
