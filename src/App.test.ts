// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeometryPart } from './geometry'
import { boundingBox } from './geometry'
import type { NestAttempt, NestingResult, NestingSuccess } from './nesting'
import type { SvgMeta } from './state'
import type { LiveNestPlaybackSink } from './ui'

const mocks = vi.hoisted(() => ({
  nestAsync: vi.fn(),
  readSvgFile: vi.fn(),
  settingsProps: null as Record<string, any> | null,
  workspaceProps: null as Record<string, any> | null,
  workspaceRenderCount: 0,
}))

vi.mock('./nesting', async () => ({
  ...(await vi.importActual<typeof import('./nesting')>('./nesting')),
  nestAsync: mocks.nestAsync,
}))

vi.mock('./svg', async () => ({
  ...(await vi.importActual<typeof import('./svg')>('./svg')),
  readSvgFile: mocks.readSvgFile,
}))

vi.mock('./ui', async () => ({
  ...(await vi.importActual<typeof import('./ui')>('./ui')),
  SettingsPanel: (props: Record<string, any>) => {
    mocks.settingsProps = props
    return null
  },
  Workspace: (props: Record<string, any>) => {
    mocks.workspaceProps = props
    mocks.workspaceRenderCount += 1
    return null
  },
}))

import App from './App'

const points = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]
const part: GeometryPart = {
  id: 'part-0',
  sourceElement: 'rect',
  originalIndex: 0,
  sourceId: 'rect',
  outer: { points },
  holes: [],
  boundingBox: boundingBox(points),
  area: 100,
  centroid: { x: 5, y: 5 },
  originalTransform: null,
}

function meta(fileName: string): SvgMeta {
  return {
    fileName,
    raw: '<svg/>',
    width: 10,
    height: 10,
    partCount: 1,
    parts: [part],
    warnings: [],
    bounds: part.boundingBox,
    totalArea: part.area,
  }
}

function result({
  unplaced = 0,
  sheets = 1,
  waste = 100,
}: {
  unplaced?: number
  sheets?: number
  waste?: number
} = {}): NestingSuccess {
  const placed = unplaced === 0
  return {
    status: 'ok',
    placements: placed
      ? [{ partId: part.id, sheetIndex: 0, x: 0, y: 0, rotation: 0 }]
      : [],
    sheets: Array.from({ length: sheets }, (_, sheetIndex) => ({
      sheetIndex,
      widthMm: 100,
      heightMm: 100,
      placedCount: sheetIndex === 0 && placed ? 1 : 0,
      utilization: placed ? 0.01 : 0,
      wasteMm2: waste / sheets,
      usedBounds:
        sheetIndex === 0 && placed
          ? { minX: 0, minY: 0, maxX: 10, maxY: 10 }
          : null,
    })),
    unplacedPartIds: placed ? [] : [part.id],
    utilization: placed ? 0.01 : 0,
    wasteMm2: waste,
    calculationTimeMs: 1,
    statistics: {
      partCount: 1,
      placedCount: placed ? 1 : 0,
      unplacedCount: unplaced,
      sheetCountUsed: sheets,
      totalPartAreaMm2: 100,
      totalSheetAreaMm2: sheets * 10_000,
      overallUtilization: placed ? 0.01 : 0,
      overallWasteMm2: waste,
    },
    engineId: 'test',
  }
}

