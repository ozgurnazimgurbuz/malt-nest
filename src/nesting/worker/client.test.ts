import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  NestAttempt,
  NestAttemptBatch,
  NestingRequest,
  NestingSuccess,
} from '../types'

const evolutionaryNest = vi.hoisted(() => vi.fn())

vi.mock('../engines/evolutionaryEngine', () => ({
  evolutionaryNestingEngine: { nest: evolutionaryNest },
}))

import { WorkerNestingEngine } from './client'

const request: NestingRequest = {
  parts: [],
  sheets: [{ widthMm: 100, heightMm: 100, marginMm: 0, quantity: 1 }],
  settings: {
    spacingMm: 0,
    allowedRotations: [0],
    allowArbitraryRotation: false,
    optimizationLevel: 'fast',
    timeLimitMs: 100,
  },
}

const fallbackResult: NestingSuccess = {
  status: 'ok',
  placements: [],
  sheets: [],
  unplacedPartIds: [],
  utilization: 0,
  wasteMm2: 0,
  calculationTimeMs: 0,
  statistics: {
    partCount: 0,
    placedCount: 0,
    unplacedCount: 0,
    sheetCountUsed: 0,
    totalPartAreaMm2: 0,
    totalSheetAreaMm2: 0,
    overallUtilization: 0,
    overallWasteMm2: 0,
  },
  engineId: 'fallback',
}

const attempt = (sequence: number): NestAttempt => ({
  sequence,
  partId: `part-${sequence}`,
  sheetIndex: 0,
  x: sequence,
  y: 0,
  rotation: 0,
  verdict: 'rejected',
})

class FakeWorker {
  static mode: 'idle' | 'error' | 'throw' = 'idle'
  static latest: FakeWorker | null = null

  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: unknown[] = []
  readonly terminate = vi.fn()

  constructor() {
    FakeWorker.latest = this
  }

  postMessage(message: unknown) {
    if (FakeWorker.mode === 'throw') throw new Error('startup failed')
    this.messages.push(message)
    if (FakeWorker.mode === 'error') {
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            type: 'error',
            requestId: 'job-1',
            message: 'worker exploded',
          },
        } as MessageEvent)
      })
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  evolutionaryNest.mockReset()
  FakeWorker.mode = 'idle'
  FakeWorker.latest = null
})

