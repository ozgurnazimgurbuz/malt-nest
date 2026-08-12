// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { boundingBox, type GeometryPart } from '../geometry'
import type { NestingSuccess, Placement } from '../nesting'
import { DEFAULT_NEST, type SvgMeta } from '../state'
import { Workspace, type LiveNestTrace, type TimedNestAttempt } from '../ui'
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
const attemptB: TimedNestAttempt = {
  sequence: 1,
  partId: 'b',
  sheetIndex: 0,
  x: 5,
  y: 6,
  rotation: 0,
  verdict: 'rejected',
  receivedAtMs: performance.now(),
}

const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  fillStyle: '',
  globalAlpha: 1,
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
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
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

it('renders committed placements and the current attempted part separately', async () => {
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
        attempts: [attemptB],
        current: attemptB,
      }),
    ),
  )

  expect(container.querySelectorAll('.nest-preview__outer')).toHaveLength(1)
  expect(container.querySelector('.nest-preview__attempt-ghost')).not.toBeNull()
  expect(container.querySelector('.nest-attempt-trail')).not.toBeNull()
  expect(context.arc).toHaveBeenCalled()

  await act(async () => root.unmount())
  container.remove()
})

it('does not mount attempt rendering without live attempts', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () =>
    root.render(
      createElement(NestPreview, {
        sheet: { widthMm: 100, heightMm: 100 },
        marginMm: 0,
        parts: [partA],
        placements: [placementA],
        sheetIndex: 0,
      }),
    ),
  )

  expect(container.querySelector('.nest-attempt-trail')).toBeNull()
  expect(container.querySelector('.nest-preview__attempt-ghost')).toBeNull()

  await act(async () => root.unmount())
  container.remove()
})

it('shows the live sheet and committed snapshot while nesting', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const committed: NestingSuccess = {
    status: 'ok',
    placements: [{ ...placementA, sheetIndex: 1 }],
    sheets: [
      {
        sheetIndex: 1,
        widthMm: 100,
        heightMm: 100,
        placedCount: 1,
        utilization: 0.01,
        wasteMm2: 9_900,
        usedBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      },
    ],
    unplacedPartIds: [],
    utilization: 0.01,
    wasteMm2: 9_900,
    calculationTimeMs: 1,
    statistics: {
      partCount: 1,
      placedCount: 1,
      unplacedCount: 0,
      sheetCountUsed: 1,
      totalPartAreaMm2: 100,
      totalSheetAreaMm2: 10_000,
      overallUtilization: 0.01,
      overallWasteMm2: 9_900,
    },
    engineId: 'test',
  }
  const current = { ...attemptB, sheetIndex: 1 }
  const liveTrace: LiveNestTrace = {
    jobId: 'job-1',
    trail: [current],
    current,
    sheetIndex: 1,
    committed,
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
  expect(container.textContent).toContain('Nest sheet 2')
  expect(container.querySelectorAll('.nest-preview__outer')).toHaveLength(1)

  await act(async () => root.unmount())
  container.remove()
})
