import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { formatNestBench, runNestingFixtureSuite } from './fixtures'
import { compareNestingResults } from '../nesting/scoring/fitness'
import { runBottomLeftNest } from '../nesting/placement/blf'
import { runAutomaticNest } from '../nesting/optimization/automaticOptimizer'
import { buildFixture } from './fixtures'

describe('Stage 7 nesting fixture suite', () => {
  it('runs BLF + automatic on all fixtures without regression from the exact seed', () => {
    const rows = runNestingFixtureSuite()
    expect(rows.length).toBeGreaterThanOrEqual(28) // 14 fixtures × 2 engines
    expect(new Set(rows.map(({ engine }) => engine))).toEqual(
      new Set(['blf', 'automatic']),
    )
    // eslint-disable-next-line no-console
    console.log('\n' + formatNestBench(rows) + '\n')

    const byFixture = new Map<string, { blf?: (typeof rows)[0]; automatic?: (typeof rows)[0] }>()
    for (const r of rows) {
      const e = byFixture.get(r.fixture) ?? {}
      if (r.engine === 'blf') e.blf = r
      else e.automatic = r
      byFixture.set(r.fixture, e)
    }
    for (const [, pair] of byFixture) {
      if (!pair.blf || !pair.automatic) continue
      expect(pair.automatic.canonicalVsSeed).not.toBeNull()
      expect(pair.automatic.canonicalVsSeed).toBeLessThanOrEqual(0)
    }

    if (process.env.UPDATE_BENCHMARK_DOCS === '1') {
      writeFileSync(
        resolve(__dirname, '../../docs/benchmarks/stage-9-fixtures-after.md'),
        [
          '# Stage 9 — Geometry fixture suite (after Stage 9 optimizer)',
          '',
          'Same fixtures/settings as `stage-9-baseline.md` (400×300, margin 5, spacing 2, seed=7).',
          '',
          '```',
          formatNestBench(rows),
          '```',
          '',
        ].join('\n'),
      )
    }
  }, 120_000)

  it('automatic result is never worse than the exact seed on mixedSizes', () => {
    const parts = buildFixture('mixedSizes')
    const request = {
      parts,
      sheets: [{ widthMm: 400, heightMm: 300, marginMm: 5, quantity: 6 }],
      settings: {
        spacingMm: 2,
        allowedRotations: [0, 90, 180, 270],
        allowArbitraryRotation: false,
        seed: 11,
        allowPartInPart: false,
      },
    }
    const baseline = runBottomLeftNest(request)
    const automatic = runAutomaticNest(request, {
      seed: 11,
      deterministic: true,
      now: () => 0,
    })
    expect(baseline.status).toBe('ok')
    expect(automatic.status).toBe('ok')
    if (baseline.status !== 'ok' || automatic.status !== 'ok') return
    expect(compareNestingResults(automatic, baseline)).toBeLessThanOrEqual(0)
  }, 30_000)
})