describe('WorkerNestingEngine', () => {
  it('opts into tracing and forwards only matching attempt batches', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const received: NestAttemptBatch[] = []
    const pending = new WorkerNestingEngine().nest(request, {
      jobId: 'job-1',
      onAttempts: (batch) => received.push(batch),
    })

    expect(FakeWorker.latest?.messages[0]).toMatchObject({
      traceAttempts: true,
    })
    FakeWorker.latest?.onmessage?.({
      data: {
        type: 'attempts',
        requestId: 'other',
        attempts: [attempt(0)],
      },
    } as MessageEvent)
    FakeWorker.latest?.onmessage?.({
      data: {
        type: 'attempts',
        requestId: 'job-1',
        attempts: [attempt(1)],
      },
    } as MessageEvent)
    FakeWorker.latest?.onmessage?.({
      data: {
        type: 'completed',
        requestId: 'job-1',
        result: fallbackResult,
      },
    } as MessageEvent)

    await pending
    expect(received).toEqual([
      { attempts: [attempt(1)], jobId: 'job-1' },
    ])
  })

  it('keeps tracing disabled when no attempt listener is present', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const pending = new WorkerNestingEngine().nest(request, { jobId: 'job-1' })

    expect(FakeWorker.latest?.messages[0]).toMatchObject({
      traceAttempts: false,
    })
    FakeWorker.latest?.onmessage?.({
      data: {
        type: 'completed',
        requestId: 'job-1',
        result: fallbackResult,
      },
    } as MessageEvent)

    await expect(pending).resolves.toBe(fallbackResult)
  })

  it('isolates attempt-listener failures from worker completion', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    let calls = 0
    const pending = new WorkerNestingEngine().nest(request, {
      jobId: 'job-1',
      onAttempts: () => {
        calls += 1
        throw new Error('render failed')
      },
    })

    FakeWorker.latest?.onmessage?.({
      data: {
        type: 'attempts',
        requestId: 'job-1',
        attempts: [attempt(0)],
      },
    } as MessageEvent)
    FakeWorker.latest?.onmessage?.({
      data: {
        type: 'completed',
        requestId: 'job-1',
        result: fallbackResult,
      },
    } as MessageEvent)

    await expect(pending).resolves.toBe(fallbackResult)
    expect(calls).toBe(1)
  })

  it('uses the evolutionary engine outside a browser when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined)
    vi.stubGlobal('window', undefined)
    evolutionaryNest.mockResolvedValue(fallbackResult)

    const result = await new WorkerNestingEngine().nest(request)

    expect(result).toBe(fallbackResult)
    expect(evolutionaryNest).toHaveBeenCalledWith(request, undefined)
  })

  it('fails instead of blocking the browser thread when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined)

    await expect(new WorkerNestingEngine().nest(request)).rejects.toThrow(
      'requires Web Worker support',
    )
    expect(evolutionaryNest).not.toHaveBeenCalled()
  })

  it('returns cancellation before entering a non-worker fallback', async () => {
    vi.stubGlobal('Worker', undefined)
    const controller = new AbortController()
    controller.abort()

    await expect(
      new WorkerNestingEngine().nest(request, { signal: controller.signal }),
    ).resolves.toMatchObject({ status: 'cancelled' })
    expect(evolutionaryNest).not.toHaveBeenCalled()
  })

  it('reports worker errors without repeating nesting on the UI thread', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    FakeWorker.mode = 'error'
    await expect(
      new WorkerNestingEngine().nest(request, { jobId: 'job-1' }),
    ).rejects.toThrow('worker exploded')
    expect(evolutionaryNest).not.toHaveBeenCalled()
  })

  it('cleans up and reports when worker startup throws', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    FakeWorker.mode = 'throw'
    await expect(
      new WorkerNestingEngine().nest(request, { jobId: 'job-1' }),
    ).rejects.toThrow('startup failed')
    expect(FakeWorker.latest?.terminate).toHaveBeenCalledOnce()
    expect(evolutionaryNest).not.toHaveBeenCalled()
  })

  it('hard-terminates immediately on cancellation without pretending it is cooperative', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const controller = new AbortController()

    const pending = new WorkerNestingEngine().nest(request, {
      jobId: 'job-1',
      signal: controller.signal,
    })
    controller.abort()
    const result = await pending

    expect(result).toMatchObject({ status: 'cancelled' })
    expect(FakeWorker.latest?.terminate).toHaveBeenCalledOnce()
    expect(FakeWorker.latest?.messages).toEqual([
      expect.objectContaining({ type: 'nest', requestId: 'job-1' }),
    ])
    expect(evolutionaryNest).not.toHaveBeenCalled()
  })

  it('keeps the canonical best snapshot when later progress is worse', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const controller = new AbortController()
    const better: NestingSuccess = {
      ...fallbackResult,
      wasteMm2: 10,
      utilization: 0.9,
      engineId: 'better',
    }
    const worse: NestingSuccess = {
      ...fallbackResult,
      wasteMm2: 100,
      utilization: 0.1,
      engineId: 'worse',
    }

    const pending = new WorkerNestingEngine().nest(request, {
      jobId: 'job-1',
      signal: controller.signal,
    })
    for (const bestSoFar of [better, worse]) {
      FakeWorker.latest?.onmessage?.({
        data: {
          type: 'progress',
          requestId: 'job-1',
          progress: {
            phase: 'optimize',
            ratio: 0.5,
            bestSoFar,
          },
        },
      } as MessageEvent)
    }
    controller.abort()

    await expect(pending).resolves.toMatchObject({
      status: 'cancelled',
      bestSoFar: { engineId: 'better' },
    })
  })
})
