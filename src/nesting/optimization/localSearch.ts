import type { Individual } from './individual'
import { cloneIndividual } from './individual'
import type { Rng } from './rng'
import { isBetterScore, type ComparableScore } from '../scoring/fitness'

export type EvaluateFn = (ind: Individual) => {
  score: ComparableScore
}

/**
 * Bounded local search around a gene.
 * Accepts only official score improvements.
 */
export function localSearchImprove(
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
  if (n < 2) return best

  let ops = 0
  const maxOps = Math.max(20, n * 8)

  while (ops < maxOps && now() < deadlineMs) {
    ops++
    const cand = cloneIndividual(best)
    const roll = rng.next()

    if (roll < 0.25) {
      // swap two parts
      const i = rng.int(n)
      const j = rng.int(n)
      const t = cand.order[i]!
      cand.order[i] = cand.order[j]!
      cand.order[j] = t
      const tr = cand.rotations[i]!
      cand.rotations[i] = cand.rotations[j]!
      cand.rotations[j] = tr
    } else if (roll < 0.45) {
      // move one part earlier/later
      const from = rng.int(n)
      const to = rng.int(n)
      const [id] = cand.order.splice(from, 1)
      const [rot] = cand.rotations.splice(from, 1)
      cand.order.splice(to, 0, id!)
      cand.rotations.splice(to, 0, rot!)
    } else if (roll < 0.7) {
      // change one rotation
      const i = rng.int(n)
      cand.rotations[i] = rng.pick(allowedRotations)
    } else if (roll < 0.85) {
      // reverse a local window
      const a = rng.int(n)
      const b = Math.min(n - 1, a + 1 + rng.int(Math.min(6, n - a)))
      const segO = cand.order.slice(a, b + 1).reverse()
      const segR = cand.rotations.slice(a, b + 1).reverse()
      for (let k = 0; k < segO.length; k++) {
        cand.order[a + k] = segO[k]!
        cand.rotations[a + k] = segR[k]!
      }
    } else {
      // reinsert a random part at front (worst-position heuristic proxy)
      const i = rng.int(n)
      const [id] = cand.order.splice(i, 1)
      const [rot] = cand.rotations.splice(i, 1)
      cand.order.unshift(id!)
      cand.rotations.unshift(rot!)
    }

    const score = evaluate(cand).score
    if (isBetterScore(score, bestScore)) {
      best = cand
      bestScore = score
    }
  }

  return best
}
