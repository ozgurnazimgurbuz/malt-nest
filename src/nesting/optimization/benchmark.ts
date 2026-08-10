import { runBottomLeftNest } from '../placement/blf'
import { scoreNestingResult } from '../scoring/fitness'
import type { NestingRequest, NestingSuccess } from '../types'
import { runEvolutionaryNest } from './geneticOptimizer'

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

/** Dev helper: compare BLF baseline vs evolutionary on the same request. */
export function compareBlfVsEvolutionary(request: NestingRequest): {
  blf: BenchmarkRow
  evolutionary: BenchmarkRow
  improved: boolean
} {
  const blfRaw = runBottomLeftNest(request)
  const evoRaw = runEvolutionaryNest(request, {
    seed: request.settings.seed,
    timeLimitMs: request.settings.timeLimitMs,
  })
  if (blfRaw.status !== 'ok' || evoRaw.status !== 'ok') {
    throw new Error('Benchmark requires successful nests')
  }
  const blf = row('blf', blfRaw)
  const evolutionary = row('evolutionary', evoRaw)
  return {
    blf,
    evolutionary,
    improved: evolutionary.fitness < blf.fitness - 1e-9,
  }
}
