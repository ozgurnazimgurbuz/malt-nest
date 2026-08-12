/**
 * Stage 9 fabrication-style fixtures A–J + before/after helper.
 */
import type { GeometryPart } from './types'
import { boundingBox, centroid, netArea } from './ops'
import { runBottomLeftNest } from '../nesting/placement/blf'
import { runAutomaticNest } from '../nesting/optimization/automaticOptimizer'
import type { NestingRequest, NestingSuccess } from '../nesting/types'
import { packedBoundsMm2 } from '../nesting/scoring/fitness'
import { prepareParts } from '../nesting/core/prepare'
import {
  beginBlfProfiling,
  endBlfProfiling,
  getBlfProfileSnapshot,
} from './debug/blfProfiler'

export type FabId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J'

function part(
  id: string,
  index: number,
  outer: { x: number; y: number }[],
  holes: { x: number; y: number }[][] = [],
): GeometryPart {
  const o = { points: outer }
  const h = holes.map((pts) => ({ points: pts }))
  return {
    id,
    sourceElement: 'path',
    originalIndex: index,
    sourceId: null,
    outer: o,
    holes: h,
    boundingBox: boundingBox(outer),
    area: netArea(o, h),
    centroid: centroid(outer),
    originalTransform: null,
  }
}

function rect(w: number, h: number) {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
}

function L(scale = 1) {
  return [
    { x: 0, y: 0 },
    { x: 40 * scale, y: 0 },
    { x: 40 * scale, y: 12 * scale },
    { x: 12 * scale, y: 12 * scale },
    { x: 12 * scale, y: 40 * scale },
    { x: 0, y: 40 * scale },
  ]
}

function C(scale = 1) {
  return [
    { x: 0, y: 0 },
    { x: 40 * scale, y: 0 },
    { x: 40 * scale, y: 12 * scale },
    { x: 12 * scale, y: 12 * scale },
    { x: 12 * scale, y: 28 * scale },
    { x: 40 * scale, y: 28 * scale },
    { x: 40 * scale, y: 40 * scale },
    { x: 0, y: 40 * scale },
  ]
}

function narrow(w: number, h: number) {
  return rect(w, h)
}

export function buildFabFixture(id: FabId): GeometryPart[] {
  switch (id) {
    case 'A': // 10 rectangular panels
      return Array.from({ length: 10 }, (_, i) =>
        part(`A${i}`, i, rect(80 + (i % 3) * 10, 50 + (i % 2) * 15)),
      )
    case 'B': // 20 mixed rectangles
      return Array.from({ length: 20 }, (_, i) =>
        part(`B${i}`, i, rect(30 + (i % 7) * 8, 25 + (i % 5) * 6)),
      )
    case 'C': // 20 irregular signage
      return Array.from({ length: 20 }, (_, i) =>
        part(`C${i}`, i, i % 2 === 0 ? L(0.7 + (i % 3) * 0.1) : C(0.7 + (i % 3) * 0.1)),
      )
    case 'D': // 50 mixed
      return Array.from({ length: 50 }, (_, i) => {
        if (i % 5 === 0) return part(`D${i}`, i, L(0.5))
        if (i % 5 === 1) return part(`D${i}`, i, C(0.5))
        return part(`D${i}`, i, rect(18 + (i % 6) * 4, 14 + (i % 4) * 3))
      })
    case 'E': // 100 small
      return Array.from({ length: 100 }, (_, i) =>
        part(`E${i}`, i, rect(12 + (i % 4), 10 + (i % 3))),
      )
    case 'F': // concave-heavy
      return Array.from({ length: 16 }, (_, i) =>
        part(`F${i}`, i, i % 2 ? L(0.8) : C(0.8)),
      )
    case 'G': // hole-heavy
      return [
        ...Array.from({ length: 4 }, (_, i) =>
          part(
            `Ghost${i}`,
            i,
            rect(90, 70),
            [
              [
                { x: 20, y: 15 },
                { x: 20, y: 50 },
                { x: 55, y: 50 },
                { x: 55, y: 15 },
              ],
            ],
          ),
        ),
        ...Array.from({ length: 8 }, (_, i) =>
          part(`Gfill${i}`, 4 + i, rect(20 + (i % 3) * 2, 18)),
        ),
      ]
    case 'H': // mixed large + small
      return [
        part('Hbig0', 0, rect(160, 110)),
        part('Hbig1', 1, rect(140, 90)),
        part('Hmid', 2, L(1.2)),
        ...Array.from({ length: 12 }, (_, i) =>
          part(`Hs${i}`, 3 + i, rect(16 + (i % 4) * 3, 14 + (i % 3) * 2)),
        ),
      ]
    case 'I': // very narrow
      return Array.from({ length: 15 }, (_, i) =>
        part(`I${i}`, i, narrow(120 + i * 2, 8 + (i % 2))),
      )
    case 'J': // rotated irregular (engine will try angles)
      return Array.from({ length: 12 }, (_, i) =>
        part(`J${i}`, i, L(0.6 + (i % 4) * 0.15)),
      )
  }
}

