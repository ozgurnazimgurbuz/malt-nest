import type { NestingEngine, NestingRunOptions } from '../engine'
import { runBottomLeftNest } from '../placement/blf'
import type { NestingRequest, NestingResult } from '../types'

/** Deterministic Bottom-Left / NFP-candidate nesting engine (Stage 4). */
export class BlfNestingEngine implements NestingEngine {
  readonly id = 'blf-nfp-v1'

  async nest(
    request: NestingRequest,
    options?: NestingRunOptions,
  ): Promise<NestingResult> {
    return runBottomLeftNest(request, {
      onProgress: options?.onProgress,
      signal: options?.signal,
    })
  }
}

export const blfNestingEngine = new BlfNestingEngine()
