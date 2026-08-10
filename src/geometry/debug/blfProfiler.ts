/**
 * BLF performance profiler (Stage 10B) — observability only.
 * Disabled by default; zero cost when off (single boolean check).
 */

export type ClipperOp =
  | 'minkowski'
  | 'offset'
  | 'union'
  | 'difference'
  | 'intersect'
  | 'xor'

export type RotationProfile = {
  rotation: number
  nfpMs: number
  nfpCalls: number
  nfpCacheHits: number
  nfpCacheMisses: number
  candidateGenMs: number
  candidates: number
  collisionMs: number
  collisionCalls: number
  accepted: boolean
  totalMs: number
}

export type PartProfile = {
  index: number
  partId: string
  vertexCount: number
  holeCount: number
  bbox: { w: number; h: number }
  rotationsTried: number
  sheetsTried: number
  candidatesTotal: number
  nfpComputes: number
  nfpCacheHits: number
  nfpCacheMisses: number
  collisionCalls: number
  successfulCandidates: number
  placementMs: number
  placed: boolean
  rotations: RotationProfile[]
}

type ClipperStats = Record<ClipperOp, { calls: number; ms: number }>

type CandidateSourceStats = {
  nfpBoundary: number
  vertexPairs: number
  edgeVertex: number
}

/** One NFP attempt during a profiled BLF run (Stage 10D measure). */
export type NfpKeyAttempt = {
  currentFullKey: string
  idRotKey: string
  localShapeKey: string
  idRotLocalKey: string
  stationaryPartId: string
  movingPartId: string
  rotationA: number
  rotationB: number
  spacing: number
  vertsA: number
  vertsB: number
  ms: number
  cacheHit: boolean
}

let enabled = false
let clipper: ClipperStats = emptyClipper()
let collisionCalls = 0
let collisionMs = 0
let parts: PartProfile[] = []
let activePart: PartProfile | null = null
let activeRot: RotationProfile | null = null
let candidateSources: CandidateSourceStats = {
  nfpBoundary: 0,
  vertexPairs: 0,
  edgeVertex: 0,
}
let nfpKeyAttempts: NfpKeyAttempt[] = []

function emptyClipper(): ClipperStats {
  return {
    minkowski: { calls: 0, ms: 0 },
    offset: { calls: 0, ms: 0 },
    union: { calls: 0, ms: 0 },
    difference: { calls: 0, ms: 0 },
    intersect: { calls: 0, ms: 0 },
    xor: { calls: 0, ms: 0 },
  }
}

export function isBlfProfiling(): boolean {
  return enabled
}

export function beginBlfProfiling(): void {
  enabled = true
  clipper = emptyClipper()
  collisionCalls = 0
  collisionMs = 0
  parts = []
  activePart = null
  activeRot = null
  candidateSources = { nfpBoundary: 0, vertexPairs: 0, edgeVertex: 0 }
  nfpKeyAttempts = []
}

export function endBlfProfiling(): void {
  enabled = false
  activePart = null
  activeRot = null
}

export function blfProfileRecordClipper(op: ClipperOp, ms: number): void {
  if (!enabled) return
  const s = clipper[op]
  s.calls += 1
  s.ms += ms
}

export function blfProfileRecordCollision(ms: number): void {
  if (!enabled) return
  collisionCalls += 1
  collisionMs += ms
  if (activeRot) {
    activeRot.collisionCalls += 1
    activeRot.collisionMs += ms
  }
}

export function blfProfileRecordNfp(opts: {
  ms: number
  cacheHit: boolean
}): void {
  if (!enabled) return
  if (activeRot) {
    activeRot.nfpCalls += 1
    activeRot.nfpMs += opts.ms
    if (opts.cacheHit) activeRot.nfpCacheHits += 1
    else activeRot.nfpCacheMisses += 1
  }
  if (activePart) {
    if (opts.cacheHit) activePart.nfpCacheHits += 1
    else {
      activePart.nfpCacheMisses += 1
      activePart.nfpComputes += 1
    }
  }
}

