import type { Individual } from './individual'
import { cloneIndividual } from './individual'
import type { Rng } from './rng'
import type { EvaluateFn } from './localSearch'
import { isBetterScore } from '../scoring/fitness'

/**
 * Destroy / repair (large-neighborhood): remove a subset, shuffle/rotate, reinsert.
 */
export function destroyRepairImprove(
  start: Individual,
  allowedRotations: number[],
  rng: Rng,
  evaluate: EvaluateFn,
  deadlineMs: number,
  now: () => number = () => performance.now(),
): Individual {
  let best = cloneIndividual(start)
  let bestScore = evaluate(best).score
  const n = best.order.length
  if (n < 3) return best

  const fractions = [0.05, 0.1, 0.2]
  let iter = 0
  const maxIter = Math.max(8, Math.min(40, n * 2))

  while (iter < maxIter && now() < deadlineMs) {
    iter++
    const frac = fractions[iter % fractions.length]!
    const removeCount = Math.max(1, Math.min(n - 1, Math.round(n * frac)))
    const cand = cloneIndividual(best)

    const indices = rng.shuffle([...Array(n).keys()]).slice(0, removeCount)
    indices.sort((a, b) => b - a)
    const removedIds: string[] = []
    const removedRots: number[] = []
    for (const i of indices) {
      removedIds.push(cand.order.splice(i, 1)[0]!)
      removedRots.push(cand.rotations.splice(i, 1)[0]!)
    }

    // Repair: shuffle removed, maybe re-rotate, append (BLF will place in that order)
    const orderIdx = rng.shuffle([...Array(removedIds.length).keys()])
    for (const j of orderIdx) {
      const id = removedIds[j]!
      let rot = removedRots[j]!
      if (rng.next() < 0.5) rot = rng.pick(allowedRotations)
      // Prefer reinsert near front for large removals, end for small
      if (frac >= 0.15 && rng.next() < 0.5) {
        cand.order.unshift(id)
        cand.rotations.unshift(rot)
      } else {
        cand.order.push(id)
        cand.rotations.push(rot)
      }
    }

    const score = evaluate(cand).score
    if (isBetterScore(score, bestScore)) {
      best = cand
      bestScore = score
    }
  }

  return best
}
