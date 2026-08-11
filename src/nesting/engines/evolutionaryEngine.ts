import type { NestingEngine, NestingRunOptions } from '../engine'
import { runEvolutionaryNest } from '../optimization/geneticOptimizer'
import type { NestingRequest, NestingResult } from '../types'

export class EvolutionaryNestingEngine implements NestingEngine {
  readonly id = 'evolutionary-blf-v1'

  async nest(
    request: NestingRequest,
    options?: NestingRunOptions,
  ): Promise<NestingResult> {
    return runEvolutionaryNest(request, {
      onProgress: options?.onProgress,
      onAttempt: options?.onAttempts
        ? (attempt) => {
            try {
              options.onAttempts?.({
                attempts: [attempt],
                jobId: options.jobId,
              })
            } catch {
              // Observation only.
            }
          }
        : undefined,
      signal: options?.signal,
      seed: request.settings.seed,
      timeLimitMs: request.settings.timeLimitMs,
      deterministic: request.settings.deterministic === true,
    })
  }
}

export const evolutionaryNestingEngine = new EvolutionaryNestingEngine()
