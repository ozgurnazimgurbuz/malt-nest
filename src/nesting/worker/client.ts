import type { NestingEngine, NestingRunOptions } from '../engine'
import { evolutionaryNestingEngine } from '../engines/evolutionaryEngine'
import { isBetterNestingResult } from '../scoring/fitness'
import type { NestingRequest, NestingResult, NestingSuccess } from '../types'
import type { WorkerInMessage, WorkerOutMessage } from './nestWorker'

/**
 * Runs evolutionary nesting in a Web Worker in browsers.
 * Non-browser callers fall back to the direct engine.
 * STOP hard-terminates the worker and returns the latest progress snapshot.
 */
export class WorkerNestingEngine implements NestingEngine {
  readonly id = 'evolutionary-worker-v1'

  async nest(
    request: NestingRequest,
    options?: NestingRunOptions,
  ): Promise<NestingResult> {
    if (typeof Worker === 'undefined') {
      if (options?.signal?.aborted) {
        return {
          status: 'cancelled',
          message: 'Stopped before nesting started',
          bestSoFar: null,
        }
      }
      if (typeof window !== 'undefined') {
        throw new Error('Nesting requires Web Worker support')
      }
      return evolutionaryNestingEngine.nest(request, options)
    }

    const worker = new Worker(new URL('./nestWorker.ts', import.meta.url), {
      type: 'module',
    })
    const requestId =
      options?.jobId ??
      `nest-${Date.now()}-${Math.random().toString(36).slice(2)}`

    return new Promise<NestingResult>((resolve, reject) => {
      let settled = false
      let lastBest: NestingSuccess | null = null

      const finish = (result: NestingResult) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }

      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }

      const onAbort = () => {
        finish({
          status: 'cancelled',
          message: 'Stopped — worker terminated',
          bestSoFar: lastBest,
        })
      }

      options?.signal?.addEventListener('abort', onAbort)
      if (options?.signal?.aborted) {
        onAbort()
        return
      }

      worker.onmessage = (ev: MessageEvent<WorkerOutMessage>) => {
        const msg = ev.data
        if (msg.requestId !== requestId) return
        if (msg.type === 'attempts') {
          try {
            options?.onAttempts?.({ attempts: msg.attempts, jobId: requestId })
          } catch {
            // UI telemetry is observation-only.
          }
          return
        }
        if (msg.type === 'progress') {
          const candidate = msg.progress.bestSoFar
          if (
            candidate?.status === 'ok' &&
            (!lastBest || isBetterNestingResult(candidate, lastBest))
          ) {
            lastBest = candidate
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
          fail(new Error(msg.message))
        }
      }
      worker.onerror = (err) => {
        fail(err.error ?? new Error('Nesting worker error'))
      }

      function cleanup() {
        options?.signal?.removeEventListener('abort', onAbort)
        try {
          worker.terminate()
        } catch {
          /* ignore */
        }
      }

      const start: WorkerInMessage = {
        type: 'nest',
        requestId,
        request,
        traceAttempts: options?.onAttempts != null,
      }
      try {
        worker.postMessage(start)
      } catch (error) {
        fail(error)
      }
    })
  }
}

export const workerNestingEngine = new WorkerNestingEngine()
