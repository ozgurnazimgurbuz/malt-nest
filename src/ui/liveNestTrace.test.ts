import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  NestAttempt,
  NestAttemptBatch,
  NestingSuccess,
  Placement,
} from '../nesting'
import {
  applyLiveCommit,
  applyLiveSheet,
  ATTEMPT_FADE_MS,
  createLiveNestPlayback,
  startLiveNestTrace,
  type LiveNestPlaybackSink,
} from './liveNestTrace'

const frames: FrameRequestCallback[] = []

beforeEach(() => {
  frames.length = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => vi.unstubAllGlobals())

function nextFrame(now: number) {
  const callback = frames.shift()
  expect(callback).toBeTypeOf('function')
  callback!(now)
}

const attempt = (sequence: number, sheetIndex = 0): NestAttempt => ({
  sequence,
  partId: `part-${sequence}`,
  sheetIndex,
  x: sequence,
  y: sequence,
  rotation: 0,
  verdict: sequence % 2 === 0 ? 'rejected' : 'accepted',
})

const placement = (partId: string, sheetIndex = 0): Placement => ({
  partId,
  sheetIndex,
  x: partId.charCodeAt(0),
  y: 0,
  rotation: 0,
})

const success = (placements: Placement[]): NestingSuccess => ({
  status: 'ok',
  placements,
  sheets: [],
  unplacedPartIds: [],
  utilization: 0,
  wasteMm2: 0,
  calculationTimeMs: 0,
  statistics: {
    partCount: placements.length,
    placedCount: placements.length,
    unplacedCount: 0,
    sheetCountUsed: 0,
    totalPartAreaMm2: 0,
    totalSheetAreaMm2: 0,
    overallUtilization: 0,
    overallWasteMm2: 0,
  },
  engineId: 'test',
})

function harness(overrides: Partial<LiveNestPlaybackSink> = {}) {
  const shown: Array<[number, number]> = []
  const commits: Array<{ placements: Placement[]; sheetIndex?: number }> = []
  const sheets: number[] = []
  const sink: LiveNestPlaybackSink = {
    renderAttempt(value, displayedAtMs) {
      shown.push([value.sequence, displayedAtMs])
      return true
    },
    renderCommit() {
      return true
    },
    renderIdle() {
      return false
    },
    clear: vi.fn(),
    ...overrides,
  }
  const playback = createLiveNestPlayback('job-1', {
    onSheetIndex: (sheetIndex) => sheets.push(sheetIndex),
    onCommit: (placements, sheetIndex) => commits.push({ placements, sheetIndex }),
  })
  return { commits, playback, sheets, shown, sink }
}

describe('live nest playback', () => {
  it('uses the public attempt fade duration', () => {
    expect(ATTEMPT_FADE_MS).toBe(800)
  })

  it('displays every attempt from one batch on a distinct frame with display timestamps', () => {
    const { playback, shown, sink } = harness()
    playback.attach(sink)
    playback.enqueueAttempts({
      jobId: 'job-1',
      attempts: [attempt(0), attempt(1), attempt(2)],
    })

    expect(shown).toEqual([])
    nextFrame(16)
    expect(shown).toEqual([[0, 16]])
    nextFrame(32)
    expect(shown).toEqual([[0, 16], [1, 32]])
    nextFrame(48)
    expect(shown).toEqual([[0, 16], [1, 32], [2, 48]])
  })

  it('keeps cross-batch attempts and compact commit deltas in ingress order', () => {
    const commitFrames: Array<[Placement[], number | undefined, number]> = []
    const { commits, playback, shown, sink } = harness({
      renderCommit(placements, sheetIndex, displayedAtMs) {
        commitFrames.push([placements, sheetIndex, displayedAtMs])
        return true
      },
    })
    playback.attach(sink)
    playback.enqueueAttempts({
      jobId: 'job-1',
      attempts: [attempt(0), attempt(1)],
    })
    playback.enqueueCommit('job-1', success([placement('a')]))
    playback.enqueueAttempts({ jobId: 'job-1', attempts: [attempt(2)] })
    playback.enqueueCommit(
      'job-1',
      success([placement('a'), placement('b', 1)]),
    )

    nextFrame(16)
    nextFrame(32)
    nextFrame(48)
    nextFrame(64)
    nextFrame(80)

    expect(shown.map(([sequence]) => sequence)).toEqual([0, 1, 2])
    expect(commits).toEqual([
      { placements: [placement('a')], sheetIndex: 0 },
      { placements: [placement('b', 1)], sheetIndex: 1 },
    ])
    expect(commitFrames).toEqual([
      [[placement('a')], 0, 48],
      [[placement('b', 1)], 1, 80],
    ])
  })

  it('reduces snapshots synchronously and queues empty commit markers', () => {
    const rendered: Placement[][] = []
    const first = placement('a')
    const snapshot = success([first])
    const { commits, playback, sink } = harness({
      renderCommit(placements) {
        rendered.push(placements)
        return false
      },
    })
    playback.attach(sink)
    playback.enqueueCommit('job-1', snapshot)
    snapshot.placements.push(placement('b'))
    playback.enqueueCommit('job-1', success([first]))

    nextFrame(16)
    nextFrame(32)

    expect(rendered).toEqual([[first], []])
    expect(commits).toEqual([
      { placements: [first], sheetIndex: 0 },
      { placements: [], sheetIndex: undefined },
    ])
  })

  it('renders a cross-sheet commit before its callback owns the sheet change', () => {
    const order: string[] = []
    const delta = [placement('a', 1)]
    const sink: LiveNestPlaybackSink = {
      renderAttempt() {
        order.push('attempt:0')
        return false
      },
      renderCommit(placements, sheetIndex, displayedAtMs) {
        order.push(`sink:${placements[0]?.partId}:${sheetIndex}:${displayedAtMs}`)
        return false
      },
      renderIdle: () => false,
      clear: vi.fn(),
    }
    const playback = createLiveNestPlayback('job-1', {
      onSheetIndex: (sheetIndex) => order.push(`sheet:${sheetIndex}`),
      onCommit: (placements, sheetIndex) =>
        order.push(`callback:${placements[0]?.partId}:${sheetIndex}`),
    })
    playback.attach(sink)
    playback.enqueueAttempts({ jobId: 'job-1', attempts: [attempt(0)] })
    playback.enqueueCommit('job-1', success(delta))

    nextFrame(16)
    nextFrame(32)

    expect(order).toEqual(['attempt:0', 'sink:a:1:32', 'callback:a:1'])
  })

  it('ignores stale jobs and all ingress after sealing', async () => {
    const { commits, playback, shown, sink } = harness()
    playback.attach(sink)
    playback.enqueueAttempts({ jobId: 'old', attempts: [attempt(0)] })
    playback.enqueueCommit('old', success([placement('a')]))

    await playback.seal()
    playback.enqueueAttempts({ jobId: 'job-1', attempts: [attempt(1)] })
    playback.enqueueCommit('job-1', success([placement('b')]))

    expect(frames).toHaveLength(0)
    expect(shown).toEqual([])
    expect(commits).toEqual([])
  })

  it('deduplicates sheet callbacks by displayed attempts and lets commits own their sheet', () => {
    const { playback, sheets, sink } = harness()
    playback.attach(sink)
    playback.enqueueAttempts({
      jobId: 'job-1',
      attempts: [attempt(0), attempt(1), attempt(2, 1), attempt(3, 1)],
    })
    playback.enqueueCommit('job-1', success([placement('a', 2)]))
    playback.enqueueAttempts({ jobId: 'job-1', attempts: [attempt(4, 2), attempt(5, 0)] })

    for (let index = 0; index < 7; index += 1) nextFrame((index + 1) * 16)

    expect(sheets).toEqual([1, 0])
  })

  it('starts queued work on attach and preserves it across detach', () => {
    const { playback, shown, sink } = harness()
    playback.enqueueAttempts({ jobId: 'job-1', attempts: [attempt(0)] })

    expect(frames).toHaveLength(0)
    const detach = playback.attach(sink)
    expect(frames).toHaveLength(1)
    detach()
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)

    playback.attach(sink)
    nextFrame(16)
    expect(shown).toEqual([[0, 16]])
  })

  it('retains attempt batches by reference while advancing a read offset', () => {
    const { playback, shown, sink } = harness()
    const batch = { jobId: 'job-1', attempts: [attempt(0), attempt(1)] }
    playback.attach(sink)
    playback.enqueueAttempts(batch)

    nextFrame(16)
    batch.attempts[1] = attempt(9)
    nextFrame(32)

    expect(shown).toEqual([
      [0, 16],
      [9, 32],
    ])
  })

  it('settles a used sealed stream only in the frame after its final event', async () => {
    const { playback, sink } = harness()
    playback.attach(sink)
    playback.enqueueAttempts({
      jobId: 'job-1',
      attempts: [attempt(0)],
    })
    let settled = false
    void playback.seal().then(() => {
      settled = true
    })

    nextFrame(16)
    await Promise.resolve()
    expect(settled).toBe(false)
    nextFrame(32)
    await Promise.resolve()
    expect(settled).toBe(true)
  })

  it('settles seal immediately for a never-used empty stream', async () => {
    const { playback } = harness()
    await expect(playback.seal()).resolves.toBeUndefined()
    expect(frames).toHaveLength(0)
  })

  it('cancels immediately, clears queued references, and resolves a drain waiter', async () => {
    const { playback, shown, sink } = harness()
    playback.attach(sink)
    const batch: NestAttemptBatch = {
      jobId: 'job-1',
      attempts: [attempt(0), attempt(1)],
    }
    playback.enqueueAttempts(batch)
    const drain = playback.seal()

    playback.cancel()
    playback.cancel()

    await expect(drain).resolves.toBeUndefined()
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)
    expect(sink.clear).toHaveBeenCalledTimes(1)
    nextFrame(16)
    expect(shown).toEqual([])
  })

  it('cancels and resolves instead of propagating sink failures', async () => {
    const sink = {
      renderAttempt: vi.fn(() => {
        throw new Error('canvas failed')
      }),
      renderCommit: vi.fn(() => false),
      renderIdle: vi.fn(() => false),
      clear: vi.fn(),
    }
    const playback = createLiveNestPlayback('job-1', {
      onSheetIndex: vi.fn(),
      onCommit: vi.fn(),
    })
    playback.attach(sink)
    playback.enqueueAttempts({ jobId: 'job-1', attempts: [attempt(0)] })
    const drain = playback.seal()

    expect(() => nextFrame(16)).not.toThrow()
    await expect(drain).resolves.toBeUndefined()
    expect(sink.clear).toHaveBeenCalledOnce()
  })

  it('cancels and resolves instead of propagating callback failures', async () => {
    const sink: LiveNestPlaybackSink = {
      renderAttempt: vi.fn(() => false),
      renderCommit: vi.fn(() => false),
      renderIdle: vi.fn(() => false),
      clear: vi.fn(),
    }
    const playback = createLiveNestPlayback('job-1', {
      onSheetIndex: vi.fn(),
      onCommit: vi.fn(() => {
        throw new Error('callback failed')
      }),
    })
    playback.attach(sink)
    playback.enqueueCommit('job-1', success([placement('a')]))
    const drain = playback.seal()

    expect(() => nextFrame(16)).not.toThrow()
    await expect(drain).resolves.toBeUndefined()
    expect(sink.clear).toHaveBeenCalledOnce()
  })
})