export type CanonicalMetrics = {
  unplacedCount: number
  placedCount: number
  sheetCountUsed: number
  wasteMm2: number
  utilization: number
  packedBoundsMm2: number
}

export type LegacyBenchmarkRow = CanonicalMetrics & {
  fixtureId: FabId
  preset: 'fast' | 'balanced' | 'deep'
  medianElapsedMs: number
}

export type ChampionSnapshot = {
  elapsedMs: number
  engineId: string
  metrics: CanonicalMetrics
}

export type AutomaticBenchmarkRun = {
  timeline: ChampionSnapshot[]
  firstChampionMs: number
  finalMs: number
  exactReplayMs: number
  finalMetrics: CanonicalMetrics
}

export type FabFixtureBenchmark = {
  id: FabId
  partCount: number
  runs: AutomaticBenchmarkRun[]
  firstChampionMedianMs: number
  finalMedianMs: number
  exactReplayMedianMs: number
  seedWallMs: number
  geometryMs: number
  geometryShare: number
  bestFinalMetrics: CanonicalMetrics
}

export type LegacyComparison = {
  legacy: LegacyBenchmarkRow
  reachedMs: number[]
  automaticMedianMs: number
  deltaMs: number
  pass: boolean
}

export type FabBenchmark = {
  fixtures: FabFixtureBenchmark[]
  comparisons: LegacyComparison[]
}

function requestFor(parts: GeometryPart[], opts?: { partInPart?: boolean }): NestingRequest {
  return {
    parts,
    sheets: [{ widthMm: 500, heightMm: 400, marginMm: 5, quantity: 20 }],
    settings: {
      spacingMm: 2,
      allowedRotations: [0, 90, 180, 270],
      allowArbitraryRotation: false,
      rotationMode: 'orthogonal',
      seed: 9,
      allowPartInPart: opts?.partInPart ?? false,
    },
  }
}

export function canonicalMetrics(result: NestingSuccess): CanonicalMetrics {
  return {
    unplacedCount: result.statistics.unplacedCount,
    placedCount: result.statistics.placedCount,
    sheetCountUsed: result.statistics.sheetCountUsed,
    wasteMm2: result.wasteMm2,
    utilization: result.utilization,
    packedBoundsMm2: packedBoundsMm2(result),
  }
}