/** Observability only — does not affect placement. */
export function blfProfileRecordNfpKey(attempt: NfpKeyAttempt): void {
  if (!enabled) return
  nfpKeyAttempts.push(attempt)
}

function tallyKeys(
  attempts: NfpKeyAttempt[],
  pick: (a: NfpKeyAttempt) => string,
): {
  unique: number
  duplicateCalls: number
  duplicateMs: number
  totalMs: number
  top: Array<{ key: string; n: number; ms: number }>
} {
  const map = new Map<string, { n: number; ms: number }>()
  for (const a of attempts) {
    const k = pick(a)
    const cur = map.get(k) ?? { n: 0, ms: 0 }
    cur.n += 1
    cur.ms += a.ms
    map.set(k, cur)
  }
  const top = [...map.entries()]
    .map(([key, v]) => ({ key, n: v.n, ms: v.ms }))
    .sort((a, b) => b.n - a.n || b.ms - a.ms)
  const unique = map.size
  const duplicateCalls = Math.max(0, attempts.length - unique)
  // Time of 2nd+ occurrences (keep 1st compute per key).
  let duplicateMs = 0
  let totalMs = 0
  for (const v of map.values()) {
    totalMs += v.ms
    if (v.n > 1) duplicateMs += v.ms * ((v.n - 1) / v.n)
  }
  return { unique, duplicateCalls, duplicateMs, totalMs, top }
}

export function analyzeNfpKeyAttempts(attempts = nfpKeyAttempts) {
  const total = attempts.length
  const schemes = {
    currentFullKey: tallyKeys(attempts, (a) => a.currentFullKey),
    idRotKey: tallyKeys(attempts, (a) => a.idRotKey),
    localShapeKey: tallyKeys(attempts, (a) => a.localShapeKey),
    idRotLocalKey: tallyKeys(attempts, (a) => a.idRotLocalKey),
  } as const
  const existingHits = attempts.filter((a) => a.cacheHit).length
  return { total, existingHits, schemes }
}

export function formatNfpKeyAnalysisReport(
  attempts = nfpKeyAttempts,
  topN = 12,
): string {
  const { total, existingHits, schemes } = analyzeNfpKeyAttempts(attempts)
  const lines: string[] = [
    '# NFP cache-key analysis (measure only)',
    '',
    `Total NFP attempts recorded: **${total}**`,
    `Existing shared cache hits during run: **${existingHits}** (${total ? ((existingHits / total) * 100).toFixed(1) : 0}%)`,
    '',
  ]

  const describe = (
    name: string,
    note: string,
    s: {
      unique: number
      duplicateCalls: number
      duplicateMs: number
      totalMs: number
      top: Array<{ key: string; n: number; ms: number }>
    },
  ) => {
    const elimPct = total ? (s.duplicateCalls / total) * 100 : 0
    const msPct = s.totalMs > 0 ? (s.duplicateMs / s.totalMs) * 100 : 0
    lines.push(`## Scheme: ${name}`)
    lines.push(note)
    lines.push(`- Unique keys: **${s.unique}**`)
    lines.push(
      `- Duplicate calls (could skip compute if keyed this way): **${s.duplicateCalls}** (${elimPct.toFixed(1)}%)`,
    )
    lines.push(
      `- Theoretical ms saved (2nd+ hits): **${s.duplicateMs.toFixed(0)} ms** (${msPct.toFixed(1)}% of NFP ms)`,
    )
    lines.push(
      `- Theoretical remaining computes: **${s.unique}** (first miss per key)`,
    )
    lines.push('')
    lines.push('| rank | count | ms_sum | key |')
    lines.push('| ---: | ---: | ---: | --- |')
    for (const [i, row] of s.top.slice(0, topN).entries()) {
      const k =
        row.key.length > 100 ? `${row.key.slice(0, 97)}...` : row.key
      lines.push(
        `| ${i + 1} | ${row.n} | ${row.ms.toFixed(0)} | \`${k}\` |`,
      )
    }
    lines.push('')
  }

  describe(
    'currentFullKey',
    'Current production key (part ids + rots + spacing + **world** geometryVersion fingerprints).',
    schemes.currentFullKey,
  )
  describe(
    'idRotKey',
    'Identity only: `stationaryPartId|movingPartId|rotA|rotB|spacing` (no geometry fingerprint).',
    schemes.idRotKey,
  )
  describe(
    'localShapeKey',
    'Translation-normalized shape fingerprints of A & B + spacing (catches identical twins, ignores part ids).',
    schemes.localShapeKey,
  )
  describe(
    'idRotLocalKey',
    'Ids + rots + spacing + translation-normalized local fingerprints (correct relative-NFP key if results stored in local frame).',
    schemes.idRotLocalKey,
  )

  lines.push('## Verdict helper')
  const bestDup = Math.max(
    schemes.currentFullKey.duplicateCalls,
    schemes.idRotKey.duplicateCalls,
    schemes.localShapeKey.duplicateCalls,
    schemes.idRotLocalKey.duplicateCalls,
  )
  const bestPct = total ? (bestDup / total) * 100 : 0
  const bestMs = Math.max(
    schemes.currentFullKey.duplicateMs,
    schemes.idRotKey.duplicateMs,
    schemes.localShapeKey.duplicateMs,
    schemes.idRotLocalKey.duplicateMs,
  )
  if (bestPct < 15) {
    lines.push(
      `Repeat rate max **${bestPct.toFixed(1)}%** (≈**${bestMs.toFixed(0)} ms** savable) → cache is **not** the primary win for this single BLF pass; next bottleneck is per-call Minkowski cost.`,
    )
  } else {
    lines.push(
      `Best scheme eliminates **${bestDup}/${total}** (${bestPct.toFixed(1)}%, ≈${bestMs.toFixed(0)} ms) → cache may help; still check whether keying requires local-frame NFP.`,
    )
  }
  lines.push('')
  return lines.join('\n')
}

