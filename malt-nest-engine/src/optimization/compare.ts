/**
 * Temporary deterministic comparison for ETAP 6A multi-start.
 * NOT ETAP 7 scoring — no weighted fitness, no magic scores.
 *
 * Priority (better first):
 * 1. fewer sheets
 * 2. more placed parts
 * 3. higher utilization
 * 4. lower packedBoundsMm2
 * 5. strategy name ascending (deterministic tie-break)
 */
import type { OrderingEval } from './types'

export function compareOrderingEvals(a: OrderingEval, b: OrderingEval): number {
  // negative ⇒ a better than b (sort ascending = best first)
  if (a.sheets !== b.sheets) return a.sheets - b.sheets
  if (a.placed !== b.placed) return b.placed - a.placed
  if (a.utilization !== b.utilization) return b.utilization - a.utilization
  if (a.packedBoundsMm2 !== b.packedBoundsMm2) {
    return a.packedBoundsMm2 - b.packedBoundsMm2
  }
  if (a.strategy < b.strategy) return -1
  if (a.strategy > b.strategy) return 1
  return 0
}

/** True if `a` is strictly better than `b`, or equal on metrics (tie → strategy). */
export function isBetterOrEqualEval(a: OrderingEval, b: OrderingEval): boolean {
  return compareOrderingEvals(a, b) <= 0
}

export function rankEvals(
  evals: readonly OrderingEval[],
): Map<string, number> {
  const sorted = [...evals].sort(compareOrderingEvals)
  const ranks = new Map<string, number>()
  sorted.forEach((e, i) => {
    ranks.set(e.strategy, i + 1)
  })
  return ranks
}