/** Benchmark mirror of compareNestingResults; placedCount is report-only. */
export function compareCanonicalMetrics(
  a: CanonicalMetrics,
  b: CanonicalMetrics,
): number {
  if (a.unplacedCount !== b.unplacedCount) {
    return a.unplacedCount - b.unplacedCount
  }
  if (a.sheetCountUsed !== b.sheetCountUsed) {
    return a.sheetCountUsed - b.sheetCountUsed
  }
  if (Math.abs(a.wasteMm2 - b.wasteMm2) > 1e-6) {
    return a.wasteMm2 - b.wasteMm2
  }
  if (Math.abs(a.utilization - b.utilization) > 1e-9) {
    return b.utilization - a.utilization
  }
  if (Math.abs(a.packedBoundsMm2 - b.packedBoundsMm2) > 1e-6) {
    return a.packedBoundsMm2 - b.packedBoundsMm2
  }
  return 0
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

function measureAutomatic(request: NestingRequest): AutomaticBenchmarkRun {
  const startedAt = performance.now()
  const published: Array<{
    elapsedMs: number
    result: NestingSuccess
  }> = []
  const exactDurations: number[] = []
  const result = runAutomaticNest(request, {
    seed: 9,
    onProgress: ({ bestSoFar }) => {
      if (bestSoFar) {
        published.push({
          elapsedMs: performance.now() - startedAt,
          result: bestSoFar,
        })
      }
    },
    onEvaluation: ({ kind, elapsedMs }) => {
      if (kind === 'exact') exactDurations.push(elapsedMs)
    },
  })
  const finalMs = performance.now() - startedAt
  if (result.status !== 'ok') {
    throw new Error('Automatic fabrication benchmark requires a successful nest')
  }

  const timeline: ChampionSnapshot[] = []
  const append = (
    elapsedMs: number,
    champion: NestingSuccess,
  ): void => {
    const point = {
      elapsedMs,
      engineId: champion.engineId,
      metrics: canonicalMetrics(champion),
    }
    const previous = timeline.at(-1)
    if (!previous) {
      timeline.push(point)
      return
    }
    const comparison = compareCanonicalMetrics(point.metrics, previous.metrics)
    if (comparison < 0) timeline.push(point)
    else if (comparison > 0) {
      throw new Error('Automatic benchmark observed a regressing champion')
    }
  }
  for (const point of published) append(point.elapsedMs, point.result)

  const finalMetrics = canonicalMetrics(result)
  const last = timeline.at(-1)
  if (!last || compareCanonicalMetrics(finalMetrics, last.metrics) < 0) {
    append(finalMs, result)
  } else if (compareCanonicalMetrics(finalMetrics, last.metrics) > 0) {
    throw new Error('Automatic benchmark final result regressed from its champion')
  }

  return {
    timeline,
    firstChampionMs: timeline[0]!.elapsedMs,
    finalMs,
    exactReplayMs: exactDurations.reduce((sum, elapsedMs) => sum + elapsedMs, 0),
    finalMetrics,
  }
}

function profileAutomaticSeed(request: NestingRequest): {
  seedWallMs: number
  geometryMs: number
  geometryShare: number
} {
  const preparedParts = prepareParts(request.parts, request.settings, {
    sortByArea: true,
  })
  let seedWallMs = 0
  let snapshot: ReturnType<typeof getBlfProfileSnapshot> | null = null
  beginBlfProfiling()
  try {
    const startedAt = performance.now()
    const result = runBottomLeftNest(request, {
      freeAngleDepth: 'orthogonal',
      nfpFidelity: 'simplified',
      exactFallback: true,
      preparedParts,
      engineId: 'automatic-blf-v1',
    })
    seedWallMs = performance.now() - startedAt
    if (result.status !== 'ok') {
      throw new Error('Profiled automatic seed requires a successful nest')
    }
    snapshot = getBlfProfileSnapshot()
  } finally {
    endBlfProfiling()
  }
  if (!snapshot || !Number.isFinite(seedWallMs) || seedWallMs <= 0) {
    throw new Error('Profiled automatic seed produced invalid timing data')
  }
  const clipperMs = Object.values(snapshot.clipper).reduce(
    (sum, operation) => sum + operation.ms,
    0,
  )
  const geometryMs = clipperMs + snapshot.collisionMs
  return {
    seedWallMs,
    geometryMs,
    geometryShare: geometryMs / seedWallMs,
  }
}

export function runFabBenchmark(
  baseline: readonly LegacyBenchmarkRow[],
): FabBenchmark {
  const ids: FabId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
  const fixtures: FabFixtureBenchmark[] = []
  for (const id of ids) {
    const parts = buildFabFixture(id)
    const request = requestFor(parts, { partInPart: id === 'G' })
    const warmup = runAutomaticNest(request, { seed: 9 })
    if (warmup.status !== 'ok') {
      throw new Error(`Automatic warm-up failed for fixture ${id}`)
    }
    const runs = Array.from({ length: 3 }, () => measureAutomatic(request))
    const profile = profileAutomaticSeed(request)
    const bestFinalMetrics = runs.reduce(
      (best, run) =>
        compareCanonicalMetrics(run.finalMetrics, best) < 0
          ? run.finalMetrics
          : best,
      runs[0]!.finalMetrics,
    )
    fixtures.push({
      id,
      partCount: parts.length,
      runs,
      firstChampionMedianMs: median(runs.map(({ firstChampionMs }) => firstChampionMs)),
      finalMedianMs: median(runs.map(({ finalMs }) => finalMs)),
      exactReplayMedianMs: median(runs.map(({ exactReplayMs }) => exactReplayMs)),
      ...profile,
      bestFinalMetrics,
    })
  }

  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]))
  const comparisons = baseline.map((legacy): LegacyComparison => {
    const fixture = byId.get(legacy.fixtureId)
    if (!fixture) throw new Error(`Missing fixture ${legacy.fixtureId}`)
    const reachedMs = fixture.runs.map((run) =>
      run.timeline.find(
        ({ metrics }) => compareCanonicalMetrics(metrics, legacy) <= 0,
      )?.elapsedMs ?? Number.POSITIVE_INFINITY,
    )
    const allReached = reachedMs.every(Number.isFinite)
    const automaticMedianMs = allReached
      ? median(reachedMs)
      : Number.POSITIVE_INFINITY
    return {
      legacy,
      reachedMs,
      automaticMedianMs,
      deltaMs: automaticMedianMs - legacy.medianElapsedMs,
      pass: allReached && automaticMedianMs <= legacy.medianElapsedMs,
    }
  })
  return { fixtures, comparisons }
}

