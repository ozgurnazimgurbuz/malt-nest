import type { OptimizationLevel } from '../types'

export type OptimizerPreset = {
  populationSize: number
  timeLimitMs: number
  maxGenerations: number
  mutationRate: number
  eliteFraction: number
  tournamentSize: number
  /** Distinct multi-start trajectories within the time budget. */
  multiStarts: number
  /** Fraction of remaining time for local search (0..1). */
  localSearchFraction: number
  /** Fraction of remaining time for destroy/repair (0..1). */
  destroyRepairFraction: number
  enableLocalSearch: boolean
  enableDestroyRepair: boolean
}

export function presetForLevel(level: OptimizationLevel): OptimizerPreset {
  switch (level) {
    case 'fast':
      return {
        populationSize: 12,
        timeLimitMs: 500,
        maxGenerations: 40,
        mutationRate: 0.28,
        eliteFraction: 0.1,
        tournamentSize: 3,
        multiStarts: 2,
        localSearchFraction: 0.15,
        destroyRepairFraction: 0.1,
        enableLocalSearch: true,
        enableDestroyRepair: false,
      }
    case 'deep':
      return {
        populationSize: 28,
        timeLimitMs: 10_000,
        maxGenerations: 180,
        mutationRate: 0.16,
        eliteFraction: 0.1,
        tournamentSize: 4,
        multiStarts: 8,
        localSearchFraction: 0.2,
        destroyRepairFraction: 0.25,
        enableLocalSearch: true,
        enableDestroyRepair: true,
      }
    case 'balanced':
    default:
      return {
        populationSize: 18,
        timeLimitMs: 2_000,
        maxGenerations: 90,
        mutationRate: 0.22,
        eliteFraction: 0.1,
        tournamentSize: 3,
        multiStarts: 4,
        localSearchFraction: 0.18,
        destroyRepairFraction: 0.15,
        enableLocalSearch: true,
        enableDestroyRepair: true,
      }
  }
}
