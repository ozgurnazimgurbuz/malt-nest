import { blfNestingEngine } from './engines/blfEngine'
import { evolutionaryNestingEngine } from './engines/evolutionaryEngine'
import type {
  NestingRequest,
  NestingResult,
  NestProgress,
  NestAttemptBatch,
} from './types'
import { workerNestingEngine } from './worker/client'

export type NestingRunOptions = {
  signal?: AbortSignal
  onProgress?: (progress: NestProgress) => void
  onAttempts?: (batch: NestAttemptBatch) => void
  /** Unique id for this nest request (stale-result guard). */
  jobId?: string
}

/**
 * Engine-agnostic nesting contract.
 * UI talks only to this interface (via the `nest` façade).
 */
export interface NestingEngine {
  readonly id: string
  nest(
    request: NestingRequest,
    options?: NestingRunOptions,
  ): Promise<NestingResult>
}

/** Default: worker-backed evolutionary optimizer (BLF baseline inside). */
export const defaultNestingEngine: NestingEngine = workerNestingEngine

export { blfNestingEngine, evolutionaryNestingEngine }
