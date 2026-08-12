// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { boundingBox, type GeometryPart } from '../geometry'
import type { NestAttempt, NestingSuccess, Placement } from '../nesting'
import { DEFAULT_NEST, type SvgMeta } from '../state'
import {
  createLiveNestPlayback,
  Workspace,
  type LiveNestPlayback,
  type LiveNestTrace,
} from '../ui'
import { NestPreview } from './NestPreview'

function part(id: string, x: number): GeometryPart {
  const points = [
    { x, y: 0 },
    { x: x + 10, y: 0 },
    { x: x + 10, y: 10 },
    { x, y: 10 },
  ]
  return {
    id,
    sourceElement: 'rect',
    originalIndex: x,
    sourceId: id,
    outer: { points },
    holes: [],
    boundingBox: boundingBox(points),
    area: 100,
    centroid: { x: x + 5, y: 5 },
    originalTransform: null,
  }
}

const partA = part('a', 0)
const partB = part('b', 10)
const placementA: Placement = {
  partId: 'a',
  sheetIndex: 0,
  x: 0,
  y: 0,
  rotation: 0,
}

function attempt(
  sequence: number,
  partId: string,
  x: number,
  sheetIndex = 0,
): NestAttempt {
  return {
    sequence,
    partId,
    sheetIndex,
    x,
    y: 6,
    rotation: 0,
    verdict: sequence % 2 === 0 ? 'rejected' : 'accepted',
  }
}

function success(placements: Placement[]): NestingSuccess {
  return {
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
  }
}

const frames: FrameRequestCallback[] = []
const anchorAlphas: number[] = []
let currentAlpha = 1
const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  arc: vi.fn(() => anchorAlphas.push(currentAlpha)),
  fill: vi.fn(),
  stroke: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  setLineDash: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  get globalAlpha() {
    return currentAlpha
  },
  set globalAlpha(value: number) {
    currentAlpha = value
  },
}

const widthDescriptor = Object.getOwnPropertyDescriptor(
  HTMLCanvasElement.prototype,
  'clientWidth',
)
const heightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLCanvasElement.prototype,
  'clientHeight',
)

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 100,
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 100,
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

beforeEach(() => {
  frames.length = 0
  anchorAlphas.length = 0
  currentAlpha = 1
  vi.clearAllMocks()
})

afterAll(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (widthDescriptor) {
    Object.defineProperty(
      HTMLCanvasElement.prototype,
      'clientWidth',
      widthDescriptor,
    )
  }
  if (heightDescriptor) {
    Object.defineProperty(
      HTMLCanvasElement.prototype,
      'clientHeight',
      heightDescriptor,
    )
  }
})

function playback(onCommit = vi.fn()): LiveNestPlayback {
  return createLiveNestPlayback('job-1', {
    onSheetIndex: vi.fn(),
    onCommit,
  })
}

function nextFrame(now: number) {
  const callback = frames.shift()
  expect(callback).toBeTypeOf('function')
  callback!(now)
}

