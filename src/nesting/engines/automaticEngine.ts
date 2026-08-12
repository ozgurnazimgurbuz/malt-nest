import type { NestingEngine, NestingRunOptions } from '../engine'
import { runAutomaticNest } from '../optimization/automaticOptimizer'
import type { NestingRequest, NestingResult } from '../types'

export class AutomaticNestingEngine implements NestingEngine {
  readonly id = 'automatic-blf-v1'

  async nest(
    request: NestingRequest,
    options?: NestingRunOptions,
  ): Promise<NestingResult> {
    return runAutomaticNest(request, {
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
      deterministic: request.settings.deterministic === true,
    })
  }
}

export const automaticNestingEngine = new AutomaticNestingEngine()
