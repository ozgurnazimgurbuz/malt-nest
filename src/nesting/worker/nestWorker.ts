import { runEvolutionaryNest } from '../optimization/geneticOptimizer'
import type { NestingRequest, NestingResult, NestProgress } from '../types'

export type WorkerInMessage =
  | { type: 'nest'; requestId: string; request: NestingRequest }
  | { type: 'cancel'; requestId: string }

export type WorkerOutMessage =
  | { type: 'started'; requestId: string }
  | { type: 'progress'; requestId: string; progress: NestProgress }
  | { type: 'completed'; requestId: string; result: NestingResult }
  | { type: 'error'; requestId: string; message: string }

let activeId: string | null = null
let aborted = false

self.onmessage = (ev: MessageEvent<WorkerInMessage>) => {
  const msg = ev.data
  if (msg.type === 'cancel') {
    if (activeId === msg.requestId) aborted = true
    return
  }
  if (msg.type !== 'nest') return

  activeId = msg.requestId
  aborted = false
  const out = (m: WorkerOutMessage) => self.postMessage(m)

  out({ type: 'started', requestId: msg.requestId })
  try {
    const result = runEvolutionaryNest(msg.request, {
      signal: {
        get aborted() {
          return aborted
        },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false
        },
        onabort: null,
        reason: undefined,
        throwIfAborted() {
          if (aborted) throw new DOMException('Aborted', 'AbortError')
        },
      } as AbortSignal,
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
  } finally {
    activeId = null
    aborted = false
  }
}
