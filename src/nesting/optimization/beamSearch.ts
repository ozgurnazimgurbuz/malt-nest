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
  const adjacent = Array.from(
    { length: individual.order.length - 1 },
    (_, index) => {
      const candidate = {
        order: individual.order.slice(),
        rotations: individual.rotations.slice(),
      }
      const id = candidate.order[index]!
      candidate.order[index] = candidate.order[index + 1]!
      candidate.order[index + 1] = id
      const rotation = candidate.rotations[index]!
      candidate.rotations[index] = candidate.rotations[index + 1]!
      candidate.rotations[index + 1] = rotation
      return candidate
    },
  )
  return [
    ...adjacent,
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

export function selectNextBeam(
  current: readonly RankedCandidate[],
  children: readonly RankedCandidate[],
  width: number,
  settingsKey = '',
): RankedCandidate[] {
  return selectBeam([...children, ...current], width, settingsKey)
}