async function renderPreview(livePlayback?: LiveNestPlayback | null) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      createElement(NestPreview, {
        sheet: { widthMm: 100, heightMm: 100 },
        marginMm: 0,
        parts: [partA, partB],
        placements: [placementA],
        sheetIndex: 0,
        playback: livePlayback,
      }),
    ),
  )
  return {
    container,
    async cleanup() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

it('mounts one canvas with playback and no separate attempt SVG', async () => {
  const view = await renderPreview(playback())

  expect(view.container.querySelectorAll('.nest-preview__outer')).toHaveLength(1)
  expect(view.container.querySelectorAll('.nest-attempt-trail')).toHaveLength(1)
  expect(view.container.querySelector('.nest-preview__attempt-svg')).toBeNull()

  await view.cleanup()
})

it('does not mount attempt rendering without playback', async () => {
  const view = await renderPreview()

  expect(view.container.querySelector('.nest-attempt-trail')).toBeNull()
  expect(view.container.querySelector('.nest-preview__attempt-svg')).toBeNull()

  await view.cleanup()
})

it('draws every batched attempt and its current outline on separate display frames', async () => {
  const livePlayback = playback()
  const view = await renderPreview(livePlayback)
  livePlayback.enqueueAttempts({
    jobId: 'job-1',
    attempts: [attempt(0, 'a', 5), attempt(1, 'b', 20)],
  })

  vi.clearAllMocks()
  nextFrame(16)
  expect(context.arc).toHaveBeenCalledOnce()
  expect(context.moveTo).toHaveBeenCalledWith(5, 6)
  expect(context.fill).toHaveBeenCalledWith('evenodd')

  vi.clearAllMocks()
  anchorAlphas.length = 0
  nextFrame(416)
  expect(context.arc).toHaveBeenCalledTimes(2)
  expect(anchorAlphas).toEqual([0.5, 1])
  expect(context.moveTo).toHaveBeenCalledWith(30, 6)
  expect(context.fill).toHaveBeenCalledWith('evenodd')

  await view.cleanup()
})

it('clears previous-sheet anchors before drawing the next-sheet attempt', async () => {
  const livePlayback = playback()
  const view = await renderPreview(livePlayback)
  livePlayback.enqueueAttempts({
    jobId: 'job-1',
    attempts: [attempt(0, 'a', 5), attempt(1, 'b', 20, 1)],
  })

  nextFrame(16)
  vi.clearAllMocks()
  nextFrame(32)

  expect(context.clearRect).toHaveBeenCalledOnce()
  expect(context.arc).toHaveBeenCalledOnce()
  expect(context.moveTo).toHaveBeenCalledOnce()

  await view.cleanup()
})

it('clears the old trail before a cross-sheet commit callback', async () => {
  const order: string[] = []
  const onCommit = vi.fn(() => order.push('commit'))
  const livePlayback = playback(onCommit)
  const view = await renderPreview(livePlayback)
  livePlayback.enqueueAttempts({
    jobId: 'job-1',
    attempts: [attempt(0, 'a', 5)],
  })
  livePlayback.enqueueCommit(
    'job-1',
    success([{ ...placementA, partId: 'b', sheetIndex: 1 }]),
  )

  nextFrame(16)
  vi.clearAllMocks()
  context.clearRect.mockImplementationOnce(() => order.push('draw'))
  nextFrame(32)

  expect(context.arc).not.toHaveBeenCalled()
  expect(context.moveTo).not.toHaveBeenCalled()
  expect(order).toEqual(['draw', 'commit'])

  await view.cleanup()
})

it('cancels playback when the canvas context is unavailable', async () => {
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null)
  const livePlayback = {
    enqueueAttempts: vi.fn(),
    enqueueCommit: vi.fn(),
    attach: vi.fn(() => vi.fn()),
    seal: vi.fn(async () => undefined),
    cancel: vi.fn(),
  } satisfies LiveNestPlayback
  const view = await renderPreview(livePlayback)

  expect(livePlayback.cancel).toHaveBeenCalledOnce()
  expect(livePlayback.attach).not.toHaveBeenCalled()

  await view.cleanup()
})

it('cancels playback without crashing when initial canvas sizing throws', async () => {
  context.setTransform.mockImplementationOnce(() => {
    throw new Error('canvas resize failed')
  })
  const livePlayback = {
    enqueueAttempts: vi.fn(),
    enqueueCommit: vi.fn(),
    attach: vi.fn(() => vi.fn()),
    seal: vi.fn(async () => undefined),
    cancel: vi.fn(),
  } satisfies LiveNestPlayback

  const view = await renderPreview(livePlayback)

  expect(livePlayback.cancel).toHaveBeenCalledOnce()

  await view.cleanup()
})

it('shows live placements and playback while nesting', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const livePlayback = playback()
  const liveTrace: LiveNestTrace = {
    jobId: 'job-1',
    sheetIndex: 1,
    placements: [{ ...placementA, sheetIndex: 1 }],
    playback: livePlayback,
  }
  const svg: SvgMeta = {
    fileName: 'test.svg',
    raw: '<svg/>',
    width: 100,
    height: 100,
    partCount: 2,
    parts: [partA, partB],
    warnings: [],
    bounds: boundingBox([...partA.outer.points, ...partB.outer.points]),
    totalArea: 200,
  }

  await act(async () =>
    root.render(
      createElement(Workspace, {
        svg,
        sheet: { widthMm: 100, heightMm: 100 },
        nest: DEFAULT_NEST,
        status: { kind: 'idle' },
        previewMode: 'svg',
        onPreviewMode: vi.fn(),
        nestResult: null,
        nestSheetIndex: 0,
        onNestSheetIndex: vi.fn(),
        nestDebug: true,
        calculating: true,
        liveTrace,
      }),
    ),
  )

  expect(container.querySelector('.nest-preview')).not.toBeNull()
  expect(container.querySelector('.nest-attempt-trail')).not.toBeNull()
  expect(container.textContent).toContain('Nest sheet 2')
  expect(container.querySelectorAll('.nest-preview__outer')).toHaveLength(1)

  await act(async () => root.unmount())
  container.remove()
})