function formatMs(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)} ms` : 'not reached'
}

function formatMetrics(metrics: CanonicalMetrics): string {
  return `placed=${metrics.placedCount}, unplaced=${metrics.unplacedCount}, sheets=${metrics.sheetCountUsed}, waste=${metrics.wasteMm2.toFixed(2)} mm², util=${(metrics.utilization * 100).toFixed(3)}%, bounds=${metrics.packedBoundsMm2.toFixed(2)} mm²`
}

export function formatAutomaticBenchmarkReport(
  benchmark: FabBenchmark,
  context: { date: string; environment: string },
): string {
  const lines = [
    '# Automatic Anytime Benchmark — After',
    '',
    `Generated ${context.date} on ${context.environment}. Timings are machine-relative and use one warm-up followed by three measured runs per fixture.`,
    '',
    'Geometry share is the raw `(clipper ms + collision ms) / profiled seed wall ms`; it is not clamped and may slightly exceed 100% from instrumentation overhead.',
    '',
    '## Fixture summary',
    '',
    '| Fixture | Parts | First champion median | Final median | Exact replay median | Geometry share | Best final canonical metrics |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
  ]
  for (const fixture of benchmark.fixtures) {
    lines.push(
      `| ${fixture.id} | ${fixture.partCount} | ${formatMs(fixture.firstChampionMedianMs)} | ${formatMs(fixture.finalMedianMs)} | ${formatMs(fixture.exactReplayMedianMs)} | ${(fixture.geometryShare * 100).toFixed(1)}% raw (${fixture.geometryMs.toFixed(1)} / ${fixture.seedWallMs.toFixed(1)} ms) | ${formatMetrics(fixture.bestFinalMetrics)} |`,
    )
  }

  lines.push(
    '',
    '## Legacy time-to-score comparison',
    '',
    '| Fixture | Preset | Legacy median | Automatic median time-to-score | Delta | Pass |',
    '| --- | --- | ---: | ---: | ---: | --- |',
  )
  for (const comparison of benchmark.comparisons) {
    lines.push(
      `| ${comparison.legacy.fixtureId} | ${comparison.legacy.preset} | ${formatMs(comparison.legacy.medianElapsedMs)} | ${formatMs(comparison.automaticMedianMs)} | ${formatMs(comparison.deltaMs)} | ${comparison.pass ? 'PASS' : 'FAIL'} |`,
    )
  }

  lines.push('', '## Champion timelines', '')
  for (const fixture of benchmark.fixtures) {
    const runs = fixture.runs.map((run, index) => {
      const champions = run.timeline
        .map(({ elapsedMs, metrics }) => `${formatMs(elapsedMs)} [${formatMetrics(metrics)}]`)
        .join(' → ')
      return `run ${index + 1}: ${champions} (final ${formatMs(run.finalMs)})`
    })
    lines.push(`- **${fixture.id}** — ${runs.join('; ')}`)
  }

  const passed = benchmark.comparisons.every(({ pass }) => pass)
  lines.push(
    '',
    `**Overall: ${passed ? 'PASS' : 'FAIL'} — ${benchmark.comparisons.filter(({ pass }) => pass).length}/${benchmark.comparisons.length} legacy rows reached within their median time.**`,
    '',
  )
  return lines.join('\n')
}
