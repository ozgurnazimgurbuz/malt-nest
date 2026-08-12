import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NestingRequest } from '../types'
import type { WorkerInMessage, WorkerOutMessage } from './nestWorker'

const request: NestingRequest = {
  parts: [],
  sheets: [{ widthMm: 100, heightMm: 100, marginMm: 0, quantity: 1 }],
  settings: {
    spacingMm: 0,
    allowedRotations: [0],
    allowArbitraryRotation: false,
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('nest worker entrypoint', () => {
  it('runs automatic nesting and posts its lifecycle', async () => {
    const posted: WorkerOutMessage[] = []
    const workerScope: {
      onmessage: ((event: MessageEvent<WorkerInMessage>) => void) | null
      postMessage: (message: WorkerOutMessage) => void
    } = {
      onmessage: null,
      postMessage: (message) => posted.push(message),
    }
    vi.stubGlobal('self', workerScope)
    vi.resetModules()
    await import('./nestWorker')

    workerScope.onmessage?.({
      data: {
        type: 'nest',
        requestId: 'job-worker',
        request,
        traceAttempts: false,
      },
    } as MessageEvent<WorkerInMessage>)

    expect(posted[0]).toEqual({ type: 'started', requestId: 'job-worker' })
    expect(posted.some(({ type }) => type === 'progress')).toBe(true)
    const completed = posted.find(({ type }) => type === 'completed')
    expect(completed).toMatchObject({
      type: 'completed',
      requestId: 'job-worker',
      result: { status: 'ok', engineId: 'automatic-blf-v1' },
    })
  })
})
