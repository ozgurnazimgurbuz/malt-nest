import { runBottomLeftNest } from '../placement/blf'
import {
  compareNestingResults,
  scoreNestingResult,
} from '../scoring/fitness'
import type { NestingRequest, NestingSuccess } from '../types'
import { runAutomaticNest } from './automaticOptimizer'

export type BenchmarkRow = {
  engine: string
  sheets: number
  utilization: number
  wasteMm2: number
  placed: number
  unplaced: number
  timeMs: number
  fitness: number
}

function row(label: string, result: NestingSuccess): BenchmarkRow {
  const score = scoreNestingResult(result)
  return {
    engine: label,
    sheets: result.statistics.sheetCountUsed,
    utilization: result.utilization,
    wasteMm2: result.wasteMm2,
    placed: result.statistics.placedCount,
    unplaced: result.statistics.unplacedCount,
    timeMs: result.calculationTimeMs,
    fitness: score.total,
  }
}

/** Dev helper: compare BLF baseline vs automatic search on the same request. */
export function compareBlfVsAutomatic(request: NestingRequest): {
  blf: BenchmarkRow
  automatic: BenchmarkRow
  improved: boolean
} {
  const blfRaw = runBottomLeftNest(request)
  const automaticRaw = runAutomaticNest(request, {
    seed: request.settings.seed,
  })
  if (blfRaw.status !== 'ok' || automaticRaw.status !== 'ok') {
    throw new Error('Benchmark requires successful nests')
  }
  const blf = row('blf', blfRaw)
  const automatic = row('automatic', automaticRaw)
  return {
    blf,
    automatic,
    improved: compareNestingResults(automaticRaw, blfRaw) < 0,
  }
}
