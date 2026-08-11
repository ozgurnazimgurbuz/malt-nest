import { runEvolutionaryNest } from '../optimization/geneticOptimizer'
import type {
  NestAttempt,
  NestingRequest,
  NestingResult,
  NestProgress,
} from '../types'
import { createAttemptBatcher } from './attemptBatcher'

export type WorkerInMessage =
  { type: 'nest'; requestId: string; request: NestingRequest; traceAttempts: boolean }

export type WorkerOutMessage =
  | { type: 'started'; requestId: string }
  | { type: 'attempts'; requestId: string; attempts: NestAttempt[] }
  | { type: 'progress'; requestId: string; progress: NestProgress }
  | { type: 'completed'; requestId: string; result: NestingResult }
  | { type: 'error'; requestId: string; message: string }

self.onmessage = (ev: MessageEvent<WorkerInMessage>) => {
  const msg = ev.data
  const out = (m: WorkerOutMessage) => self.postMessage(m)
  const attemptBatcher = msg.traceAttempts
    ? createAttemptBatcher((attempts) => {
        out({ type: 'attempts', requestId: msg.requestId, attempts })
      })
    : null

  out({ type: 'started', requestId: msg.requestId })
  try {
    const result = runEvolutionaryNest(msg.request, {
      onAttempt: attemptBatcher?.push,
      onAttemptFlush: attemptBatcher?.flush,
      onProgress: (progress) => {
        out({ type: 'progress', requestId: msg.requestId, progress })
      },
      seed: msg.request.settings.seed,
      timeLimitMs: msg.request.settings.timeLimitMs,
      deterministic: msg.request.settings.deterministic === true,
    })
    attemptBatcher?.flush()
    out({ type: 'completed', requestId: msg.requestId, result })
  } catch (err) {
    attemptBatcher?.flush()
    out({
      type: 'error',
      requestId: msg.requestId,
      message: err instanceof Error ? err.message : 'Nesting worker failed',
    })
  }
}
