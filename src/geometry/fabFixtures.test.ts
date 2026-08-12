import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canonicalMetrics,
  compareCanonicalMetrics,
  formatAutomaticBenchmarkReport,
  runFabBenchmark,
  type CanonicalMetrics,
  type LegacyBenchmarkRow,
} from './fabFixtures'
import {
  compareNestingResults,
  packedBoundsMm2,
} from '../nesting/scoring/fitness'
import type { NestingSuccess } from '../nesting/types'

const BASELINE_PATH = resolve(
  __dirname,
  '../../docs/benchmarks/automatic-anytime-baseline.json',
)
const REPORT_PATH = resolve(
  __dirname,
  '../../docs/benchmarks/automatic-anytime-after.md',
)
const FIXTURE_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const
const PRESETS = ['fast', 'balanced', 'deep'] as const
const RUN_AUTOMATIC_BENCHMARK =
  process.env.RUN_AUTOMATIC_BENCHMARK === '1'
const benchmarkIt = RUN_AUTOMATIC_BENCHMARK ? it : it.skip
const BASELINE_KEYS = [
  'fixtureId',
  'preset',
  'medianElapsedMs',
  'unplacedCount',
  'placedCount',
  'sheetCountUsed',
  'wasteMm2',
  'utilization',
  'packedBoundsMm2',
] as const

function readValidatedBaseline(): LegacyBenchmarkRow[] {
  const parsed: unknown = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  expect(Array.isArray(parsed)).toBe(true)
  if (!Array.isArray(parsed)) return []
  expect(parsed).toHaveLength(30)

  const rows = parsed as Array<Record<string, unknown>>
  for (const row of rows) {
    expect(Object.keys(row).sort()).toEqual([...BASELINE_KEYS].sort())
    expect(FIXTURE_IDS).toContain(row.fixtureId)
    expect(PRESETS).toContain(row.preset)
    for (const field of BASELINE_KEYS.slice(2)) {
      expect(Number.isFinite(row[field]), `${String(row.fixtureId)} ${String(row.preset)} ${field}`).toBe(true)
    }
  }

  const expected = FIXTURE_IDS.flatMap((id) =>
    PRESETS.map((preset) => `${id}:${preset}`),
  )
  const actual = rows.map((row) => `${String(row.fixtureId)}:${String(row.preset)}`)
  expect(new Set(actual)).toEqual(new Set(expected))
  expect(actual).toHaveLength(new Set(actual).size)
  return rows as LegacyBenchmarkRow[]
}

function fakeSuccess(
  values: Partial<CanonicalMetrics> = {},
): NestingSuccess {
  const metrics: CanonicalMetrics = {
    unplacedCount: 0,
    placedCount: 4,
    sheetCountUsed: 1,
    wasteMm2: 100,
    utilization: 0.5,
    packedBoundsMm2: 100,
    ...values,
  }
  return {
    status: 'ok',
    placements: [],
    sheets: [{
      sheetIndex: 0,
      widthMm: 100,
      heightMm: 100,
      placedCount: metrics.placedCount,
      utilization: metrics.utilization,
      wasteMm2: metrics.wasteMm2,
      usedBounds: {
        minX: 0,
        minY: 0,
        maxX: metrics.packedBoundsMm2,
        maxY: 1,
      },
    }],
    unplacedPartIds: [],
    utilization: metrics.utilization,
    wasteMm2: metrics.wasteMm2,
    calculationTimeMs: 0,
    statistics: {
      partCount: metrics.placedCount + metrics.unplacedCount,
      placedCount: metrics.placedCount,
      unplacedCount: metrics.unplacedCount,
      sheetCountUsed: metrics.sheetCountUsed,
      totalPartAreaMm2: 0,
      totalSheetAreaMm2: 0,
      overallUtilization: metrics.utilization,
      overallWasteMm2: metrics.wasteMm2,
    },
    engineId: 'fixture',
  }
}

