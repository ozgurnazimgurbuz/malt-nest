import type { NestingSuccess } from '../types'
import {
  combineScore,
  DEFAULT_SCORE_WEIGHTS,
  type ScoreBreakdown,
  type ScoreWeights,
} from './weights'

export type { ScoreBreakdown, ScoreWeights }
export { DEFAULT_SCORE_WEIGHTS, combineScore }

/** Lower total = better. Built only from real NestingSuccess metrics. */
export function scoreNestingResult(
  result: NestingSuccess,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): ScoreBreakdown {
  let compactness = 0
  for (const s of result.sheets) {
    if (!s.usedBounds) continue
    const w = Math.max(0, s.usedBounds.maxX - s.usedBounds.minX)
    const h = Math.max(0, s.usedBounds.maxY - s.usedBounds.minY)
    compactness += w * h
  }

  return combineScore(
    {
      sheetPenalty: result.statistics.sheetCountUsed,
      wastePenalty: result.wasteMm2,
      compactnessPenalty: compactness,
      cutPenalty: 0,
      unplacedPenalty: result.statistics.unplacedCount,
    },
    weights,
  )
}

export function isBetterScore(a: ScoreBreakdown, b: ScoreBreakdown): boolean {
  return a.total < b.total - 1e-9
}
