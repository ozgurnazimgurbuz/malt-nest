import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  NestAttempt,
  NestAttemptBatch,
  NestingRequest,
  NestingSuccess,
} from '../types'

const automaticNest = vi.hoisted(() => vi.fn())

vi.mock('../optimization/automaticOptimizer', () => ({
  runAutomaticNest: automaticNest,
}))

import { AutomaticNestingEngine } from '../engines/automaticEngine'
import { defaultNestingEngine } from '../engine'
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
  automaticNest.mockReset()
  FakeWorker.mode = 'idle'
  FakeWorker.latest = null
})

describe('WorkerNestingEngine', () => {
  it('uses automatic engine IDs', () => {
    expect(new AutomaticNestingEngine().id).toBe('automatic-blf-v1')
    expect(new WorkerNestingEngine().id).toBe('automatic-worker-v1')
    expect(defaultNestingEngine.id).toBe('automatic-worker-v1')
  })

  it('adapts direct automatic attempts into isolated job-scoped batches', async () => {
    const received: NestAttemptBatch[] = []
    automaticNest.mockImplementationOnce((_request, options) => {
      options.onProgress({ phase: 'prepare', ratio: 0.02 })
      options.onAttempt(attempt(1))
      return fallbackResult
    })

    const result = await new AutomaticNestingEngine().nest(request, {
      jobId: 'job-direct',
      onProgress: vi.fn(),
      onAttempts: (batch) => {
        received.push(batch)
        throw new Error('render failed')
      },
    })

    expect(result).toBe(fallbackResult)
    expect(received).toEqual([
      { attempts: [attempt(1)], jobId: 'job-direct' },
    ])
    expect(automaticNest).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        seed: request.settings.seed,
        deterministic: false,
      }),
    )
    expect(automaticNest.mock.calls[0]![1]).not.toHaveProperty('timeLimitMs')
  })

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

  it('uses the automatic engine outside a browser when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined)
    vi.stubGlobal('window', undefined)
    automaticNest.mockReturnValue(fallbackResult)

    const result = await new WorkerNestingEngine().nest(request)

    expect(result).toBe(fallbackResult)
    expect(automaticNest).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        seed: request.settings.seed,
        deterministic: false,
      }),
    )
  })

  it('fails instead of blocking the browser thread when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined)

    await expect(new WorkerNestingEngine().nest(request)).rejects.toThrow(
      'requires Web Worker support',
    )
    expect(automaticNest).not.toHaveBeenCalled()
  })

  it('returns cancellation before entering a non-worker fallback', async () => {
    vi.stubGlobal('Worker', undefined)
    const controller = new AbortController()
    controller.abort()

    await expect(
      new WorkerNestingEngine().nest(request, { signal: controller.signal }),
    ).resolves.toMatchObject({ status: 'cancelled' })
    expect(automaticNest).not.toHaveBeenCalled()
  })

  it('reports worker errors without repeating nesting on the UI thread', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    FakeWorker.mode = 'error'
    await expect(
      new WorkerNestingEngine().nest(request, { jobId: 'job-1' }),
    ).rejects.toThrow('worker exploded')
    expect(automaticNest).not.toHaveBeenCalled()
  })

  it('cleans up and reports when worker startup throws', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    FakeWorker.mode = 'throw'
    await expect(
      new WorkerNestingEngine().nest(request, { jobId: 'job-1' }),
    ).rejects.toThrow('startup failed')
    expect(FakeWorker.latest?.terminate).toHaveBeenCalledOnce()
    expect(automaticNest).not.toHaveBeenCalled()
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
    expect(automaticNest).not.toHaveBeenCalled()
  })

  it('protects the retained best snapshot from progress observer mutation', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const controller = new AbortController()
    const best: NestingSuccess = {
      ...fallbackResult,
      placements: [
        { partId: 'part-1', sheetIndex: 0, x: 1, y: 2, rotation: 0 },
      ],
      statistics: {
        ...fallbackResult.statistics,
        partCount: 1,
        placedCount: 1,
      },
      engineId: 'original',
    }
    const pending = new WorkerNestingEngine().nest(request, {
      jobId: 'job-1',
      signal: controller.signal,
      onProgress: (progress) => {
        progress.bestSoFar!.placements.length = 0
        progress.bestSoFar!.statistics.placedCount = 0
      },
    })

    FakeWorker.latest?.onmessage?.({
      data: {
        type: 'progress',
        requestId: 'job-1',
        progress: { phase: 'optimize', ratio: 0.5, bestSoFar: best },
      },
    } as MessageEvent)
    controller.abort()

    const result = await pending
    expect(result.status).toBe('cancelled')
    if (result.status !== 'cancelled') return
    expect(result.bestSoFar?.placements).toHaveLength(1)
    expect(result.bestSoFar?.statistics.placedCount).toBe(1)
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