describe('live nest trace state', () => {
  it('starts with compact state for a job', () => {
    const { playback } = harness()
    expect(startLiveNestTrace('job-1', playback)).toEqual({
      jobId: 'job-1',
      sheetIndex: 0,
      placements: [],
      playback,
    })
  })

  it('immutably applies matching sheet and append-only commit updates', () => {
    const { playback } = harness()
    const state = startLiveNestTrace('job-1', playback)
    const sameSheet = applyLiveSheet(state, 'job-1', 0)
    const moved = applyLiveSheet(state, 'job-1', 1)
    const committed = applyLiveCommit(moved, 'job-1', [placement('a', 2)], 2)

    expect(sameSheet).toBe(state)
    expect(moved).toEqual({ ...state, sheetIndex: 1 })
    expect(committed).toEqual({
      ...state,
      sheetIndex: 2,
      placements: [placement('a', 2)],
    })
    expect(state).toMatchObject({ sheetIndex: 0, placements: [] })
  })

  it('ignores stale and empty trace updates', () => {
    const { playback } = harness()
    const state = startLiveNestTrace('job-1', playback)

    expect(applyLiveSheet(state, 'old', 1)).toBe(state)
    expect(applyLiveCommit(state, 'old', [placement('a')], 1)).toBe(state)
    expect(applyLiveCommit(state, 'job-1', [])).toBe(state)
    expect(applyLiveSheet(null, 'job-1', 1)).toBeNull()
    expect(applyLiveCommit(null, 'job-1', [placement('a')])).toBeNull()
  })
})