function attempt(sequence = 0, sheetIndex = 0): NestAttempt {
  return {
    sequence,
    partId: part.id,
    sheetIndex,
    x: sequence,
    y: sequence,
    rotation: 0,
    verdict: 'rejected',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const frames: FrameRequestCallback[] = []

function nextFrame(now: number) {
  const callback = frames.shift()
  expect(callback).toBeTypeOf('function')
  act(() => callback!(now))
}

function attachLiveSink() {
  const shown: number[] = []
  const events: string[] = []
  const sink: LiveNestPlaybackSink = {
    renderAttempt(value) {
      shown.push(value.sequence)
      events.push(`attempt:${value.sequence}`)
      return false
    },
    renderCommit(placements) {
      events.push(`commit:${placements.length}`)
      return false
    },
    renderIdle: () => false,
    clear: vi.fn(),
  }
  mocks.workspaceProps!.liveTrace.playback.attach(sink)
  return { events, shown, sink }
}

let root: Root
let mounted = false

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mocks.nestAsync.mockReset()
  mocks.readSvgFile.mockReset()
  mocks.settingsProps = null
  mocks.workspaceProps = null
  mocks.workspaceRenderCount = 0
  frames.length = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(App)))
  mounted = true
})

afterEach(async () => {
  if (mounted) await act(async () => root.unmount())
  mounted = false
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('App nesting run lifecycle', () => {
  it('enables attempt telemetry only when nest debug is on', async () => {
    mocks.readSvgFile.mockResolvedValue(meta('a.svg'))
    await act(async () => mocks.settingsProps!.onFile(new File([], 'a.svg')))
    mocks.nestAsync.mockReturnValue(deferred<NestingResult>().promise)

    act(() => mocks.settingsProps!.onAutoNest())
    expect(mocks.nestAsync.mock.calls[0]![1].onAttempts).toBeUndefined()

    act(() => mocks.settingsProps!.onNestDebug(true))
    act(() => mocks.settingsProps!.onNewIteration())
    expect(mocks.nestAsync.mock.calls[1]![1].onAttempts).toEqual(
      expect.any(Function),
    )
    expect(mocks.workspaceProps!.liveTrace).not.toBeNull()
  })

  it('plays one attempt per frame and applies the following commit afterward', async () => {
    mocks.readSvgFile.mockResolvedValue(meta('a.svg'))
    await act(async () => mocks.settingsProps!.onFile(new File([], 'a.svg')))
    const pending = deferred<NestingResult>()
    mocks.nestAsync.mockReturnValue(pending.promise)
    act(() => mocks.settingsProps!.onNestDebug(true))
    act(() => mocks.settingsProps!.onAutoNest())
    const options = mocks.nestAsync.mock.calls[0]![1]
    const jobId = options.jobId as string

    const partial = result()
    const { events, shown } = attachLiveSink()
    options.onAttempts({
      jobId,
      attempts: [attempt(0), attempt(1, 1)],
    })
    act(() =>
      options.onProgress({
        phase: 'seed',
        ratio: 0.5,
        attemptPass: 'canonical-blf',
        bestSoFar: partial,
      }),
    )

    expect(shown).toEqual([])
    nextFrame(16)
    expect(shown).toEqual([0])
    nextFrame(32)
    expect(shown).toEqual([0, 1])
    expect(mocks.workspaceProps!.liveTrace.sheetIndex).toBe(1)
    expect(mocks.workspaceProps!.liveTrace.placements).toEqual([])
    nextFrame(48)
    expect(events).toEqual(['attempt:0', 'attempt:1', 'commit:1'])
    expect(mocks.workspaceProps!.liveTrace.placements).toEqual(
      partial.placements,
    )
    expect(mocks.settingsProps!.nestResult).toBeNull()
  })

  it('ignores stale attempts and noncanonical snapshots before playback', async () => {
    mocks.readSvgFile.mockResolvedValue(meta('a.svg'))
    await act(async () => mocks.settingsProps!.onFile(new File([], 'a.svg')))
    mocks.nestAsync.mockReturnValue(deferred<NestingResult>().promise)
    act(() => mocks.settingsProps!.onNestDebug(true))
    act(() => mocks.settingsProps!.onAutoNest())
    const options = mocks.nestAsync.mock.calls[0]![1]
    const { events } = attachLiveSink()

    options.onAttempts({ jobId: 'old-job', attempts: [attempt()] })
    act(() =>
      options.onProgress({
        phase: 'seed',
        ratio: 0.5,
        bestSoFar: result(),
      }),
    )
    expect(frames).toHaveLength(0)
    expect(events).toEqual([])
  })

  it('keeps calculating until the final attempted position has painted', async () => {
    mocks.readSvgFile.mockResolvedValue(meta('a.svg'))
    await act(async () => mocks.settingsProps!.onFile(new File([], 'a.svg')))
    act(() => mocks.settingsProps!.onNestDebug(true))

    const completed = deferred<NestingResult>()
    mocks.nestAsync.mockReturnValue(completed.promise)
    act(() => mocks.settingsProps!.onAutoNest())
    const options = mocks.nestAsync.mock.calls[0]![1]
    const { shown } = attachLiveSink()
    options.onAttempts({ jobId: options.jobId, attempts: [attempt()] })
    completed.resolve(result())
    await flush()

    expect(mocks.settingsProps!.nestResult).toBeNull()
    expect(mocks.workspaceProps!.calculating).toBe(true)
    nextFrame(16)
    await flush()
    expect(shown).toEqual([0])
    expect(mocks.settingsProps!.nestResult).toBeNull()
    nextFrame(32)
    await flush()
    expect(mocks.settingsProps!.nestResult).not.toBeNull()
    expect(mocks.workspaceProps!.liveTrace).toBeNull()
    expect(mocks.workspaceProps!.calculating).toBe(false)
  })

  it('cancels queued playback immediately for non-ok results and errors', async () => {
    mocks.readSvgFile.mockResolvedValue(meta('a.svg'))
    await act(async () => mocks.settingsProps!.onFile(new File([], 'a.svg')))
    act(() => mocks.settingsProps!.onNestDebug(true))

    const cancelled = deferred<NestingResult>()
    mocks.nestAsync.mockReturnValueOnce(cancelled.promise)
    act(() => mocks.settingsProps!.onAutoNest())
    let options = mocks.nestAsync.mock.calls[0]![1]
    let attached = attachLiveSink()
    options.onAttempts({ jobId: options.jobId, attempts: [attempt()] })
    cancelled.resolve({ status: 'cancelled', message: 'stopped' })
    await flush()
    expect(mocks.workspaceProps!.liveTrace).toBeNull()
    expect(attached.sink.clear).toHaveBeenCalledOnce()
    nextFrame(16)
    expect(attached.shown).toEqual([])

    const failed = deferred<NestingResult>()
    mocks.nestAsync.mockReturnValueOnce(failed.promise)
    act(() => mocks.settingsProps!.onNewIteration())
    options = mocks.nestAsync.mock.calls[1]![1]
    attached = attachLiveSink()
    options.onAttempts({ jobId: options.jobId, attempts: [attempt(1)] })
    failed.reject(new Error('failed'))
    await flush()
    expect(mocks.workspaceProps!.liveTrace).toBeNull()
    expect(attached.sink.clear).toHaveBeenCalledOnce()
    nextFrame(32)
    expect(attached.shown).toEqual([])
  })

  it('cancels and clears playback on STOP without applying queued frames', async () => {
    mocks.readSvgFile.mockResolvedValue(meta('a.svg'))
    await act(async () => mocks.settingsProps!.onFile(new File([], 'a.svg')))
    mocks.nestAsync.mockReturnValue(deferred<NestingResult>().promise)
    act(() => mocks.settingsProps!.onNestDebug(true))
    act(() => mocks.settingsProps!.onAutoNest())
    const options = mocks.nestAsync.mock.calls[0]![1]
    const { shown, sink } = attachLiveSink()
    options.onAttempts({
      jobId: options.jobId,
      attempts: [attempt(0), attempt(1)],
    })

    act(() => mocks.settingsProps!.onStopNest())

    expect(options.signal.aborted).toBe(true)
    expect(mocks.workspaceProps!.liveTrace).toBeNull()
    expect(sink.clear).toHaveBeenCalledOnce()
    expect(mocks.settingsProps!.nestProgress.title).toContain('Durdur')
    nextFrame(16)
    expect(shown).toEqual([])
  })

  it('cancels visualization when debug turns off without aborting nesting', async () => {
    mocks.readSvgFile.mockResolvedValue(meta('a.svg'))
    await act(async () => mocks.settingsProps!.onFile(new File([], 'a.svg')))
    mocks.nestAsync.mockReturnValue(deferred<NestingResult>().promise)
    act(() => mocks.settingsProps!.onNestDebug(true))
    act(() => mocks.settingsProps!.onAutoNest())
    const options = mocks.nestAsync.mock.calls[0]![1]
    const { shown, sink } = attachLiveSink()
    options.onAttempts({ jobId: options.jobId, attempts: [attempt()] })

    act(() => mocks.settingsProps!.onNestDebug(false))

    expect(options.signal.aborted).toBe(false)
    expect(mocks.workspaceProps!.liveTrace).toBeNull()
    expect(sink.clear).toHaveBeenCalledOnce()
    nextFrame(16)
    expect(shown).toEqual([])
  })

  it('does not render App for same-sheet attempt frames', async () => {
    mocks.readSvgFile.mockResolvedValue(meta('a.svg'))
    await act(async () => mocks.settingsProps!.onFile(new File([], 'a.svg')))
    mocks.nestAsync.mockReturnValue(deferred<NestingResult>().promise)
    act(() => mocks.settingsProps!.onNestDebug(true))
    act(() => mocks.settingsProps!.onAutoNest())
    const options = mocks.nestAsync.mock.calls[0]![1]
    const { shown } = attachLiveSink()
    const rendersBeforeAttempts = mocks.workspaceRenderCount

    options.onAttempts({
      jobId: options.jobId,
      attempts: [attempt(0), attempt(1)],
    })
    nextFrame(16)
    nextFrame(32)

    expect(shown).toEqual([0, 1])
    expect(mocks.workspaceRenderCount).toBe(rendersBeforeAttempts)
  })

  it('ignores an older file read that resolves after a newer selection', async () => {
    const oldRead = deferred<SvgMeta>()
    const newRead = deferred<SvgMeta>()
    mocks.readSvgFile.mockImplementation((file: File) =>
      file.name === 'old.svg' ? oldRead.promise : newRead.promise,
    )

    let oldPromise!: Promise<void>
    let newPromise!: Promise<void>
    act(() => {
      oldPromise = mocks.settingsProps!.onFile(new File([], 'old.svg'))
      newPromise = mocks.settingsProps!.onFile(new File([], 'new.svg'))
    })
    newRead.resolve(meta('new.svg'))
    await act(async () => newPromise)
    oldRead.resolve(meta('old.svg'))
    await act(async () => oldPromise)

    expect(mocks.settingsProps!.svg.fileName).toBe('new.svg')
  })

  it('aborts and invalidates a running job when nesting settings change', async () => {
    mocks.readSvgFile.mockResolvedValue(meta('a.svg'))
    await act(async () => mocks.settingsProps!.onFile(new File([], 'a.svg')))
    const pending = deferred<NestingSuccess>()
    mocks.nestAsync.mockReturnValue(pending.promise)

    act(() => mocks.settingsProps!.onNestDebug(true))
    act(() => mocks.settingsProps!.onAutoNest())
    const options = mocks.nestAsync.mock.calls[0]![1]
    const { shown, sink } = attachLiveSink()
    options.onAttempts({ jobId: options.jobId, attempts: [attempt()] })
    expect(mocks.workspaceProps!.liveTrace).not.toBeNull()
    const signal = mocks.nestAsync.mock.calls[0]![1].signal as AbortSignal
    pending.resolve(result())
    await flush()
    expect(mocks.settingsProps!.nestResult).toBeNull()
    expect(mocks.settingsProps!.calculating).toBe(true)
    act(() =>
      mocks.settingsProps!.onNest({
        ...mocks.settingsProps!.nest,
        gapMm: 9,
      }),
    )

    expect(signal.aborted).toBe(true)
    expect(mocks.settingsProps!.calculating).toBe(false)
    expect(mocks.settingsProps!.nestResult).toBeNull()
    expect(mocks.settingsProps!.nestProgress).toBeNull()
    expect(mocks.workspaceProps!.liveTrace).toBeNull()
    expect(sink.clear).toHaveBeenCalledOnce()
    nextFrame(16)
    expect(shown).toEqual([])

    await flush()
    expect(mocks.settingsProps!.nestResult).toBeNull()
  })

  it('aborts a running job as soon as a replacement file is selected', async () => {
    mocks.readSvgFile.mockResolvedValueOnce(meta('a.svg'))
    await act(async () => mocks.settingsProps!.onFile(new File([], 'a.svg')))
    const pendingNest = deferred<NestingSuccess>()
    const pendingFile = deferred<SvgMeta>()
    mocks.nestAsync.mockReturnValue(pendingNest.promise)
    mocks.readSvgFile.mockReturnValue(pendingFile.promise)

    act(() => mocks.settingsProps!.onNestDebug(true))
    act(() => mocks.settingsProps!.onAutoNest())
    const options = mocks.nestAsync.mock.calls[0]![1]
    const { shown, sink } = attachLiveSink()
    options.onAttempts({ jobId: options.jobId, attempts: [attempt()] })
    const signal = mocks.nestAsync.mock.calls[0]![1].signal as AbortSignal
    act(() => {
      void mocks.settingsProps!.onFile(new File([], 'b.svg'))
    })

    expect(signal.aborted).toBe(true)
    expect(mocks.settingsProps!.calculating).toBe(false)
    expect(mocks.settingsProps!.nestResult).toBeNull()
    expect(mocks.settingsProps!.svg).toBeNull()
    expect(mocks.workspaceProps!.liveTrace).toBeNull()
    expect(sink.clear).toHaveBeenCalledOnce()
    nextFrame(16)
    expect(shown).toEqual([])

    pendingFile.resolve(meta('b.svg'))
    pendingNest.resolve(result())
    await flush()
  })

  it('cancels an older playback before starting its replacement run', async () => {
    mocks.readSvgFile.mockResolvedValue(meta('a.svg'))
    await act(async () => mocks.settingsProps!.onFile(new File([], 'a.svg')))
    mocks.nestAsync.mockReturnValue(deferred<NestingResult>().promise)
    act(() => mocks.settingsProps!.onNestDebug(true))
    act(() => mocks.settingsProps!.onAutoNest())
    const oldOptions = mocks.nestAsync.mock.calls[0]![1]
    const oldPlayback = mocks.workspaceProps!.liveTrace.playback
    const { shown, sink } = attachLiveSink()
    oldOptions.onAttempts({
      jobId: oldOptions.jobId,
      attempts: [attempt(0), attempt(1)],
    })

    act(() => mocks.settingsProps!.onNewIteration())

    expect(oldOptions.signal.aborted).toBe(true)
    expect(sink.clear).toHaveBeenCalledOnce()
    expect(mocks.workspaceProps!.liveTrace.playback).not.toBe(oldPlayback)
    nextFrame(16)
    expect(shown).toEqual([])
  })

  it('clears a completed result and iteration history when the sheet changes', async () => {
    mocks.readSvgFile.mockResolvedValue(meta('a.svg'))
    await act(async () => mocks.settingsProps!.onFile(new File([], 'a.svg')))
    mocks.nestAsync.mockResolvedValue(result())
    act(() => mocks.settingsProps!.onAutoNest())
    await flush()
    expect(mocks.settingsProps!.nestResult).not.toBeNull()

    act(() =>
      mocks.settingsProps!.onSheet({
        ...mocks.settingsProps!.sheet,
        widthMm: 500,
      }),
    )

    expect(mocks.settingsProps!.nestResult).toBeNull()
    expect(mocks.settingsProps!.nestProgress).toBeNull()
    expect(mocks.settingsProps!.iterationCount).toBe(0)
    expect(mocks.settingsProps!.bestIteration).toBe(0)
  })

  it('varies non-deterministic iteration seeds but preserves deterministic seeds', async () => {
    mocks.readSvgFile.mockResolvedValue(meta('a.svg'))
    await act(async () => mocks.settingsProps!.onFile(new File([], 'a.svg')))
    mocks.nestAsync.mockResolvedValue(result())

    act(() => mocks.settingsProps!.onAutoNest())
    await flush()
    act(() => mocks.settingsProps!.onNewIteration())
    await flush()
    const exploratorySeeds = mocks.nestAsync.mock.calls
      .slice(0, 2)
      .map((call) => call[0].settings.seed)
    expect(exploratorySeeds[0]).toBe(42)
    expect(exploratorySeeds[1]).not.toBe(exploratorySeeds[0])

    act(() =>
      mocks.settingsProps!.onNest({
        ...mocks.settingsProps!.nest,
        deterministic: true,
      }),
    )
    mocks.nestAsync.mockClear()
    act(() => mocks.settingsProps!.onAutoNest())
    await flush()
    act(() => mocks.settingsProps!.onNewIteration())
    await flush()
    expect(mocks.nestAsync.mock.calls.map((call) => call[0].settings.seed)).toEqual([
      42,
      42,
    ])

    act(() =>
      mocks.settingsProps!.onNest({
        ...mocks.settingsProps!.nest,
        seed: Number.MAX_VALUE,
        deterministic: false,
      }),
    )
    mocks.nestAsync.mockClear()
    act(() => mocks.settingsProps!.onAutoNest())
    await flush()
    act(() => mocks.settingsProps!.onNewIteration())
    await flush()
    const extremeSeeds = mocks.nestAsync.mock.calls.map(
      (call) => call[0].settings.seed,
    )
    expect(extremeSeeds[1]).not.toBe(extremeSeeds[0])
  })

  it('keeps a feasible best result over a weighted-score-friendly partial result', async () => {
    mocks.readSvgFile.mockResolvedValue(meta('a.svg'))
    await act(async () => mocks.settingsProps!.onFile(new File([], 'a.svg')))
    const complete = result({ sheets: 2, waste: 20_000 })
    const partial = result({ unplaced: 1, sheets: 1, waste: 0 })
    mocks.nestAsync.mockResolvedValueOnce(complete).mockResolvedValueOnce(partial)

    act(() => mocks.settingsProps!.onAutoNest())
    await flush()
    act(() => mocks.settingsProps!.onNewIteration())
    await flush()

    expect(mocks.settingsProps!.nestResult).toBe(complete)
  })

  it('aborts the active worker when the app unmounts', async () => {
    mocks.readSvgFile.mockResolvedValue(meta('a.svg'))
    await act(async () => mocks.settingsProps!.onFile(new File([], 'a.svg')))
    mocks.nestAsync.mockReturnValue(deferred<NestingSuccess>().promise)
    act(() => mocks.settingsProps!.onNestDebug(true))
    act(() => mocks.settingsProps!.onAutoNest())
    const options = mocks.nestAsync.mock.calls[0]![1]
    const { shown, sink } = attachLiveSink()
    options.onAttempts({ jobId: options.jobId, attempts: [attempt()] })

    await act(async () => root.unmount())
    mounted = false

    expect(options.signal.aborted).toBe(true)
    expect(sink.clear).toHaveBeenCalledOnce()
    nextFrame(16)
    expect(shown).toEqual([])
  })
})