describe.sequential('automatic anytime fabrication benchmark', () => {
  it('validates the exact A–J × legacy-preset baseline matrix', () => {
    readValidatedBaseline()
  })

  it('keeps benchmark canonical comparison in parity with production', () => {
    const pairs: Array<[NestingSuccess, NestingSuccess]> = [
      [fakeSuccess(), fakeSuccess({ unplacedCount: 1, placedCount: 3 })],
      [fakeSuccess(), fakeSuccess({ sheetCountUsed: 2 })],
      [fakeSuccess(), fakeSuccess({ wasteMm2: 100 + 2e-6 })],
      [fakeSuccess(), fakeSuccess({ utilization: 0.5 - 2e-9 })],
      [fakeSuccess(), fakeSuccess({ packedBoundsMm2: 100 + 2e-6 })],
      [fakeSuccess(), fakeSuccess({ wasteMm2: 100 + 0.5e-6 })],
      [fakeSuccess(), fakeSuccess({ utilization: 0.5 - 0.5e-9 })],
      [fakeSuccess(), fakeSuccess({ packedBoundsMm2: 100 + 0.5e-6 })],
    ]

    for (const [a, b] of pairs) {
      expect(canonicalMetrics(a).packedBoundsMm2).toBe(packedBoundsMm2(a))
      expect(
        Math.sign(compareCanonicalMetrics(canonicalMetrics(a), canonicalMetrics(b))),
      ).toBe(Math.sign(compareNestingResults(a, b)))
    }
  })

  benchmarkIt('beats every legacy time-to-score row across three measured runs', () => {
    const baseline = readValidatedBaseline()
    const benchmark = runFabBenchmark(baseline)

    expect(benchmark.fixtures).toHaveLength(10)
    expect(benchmark.comparisons).toHaveLength(30)
    for (const fixture of benchmark.fixtures) {
      expect(fixture.runs).toHaveLength(3)
      expect(Number.isFinite(fixture.geometryShare)).toBe(true)
      expect(fixture.geometryShare).toBeGreaterThanOrEqual(0)
      for (const run of fixture.runs) {
        expect(run.timeline.length).toBeGreaterThan(0)
        expect(run.timeline[0]?.engineId).toBe('automatic-blf-v1')
        expect(run.firstChampionMs).toBeLessThanOrEqual(run.finalMs)
        expect(Number.isFinite(run.exactReplayMs)).toBe(true)
        expect(run.exactReplayMs).toBeGreaterThanOrEqual(0)
        expect(run.exactReplayMs).toBeLessThanOrEqual(run.finalMs + 5)
        for (let i = 1; i < run.timeline.length; i++) {
          const previous = run.timeline[i - 1]!
          const current = run.timeline[i]!
          expect(current.elapsedMs).toBeGreaterThanOrEqual(previous.elapsedMs)
          expect(compareCanonicalMetrics(current.metrics, previous.metrics)).toBeLessThan(0)
        }
      }
    }

    const failures = benchmark.comparisons
      .filter(({ pass }) => !pass)
      .map((comparison) => {
        const fixture = benchmark.fixtures.find(
          ({ id }) => id === comparison.legacy.fixtureId,
        )!
        return {
          fixture: comparison.legacy.fixtureId,
          preset: comparison.legacy.preset,
          legacyMedianMs: comparison.legacy.medianElapsedMs,
          targetPackedBoundsMm2: comparison.legacy.packedBoundsMm2,
          reachedMs: comparison.reachedMs.map((elapsedMs) =>
            Number.isFinite(elapsedMs) ? elapsedMs : 'missing',
          ),
          automaticFinalMedianMs: fixture.finalMedianMs,
          automaticBestPackedBoundsMm2:
            fixture.bestFinalMetrics.packedBoundsMm2,
          timelines: fixture.runs.map(({ timeline }) =>
            timeline.map(({ elapsedMs, metrics }) => ({
              elapsedMs,
              packedBoundsMm2: metrics.packedBoundsMm2,
            })),
          ),
        }
      })
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([])

    for (const comparison of benchmark.comparisons) {
      expect(comparison.reachedMs).toHaveLength(3)
      expect(comparison.reachedMs.every(Number.isFinite)).toBe(true)
      expect(comparison.automaticMedianMs).toBeLessThanOrEqual(
        comparison.legacy.medianElapsedMs,
      )
      expect(comparison.pass).toBe(true)
      const fixture = benchmark.fixtures.find(
        ({ id }) => id === comparison.legacy.fixtureId,
      )!
      for (const run of fixture.runs) {
        expect(compareCanonicalMetrics(run.finalMetrics, comparison.legacy)).toBeLessThanOrEqual(0)
        expect(run.finalMetrics.placedCount).toBeGreaterThanOrEqual(
          comparison.legacy.placedCount,
        )
        expect(run.finalMetrics.sheetCountUsed).toBeLessThanOrEqual(
          comparison.legacy.sheetCountUsed,
        )
      }
    }

    const report = formatAutomaticBenchmarkReport(benchmark, {
      date: new Date().toISOString().slice(0, 10),
      environment: `${process.platform}/${process.arch}, Node ${process.version}`,
    })
    expect(report).toContain('## Fixture summary')
    expect(report).toContain('## Legacy time-to-score comparison')
    expect(report).toContain('## Champion timelines')
    expect(report).toContain('**Overall: PASS')
    expect(report).not.toMatch(/TBD|NaN|Infinity/)
    expect(report).not.toMatch(/\|[ \t]*\|/)
    expect(
      report.match(/^\| [A-J] \| \d+ \|/gm),
    ).toHaveLength(10)
    expect(
      report.match(/^\| [A-J] \| (?:fast|balanced|deep) \|/gm),
    ).toHaveLength(30)

    if (
      RUN_AUTOMATIC_BENCHMARK &&
      process.env.UPDATE_BENCHMARK_DOCS === '1'
    ) {
      writeFileSync(REPORT_PATH, report)
    }
  }, 600_000)
})
