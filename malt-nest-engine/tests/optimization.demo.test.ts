import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { parseSvg } from '../src/geometry'
import { createSheet } from '../src/placement'
import {
  compareOrderingEvals,
  optimizeMultiStart,
} from '../src/optimization'
import { BASE_ORDERING_STRATEGIES } from '../src/ordering'

const DEMO = '/Users/ozgurnazimgurbuz/Desktop/Demo.svg'

describe('Demo.svg multi-start FAST + FULL', () => {
  it('reports FAST sweep, FULL shortlist, ranking diagnostic', () => {
    if (!existsSync(DEMO)) return
    const { shapes } = parseSvg(readFileSync(DEMO, 'utf8'))
    expect(shapes.length).toBe(16)
    const sheet = createSheet(1600, 1000, 10)

    const result = optimizeMultiStart(shapes, sheet, {
      gap: 5,
      maxSheets: 16,
    })

    expect(result.fastCandidates.length).toBe(BASE_ORDERING_STRATEGIES.length)
    expect(result.diagnostics.fullShortlist).toContain('area_desc')
    expect(result.diagnostics.baselinePreserved).toBe(true)

    const table = BASE_ORDERING_STRATEGIES.map((strategy) => {
      const fast = result.fastCandidates.find((e) => e.strategy === strategy)!
      const full = result.fullCandidates.find((e) => e.strategy === strategy)
      const rank = result.diagnostics.ranking.find((r) => r.strategy === strategy)!
      return {
        Ordering: strategy,
        'Fast placed': fast.placed,
        'Fast sheets': fast.sheets,
        'Fast bounds': Math.round(fast.packedBoundsMm2),
        'Fast ms': Math.round(fast.runtimeMs),
        'Full placed': full?.placed ?? null,
        'Full sheets': full?.sheets ?? null,
        'Full bounds': full ? Math.round(full.packedBoundsMm2) : null,
        'Full ms': full ? Math.round(full.runtimeMs) : null,
        'Fast rank': rank.fastRank,
        'Full rank': rank.fullRank,
      }
    })

    console.log(JSON.stringify({
      table,
      bestFAST: (() => {
        const b = [...result.fastCandidates].sort(compareOrderingEvals)[0]!
        return {
          strategy: b.strategy,
          placed: b.placed,
          sheets: b.sheets,
          packedBoundsMm2: Math.round(b.packedBoundsMm2),
        }
      })(),
      bestFULL: {
        strategy: result.best.strategy,
        placed: result.best.placed,
        sheets: result.best.sheets,
        packedBoundsMm2: Math.round(result.best.packedBoundsMm2),
        utilization: Number(result.best.utilization.toFixed(4)),
      },
      baseline: {
        strategy: result.baseline.strategy,
        placed: result.baseline.placed,
        sheets: result.baseline.sheets,
        packedBoundsMm2: Math.round(result.baseline.packedBoundsMm2),
      },
      baselinePreserved: result.diagnostics.baselinePreserved,
      fullShortlist: result.diagnostics.fullShortlist,
      totals: {
        fastTotalRuntimeMs: Math.round(result.diagnostics.fastTotalRuntimeMs),
        fullTotalRuntimeMs: Math.round(result.diagnostics.fullTotalRuntimeMs),
        totalNfp: result.diagnostics.totalNfp,
        totalCandidates: result.diagnostics.totalCandidates,
        totalCacheHits: result.diagnostics.totalCacheHits,
        totalCacheMisses: result.diagnostics.totalCacheMisses,
      },
    }, null, 2))

    expect(result.best.placed).toBeGreaterThanOrEqual(result.baseline.placed)
  }, 900_000)
})