export function blfProfileCandidateSource(
  source: keyof CandidateSourceStats,
  count: number,
): void {
  if (!enabled) return
  candidateSources[source] += count
}

export function blfProfileBeginPart(info: {
  index: number
  partId: string
  vertexCount: number
  holeCount: number
  bbox: { w: number; h: number }
}): void {
  if (!enabled) return
  activePart = {
    index: info.index,
    partId: info.partId,
    vertexCount: info.vertexCount,
    holeCount: info.holeCount,
    bbox: info.bbox,
    rotationsTried: 0,
    sheetsTried: 0,
    candidatesTotal: 0,
    nfpComputes: 0,
    nfpCacheHits: 0,
    nfpCacheMisses: 0,
    collisionCalls: 0,
    successfulCandidates: 0,
    placementMs: 0,
    placed: false,
    rotations: [],
  }
  parts.push(activePart)
}

export function blfProfileEndPart(opts: {
  placed: boolean
  placementMs: number
  sheetsTried: number
}): void {
  if (!enabled || !activePart) return
  activePart.placed = opts.placed
  activePart.placementMs = opts.placementMs
  activePart.sheetsTried = opts.sheetsTried
  activePart.collisionCalls = activePart.rotations.reduce(
    (n, r) => n + r.collisionCalls,
    0,
  )
  activePart = null
  activeRot = null
}

export function blfProfileBeginRotation(rotation: number): void {
  if (!enabled || !activePart) return
  activeRot = {
    rotation,
    nfpMs: 0,
    nfpCalls: 0,
    nfpCacheHits: 0,
    nfpCacheMisses: 0,
    candidateGenMs: 0,
    candidates: 0,
    collisionMs: 0,
    collisionCalls: 0,
    accepted: false,
    totalMs: 0,
  }
  activePart.rotationsTried += 1
  activePart.rotations.push(activeRot)
}

export function blfProfileEndRotation(opts: {
  candidates: number
  candidateGenMs: number
  accepted: boolean
  totalMs: number
}): void {
  if (!enabled || !activeRot || !activePart) return
  activeRot.candidates = opts.candidates
  activeRot.candidateGenMs = opts.candidateGenMs
  activeRot.accepted = opts.accepted
  activeRot.totalMs = opts.totalMs
  activePart.candidatesTotal += opts.candidates
  if (opts.accepted) activePart.successfulCandidates += 1
  activeRot = null
}

