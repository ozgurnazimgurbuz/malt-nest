import type { NestingSuccess } from '../types'
import { compareNestingResults } from '../scoring/fitness'
import { individualKey, type Individual } from './individual'
import {
  adjacentSwapMutation,
  insertionMutation,
  swapMutation,
} from './mutation'
import type { Rng } from './rng'

export type RankedCandidate = {
  individual: Individual
  result: NestingSuccess
}

export function expandOrder(individual: Individual, rng: Rng): Individual[] {
  if (individual.order.length < 2) return []
  const seen = new Set<string>()
  return [
    adjacentSwapMutation(individual, rng),
    swapMutation(individual, rng),
    insertionMutation(individual, rng),
  ].filter((candidate) => {
    const key = individualKey(candidate, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function selectBeam(
  candidates: readonly RankedCandidate[],
  width: number,
  settingsKey = '',
): RankedCandidate[] {
  if (!Number.isSafeInteger(width) || width < 0) {
    throw new RangeError('Beam width must be a nonnegative safe integer')
  }
  if (width === 0) return []
  const seen = new Set<string>()
  return candidates
    .filter((candidate) => {
      const key = individualKey(candidate.individual, settingsKey)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => compareNestingResults(a.candidate.result, b.candidate.result) || a.index - b.index)
    .slice(0, width)
    .map(({ candidate }) => candidate)
}
