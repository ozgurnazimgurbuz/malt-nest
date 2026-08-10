import type { NestingEngine, NestingRunOptions } from '../engine'
import { blfNestingEngine } from '../engines/blfEngine'
import type { NestingRequest, NestingResult, NestingSuccess } from '../types'
import type { WorkerInMessage, WorkerOutMessage } from './nestWorker'

/** How long to wait for cooperative cancel before hard-terminate. */
const CANCEL_GRACE_MS = 800

/**
 * Runs evolutionary nesting in a Web Worker when available; falls back to main thread.
 * STOP: cooperative cancel first, then terminate + bestSoFar from progress snapshots.
 */
export class WorkerNestingEngine implements NestingEngine {
  readonly id = 'evolutionary-worker-v1'

  async nest(
    request: NestingRequest,
    options?: NestingRunOptions,
  ): Promise<NestingResult> {
    if (typeof Worker === 'undefined') {
      return blfNestingEngine.nest(request, options)
    }

    try {
      const worker = new Worker(new URL('./nestWorker.ts', import.meta.url), {
        type: 'module',
      })
      const requestId =
        options?.jobId ??
        `nest-${Date.now()}-${Math.random().toString(36).slice(2)}`

      return await new Promise<NestingResult>((resolve, reject) => {
        let settled = false
        let lastBest: NestingSuccess | null = null
        let killTimer: ReturnType<typeof setTimeout> | null = null

        const finish = (result: NestingResult) => {
          if (settled) return
          settled = true
          if (killTimer != null) {
            clearTimeout(killTimer)
            killTimer = null
          }
          cleanup()
          resolve(result)
        }

        const onAbort = () => {
          const cancel: WorkerInMessage = { type: 'cancel', requestId }
          try {
            worker.postMessage(cancel)
          } catch {
            /* worker may already be dead */
          }
          if (killTimer != null) return
          killTimer = setTimeout(() => {
            killTimer = null
            if (settled) return
            try {
              worker.terminate()
            } catch {
              /* ignore */
            }
            finish({
              status: 'cancelled',
              message: 'Stopped — worker terminated',
              bestSoFar: lastBest,
            })
          }, CANCEL_GRACE_MS)
        }

        options?.signal?.addEventListener('abort', onAbort)
        if (options?.signal?.aborted) onAbort()

        worker.onmessage = (ev: MessageEvent<WorkerOutMessage>) => {
          const msg = ev.data
          if (msg.requestId !== requestId) return
          if (msg.type === 'progress') {
            if (msg.progress.bestSoFar?.status === 'ok') {
              lastBest = msg.progress.bestSoFar
            }
            options?.onProgress?.({ ...msg.progress, jobId: requestId })
            return
          }
          if (msg.type === 'completed') {
            const result = msg.result
            if (
              result.status === 'cancelled' &&
              !result.bestSoFar &&
              lastBest
            ) {
              finish({ ...result, bestSoFar: lastBest })
              return
            }
            finish(result)
            return
          }
          if (msg.type === 'error') {
            finish({
              status: 'cancelled',
              message: msg.message,
              bestSoFar: lastBest,
            })
          }
        }
        worker.onerror = (err) => {
          if (settled) return
          settled = true
          if (killTimer != null) clearTimeout(killTimer)
          cleanup()
          reject(err.error ?? new Error('Nesting worker error'))
        }

        function cleanup() {
          options?.signal?.removeEventListener('abort', onAbort)
          try {
            worker.terminate()
          } catch {
            /* ignore */
          }
        }

        const start: WorkerInMessage = { type: 'nest', requestId, request }
        worker.postMessage(start)
      })
    } catch {
      return blfNestingEngine.nest(request, options)
    }
  }
}

export const workerNestingEngine = new WorkerNestingEngine()
