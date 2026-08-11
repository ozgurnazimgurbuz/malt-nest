import { describe, expect, it } from 'vitest'
import type { NestingSuccess } from '../types'
import {
  compareNestingResults,
  isBetterNestingResult,
  packedBoundsMm2,
} from './fitness'

function result({
  unplaced = 0,
  sheets = 1,
  waste = 100,
  utilization = 0.5,
  boundsArea = 100,
}: {
  unplaced?: number
  sheets?: number
  waste?: number
  utilization?: number
  boundsArea?: number
} = {}): NestingSuccess {
  return {
    status: 'ok',
    placements: [],
    sheets: Array.from({ length: sheets }, (_, sheetIndex) => ({
      sheetIndex,
      widthMm: 100,
      heightMm: 100,
      placedCount: 0,
      utilization,
      wasteMm2: waste / sheets,
      usedBounds: {
        minX: 0,
        minY: 0,
        maxX: boundsArea / sheets,
        maxY: 1,
      },
    })),
    unplacedPartIds: Array.from({ length: unplaced }, (_, i) => `u-${i}`),
    utilization,
    wasteMm2: waste,
    calculationTimeMs: 1,
    statistics: {
      partCount: 10,
      placedCount: 10 - unplaced,
      unplacedCount: unplaced,
      sheetCountUsed: sheets,
      totalPartAreaMm2: 1,
      totalSheetAreaMm2: sheets * 10_000,
      overallUtilization: utilization,
      overallWasteMm2: waste,
    },
    engineId: 'test',
  }
}

describe('canonical nesting result order', () => {
  it('prioritizes feasibility before every packing metric', () => {
    const complete = result({ sheets: 2, waste: 20_000, boundsArea: 20_000 })
    const partial = result({ unplaced: 1, sheets: 1, waste: 0, boundsArea: 1 })

    expect(isBetterNestingResult(complete, partial)).toBe(true)
  })

  it('prioritizes fewer sheets before waste and packed bounds', () => {
    const oneSheet = result({ sheets: 1, waste: 20_000, boundsArea: 10_000 })
    const twoSheets = result({ sheets: 2, waste: 0, boundsArea: 2 })

    expect(isBetterNestingResult(oneSheet, twoSheets)).toBe(true)
  })

  it('then compares waste, utilization, and packed bounds in order', () => {
    const lowerWaste = result({ waste: 10, utilization: 0.1, boundsArea: 100 })
    const higherWaste = result({ waste: 11, utilization: 0.99, boundsArea: 1 })
    expect(isBetterNestingResult(lowerWaste, higherWaste)).toBe(true)

    const higherUtilization = result({ waste: 10, utilization: 0.8, boundsArea: 100 })
    const lowerUtilization = result({ waste: 10, utilization: 0.7, boundsArea: 1 })
    expect(isBetterNestingResult(higherUtilization, lowerUtilization)).toBe(true)

    const tighter = result({ waste: 10, utilization: 0.8, boundsArea: 20 })
    const looser = result({ waste: 10, utilization: 0.8, boundsArea: 30 })
    expect(packedBoundsMm2(tighter)).toBe(20)
    expect(compareNestingResults(tighter, looser)).toBeLessThan(0)
  })
})
