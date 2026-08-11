import { runEvolutionaryNest } from '../optimization/geneticOptimizer'
import type { NestingRequest, NestingResult, NestProgress } from '../types'

export type WorkerInMessage =
  { type: 'nest'; requestId: string; request: NestingRequest }

export type WorkerOutMessage =
  | { type: 'started'; requestId: string }
  | { type: 'progress'; requestId: string; progress: NestProgress }
  | { type: 'completed'; requestId: string; result: NestingResult }
  | { type: 'error'; requestId: string; message: string }

self.onmessage = (ev: MessageEvent<WorkerInMessage>) => {
  const msg = ev.data
  const out = (m: WorkerOutMessage) => self.postMessage(m)

  out({ type: 'started', requestId: msg.requestId })
  try {
    const result = runEvolutionaryNest(msg.request, {
      onProgress: (progress) => {
        out({ type: 'progress', requestId: msg.requestId, progress })
      },
      seed: msg.request.settings.seed,
      timeLimitMs: msg.request.settings.timeLimitMs,
      deterministic: msg.request.settings.deterministic === true,
    })
    out({ type: 'completed', requestId: msg.requestId, result })
  } catch (err) {
    out({
      type: 'error',
      requestId: msg.requestId,
      message: err instanceof Error ? err.message : 'Nesting worker failed',
    })
  }
}
