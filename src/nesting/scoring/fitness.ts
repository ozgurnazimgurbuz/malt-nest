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

/**
 * Canonical result order. Feasibility and sheet count are hard priorities;
 * material use and compactness only break ties after them.
 */
export function compareNestingResults(
  a: NestingSuccess,
  b: NestingSuccess,
): number {
  if (a.statistics.unplacedCount !== b.statistics.unplacedCount) {
    return a.statistics.unplacedCount - b.statistics.unplacedCount
  }
  if (a.statistics.sheetCountUsed !== b.statistics.sheetCountUsed) {
    return a.statistics.sheetCountUsed - b.statistics.sheetCountUsed
  }
  if (Math.abs(a.wasteMm2 - b.wasteMm2) > 1e-6) {
    return a.wasteMm2 - b.wasteMm2
  }
  if (Math.abs(a.utilization - b.utilization) > 1e-9) {
    return b.utilization - a.utilization
  }
  const ba = packedBoundsMm2(a)
  const bb = packedBoundsMm2(b)
  if (Math.abs(ba - bb) > 1e-6) return ba - bb
  return 0
}

export function isBetterNestingResult(
  a: NestingSuccess,
  b: NestingSuccess,
): boolean {
  return compareNestingResults(a, b) < 0
}

export type ComparableScore = Pick<ScoreBreakdown, 'total'> &
  Partial<Omit<ScoreBreakdown, 'total'>>

export function compareScores(a: ComparableScore, b: ComparableScore): number {
  const priority: Array<keyof ScoreBreakdown> = [
    'unplacedPenalty',
    'sheetPenalty',
    'wastePenalty',
    'compactnessPenalty',
    'cutPenalty',
    'total',
  ]
  for (const key of priority) {
    const delta = (a[key] ?? 0) - (b[key] ?? 0)
    if (Math.abs(delta) > 1e-9) return delta
  }
  return 0
}

export function isBetterScore(a: ComparableScore, b: ComparableScore): boolean {
  return compareScores(a, b) < 0
}
