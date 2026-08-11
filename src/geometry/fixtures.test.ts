import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { formatNestBench, runNestingFixtureSuite } from './fixtures'
import { isBetterScore, scoreNestingResult } from '../nesting/scoring/fitness'
import { runBottomLeftNest } from '../nesting/placement/blf'
import { runEvolutionaryNest } from '../nesting/optimization/geneticOptimizer'
import { buildFixture } from './fixtures'

describe('Stage 7 nesting fixture suite', () => {
  it('runs BLF + evolutionary on all fixtures without regression vs BLF', () => {
    const rows = runNestingFixtureSuite()
    expect(rows.length).toBeGreaterThanOrEqual(28) // 14 fixtures × 2 engines
    // eslint-disable-next-line no-console
    console.log('\n' + formatNestBench(rows) + '\n')

    const byFixture = new Map<string, { blf?: (typeof rows)[0]; evo?: (typeof rows)[0] }>()
    for (const r of rows) {
      const e = byFixture.get(r.fixture) ?? {}
      if (r.engine === 'blf') e.blf = r
      else e.evo = r
      byFixture.set(r.fixture, e)
    }
    for (const [, pair] of byFixture) {
      if (!pair.blf || !pair.evo) continue
      // Evolutionary score must not be worse (lower is better)
      expect(pair.evo.score).toBeLessThanOrEqual(pair.blf.score + 1e-3)
    }

    if (process.env.UPDATE_BENCHMARK_DOCS === '1') {
      writeFileSync(
        resolve(__dirname, '../../docs/benchmarks/stage-9-fixtures-after.md'),
        [
          '# Stage 9 — Geometry fixture suite (after Stage 9 optimizer)',
          '',
          'Same fixtures/settings as `stage-9-baseline.md` (400×300, margin 5, spacing 2, fast/~400ms, seed=7).',
          '',
          '```',
          formatNestBench(rows),
          '```',
          '',
        ].join('\n'),
      )
    }
  }, 120_000)

  it('official scoring: evolved >= baseline on mixedSizes', () => {
    const parts = buildFixture('mixedSizes')
    const request = {
      parts,
      sheets: [{ widthMm: 400, heightMm: 300, marginMm: 5, quantity: 6 }],
      settings: {
        spacingMm: 2,
        allowedRotations: [0, 90, 180, 270],
        allowArbitraryRotation: false,
        optimizationLevel: 'fast' as const,
        timeLimitMs: 500,
        seed: 11,
        allowPartInPart: false,
      },
    }
    const baseline = runBottomLeftNest(request)
    const evolved = runEvolutionaryNest(request, {
      seed: 11,
      timeLimitMs: 500,
      maxGenerations: 50,
    })
    expect(baseline.status).toBe('ok')
    expect(evolved.status).toBe('ok')
    if (baseline.status !== 'ok' || evolved.status !== 'ok') return
    const sb = scoreNestingResult(baseline)
    const se = scoreNestingResult(evolved)
    expect(isBetterScore(se, sb) || se.total <= sb.total + 1e-6).toBe(true)
  }, 30_000)
})