export function getBlfProfileSnapshot() {
  return {
    parts: parts.map((p) => ({ ...p, rotations: p.rotations.map((r) => ({ ...r })) })),
    clipper: { ...clipper },
    collisionCalls,
    collisionMs,
    candidateSources: { ...candidateSources },
    nfpKeyAttempts: nfpKeyAttempts.slice(),
  }
}

export function formatBlfProfileReport(focusIndex?: number): string {
  const snap = getBlfProfileSnapshot()
  const lines: string[] = ['# BLF Profile Report (Stage 10B)', '']

  const focus =
    focusIndex != null
      ? snap.parts.find((p) => p.index === focusIndex)
      : snap.parts.reduce(
          (a, b) => (!a || b.placementMs > a.placementMs ? b : a),
          null as PartProfile | null,
        )

  if (focus) {
    lines.push(`PART ${focus.index + 1} (${focus.partId})`)
    lines.push(`Vertices: ${focus.vertexCount}`)
    lines.push(`Holes: ${focus.holeCount}`)
    lines.push(
      `BBox: ${focus.bbox.w.toFixed(1)} × ${focus.bbox.h.toFixed(1)} mm`,
    )
    lines.push('')
    for (const r of focus.rotations) {
      lines.push(`ROTATION ${r.rotation}°`)
      lines.push(`NFP: ${r.nfpMs.toFixed(1)} ms (${r.nfpCalls} calls, hit ${r.nfpCacheHits} / miss ${r.nfpCacheMisses})`)
      lines.push(`Candidates: ${r.candidates}`)
      lines.push(
        `Collision: ${r.collisionMs.toFixed(1)} ms (${r.collisionCalls} calls)`,
      )
      lines.push(`Total: ${r.totalMs.toFixed(1)} ms${r.accepted ? ' · ACCEPTED' : ''}`)
      lines.push('')
    }
    const nfpTime = focus.rotations.reduce((s, r) => s + r.nfpMs, 0)
    const candTime = focus.rotations.reduce((s, r) => s + r.candidateGenMs, 0)
    const colTime = focus.rotations.reduce((s, r) => s + r.collisionMs, 0)
    const hits = focus.nfpCacheHits
    const misses = focus.nfpCacheMisses
    const rate = hits + misses > 0 ? hits / (hits + misses) : 0
    lines.push('TOTAL:')
    lines.push(`NFP time: ${nfpTime.toFixed(1)} ms`)
    lines.push(`Candidate generation: ${candTime.toFixed(1)} ms`)
    lines.push(`Collision: ${colTime.toFixed(1)} ms`)
    lines.push(`Placement: ${focus.placementMs.toFixed(1)} ms`)
    lines.push(`Cache hit rate: ${(rate * 100).toFixed(1)}% (${hits} hit / ${misses} miss)`)
    lines.push('')
  }

  lines.push('## All parts (summary)')
  for (const p of snap.parts) {
    lines.push(
      `  #${p.index + 1} ${p.partId} verts=${p.vertexCount} cand=${p.candidatesTotal} place=${p.placementMs.toFixed(0)}ms placed=${p.placed}`,
    )
  }
  lines.push('')
  lines.push('## Clipper ops (run total)')
  for (const op of Object.keys(snap.clipper) as ClipperOp[]) {
    const s = snap.clipper[op]
    if (s.calls === 0) continue
    lines.push(`  ${op}: ${s.calls} calls · ${s.ms.toFixed(1)} ms`)
  }
  lines.push('')
  lines.push(
    `## Collision (run total): ${snap.collisionCalls} calls · ${snap.collisionMs.toFixed(1)} ms`,
  )
  lines.push('')
  lines.push('## Candidate sources (push counts before dedupe)')
  lines.push(`  nfpBoundary: ${snap.candidateSources.nfpBoundary}`)
  lines.push(`  vertexPairs: ${snap.candidateSources.vertexPairs}`)
  lines.push(`  edgeVertex: ${snap.candidateSources.edgeVertex}`)
  lines.push('')

  return lines.join('\n')
}
