import type { ScoreBreakdown } from '../scoring/fitness'
import { isBetterScore } from '../scoring/fitness'
import type { Individual } from './individual'
import { cloneIndividual } from './individual'
import type { Rng } from './rng'

export type RankedIndividual = {
  individual: Individual
  score: ScoreBreakdown
  resultKey: string
}

export function tournamentSelect(
  population: RankedIndividual[],
  rng: Rng,
  tournamentSize = 3,
): Individual {
  if (population.length === 0) throw new Error('Empty population')
  let best = population[rng.int(population.length)]!
  const k = Math.min(tournamentSize, population.length)
  for (let i = 1; i < k; i++) {
    const cand = population[rng.int(population.length)]!
    if (isBetterScore(cand.score, best.score)) best = cand
  }
  return cloneIndividual(best.individual)
}

export function elitistSurvive(
  population: RankedIndividual[],
  eliteCount: number,
): RankedIndividual[] {
  const sorted = population
    .slice()
    .sort((a, b) => a.score.total - b.score.total)
  return sorted.slice(0, Math.max(0, eliteCount)).map((r) => ({
    individual: cloneIndividual(r.individual),
    score: r.score,
    resultKey: r.resultKey,
  }))
}
