import type { NestingSuccess } from '../types'
import {
  combineScore,
  DEFAULT_SCORE_WEIGHTS,
  type ScoreBreakdown,
  type ScoreWeights,
} from './weights'

export type { ScoreBreakdown, ScoreWeights }
export { DEFAULT_SCORE_WEIGHTS, combineScore }

/** Real used AABB area across sheets (mm²). Lower = tighter pack. */
export function packedBoundsMm2(result: NestingSuccess): number {
  let sum = 0
  for (const s of result.sheets) {
    if (!s.usedBounds) continue
    const w = Math.max(0, s.usedBounds.maxX - s.usedBounds.minX)
    const h = Math.max(0, s.usedBounds.maxY - s.usedBounds.minY)
    sum += w * h
  }
  return sum
}

/** Lower total = better. Built only from real NestingSuccess metrics. */
export function scoreNestingResult(
  result: NestingSuccess,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): ScoreBreakdown {
  return combineScore(
    {
      sheetPenalty: result.statistics.sheetCountUsed,
      wastePenalty: result.wasteMm2,
      compactnessPenalty: packedBoundsMm2(result),
      cutPenalty: 0,
      unplacedPenalty: result.statistics.unplacedCount,
    },
    weights,
  )
}

/** Final pick: fewer unplaced, then smaller packed bounds, then fewer sheets. */
export function isBetterPackedBounds(
  a: NestingSuccess,
  b: NestingSuccess,
): boolean {
  if (a.statistics.unplacedCount !== b.statistics.unplacedCount) {
    return a.statistics.unplacedCount < b.statistics.unplacedCount
  }
  const ba = packedBoundsMm2(a)
  const bb = packedBoundsMm2(b)
  if (Math.abs(ba - bb) > 1e-6) return ba < bb
  return a.statistics.sheetCountUsed < b.statistics.sheetCountUsed
}

export function isBetterScore(a: ScoreBreakdown, b: ScoreBreakdown): boolean {
  return a.total < b.total - 1e-9
}
