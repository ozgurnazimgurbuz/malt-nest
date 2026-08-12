import { describe, expect, it, vi } from 'vitest'
import {
  boundingBox,
  centroid,
  configureGeometryTolerance,
  netArea,
  type GeometryPart,
  type Point,
} from '../../geometry'
import { validateNestingRequest } from '../core/validate'
import { placeWithOrder, runBottomLeftNest } from './blf'
import type { NestAttempt, NestingRequest, NestingSettings } from '../types'

const { candidateCalls } = vi.hoisted(() => ({
  candidateCalls: [] as Array<{ partId: string; placedWidths: number[] }>,
}))

vi.mock('../nfp/candidates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../nfp/candidates')>()
  return {
    ...actual,
    collectPlacementCandidates: (
      ...args: Parameters<typeof actual.collectPlacementCandidates>
    ) => {
      candidateCalls.push({
        partId: args[0].partId,
        placedWidths: args[1].map((solid) => solid.bounds.width),
      })
      return actual.collectPlacementCandidates(...args)
    },
  }
})

const baseSettings: NestingSettings = {
  spacingMm: 0,
  allowedRotations: [0],
  rotationStepDeg: null,
  allowArbitraryRotation: false,
  optimizationLevel: 'fast',
  timeLimitMs: 5_000,
}

function polygonPart(
  id: string,
  index: number,
  outer: Point[],
  holes: Point[][] = [],
  area = netArea({ points: outer }, holes.map((points) => ({ points }))),
): GeometryPart {
  const holePolygons = holes.map((points) => ({ points }))
  return {
    id,
    sourceElement: 'path',
    originalIndex: index,
    sourceId: id,
    outer: { points: outer },
    holes: holePolygons,
    boundingBox: boundingBox(outer),
    area,
    centroid: centroid(outer),
    originalTransform: null,
  }
}

function rectPart(
  id: string,
  index: number,
  width: number,
  height: number,
  area = width * height,
): GeometryPart {
  return polygonPart(
    id,
    index,
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    [],
    area,
  )
}

function request(
  parts: GeometryPart[],
  sheet = { widthMm: 10, heightMm: 10, marginMm: 0, quantity: 2 },
  settings: Partial<NestingSettings> = {},
): NestingRequest {
  return {
    parts,
    sheets: [sheet],
    settings: { ...baseSettings, ...settings },
  }
}

function resetCandidateCalls(): void {
  candidateCalls.length = 0
}

function sawCandidateBeside(partId: string, placedWidth: number): boolean {
  return candidateCalls.some(
    (call) =>
      call.partId === partId &&
      call.placedWidths.some((width) => Math.abs(width - placedWidth) < 1e-9),
  )
}

describe('BLF material-area guard', () => {
  it('skips a materially impossible occupied sheet without emitting attempts', () => {
    const req = request([
      rectPart('first', 0, 8, 8),
      rectPart('second', 1, 8, 8),
    ])
    const attempts: NestAttempt[] = []

    resetCandidateCalls()
    const traced = runBottomLeftNest(req, {
      onAttempt: (attempt) => attempts.push(attempt),
    })
    const plain = runBottomLeftNest(req)

    expect(traced.status).toBe('ok')
    expect(plain.status).toBe('ok')
    if (traced.status !== 'ok' || plain.status !== 'ok') return
    expect(traced.placements).toHaveLength(2)
    expect(traced.sheets).toHaveLength(2)
    expect(traced.placements.find((item) => item.partId === 'second'))
      .toMatchObject({ sheetIndex: 1 })
    expect(attempts.filter((item) => item.partId === 'second' && item.sheetIndex === 0))
      .toEqual([])
    expect(sawCandidateBeside('second', 8)).toBe(false)
    expect({ ...traced, calculationTimeMs: 0 }).toEqual({
      ...plain,
      calculationTimeMs: 0,
    })
  })

  it('uses the margin-reduced sheet area for impossible occupied sheets', () => {
    const req = request(
      [rectPart('first', 0, 8, 8), rectPart('second', 1, 8, 8)],
      { widthMm: 12, heightMm: 12, marginMm: 1, quantity: 2 },
    )
    const attempts: NestAttempt[] = []

    const result = runBottomLeftNest(req, {
      onAttempt: (attempt) => attempts.push(attempt),
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.sheets).toHaveLength(2)
    expect(attempts.filter((item) => item.partId === 'second' && item.sheetIndex === 0))
      .toEqual([])
  })

  it('does not prune exact material capacity', () => {
    const req = request([
      rectPart('first', 0, 5, 10),
      rectPart('second', 1, 5, 10),
    ])

    resetCandidateCalls()
    const result = runBottomLeftNest(req)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements).toHaveLength(2)
    expect(result.sheets).toHaveLength(1)
    expect(sawCandidateBeside('second', 5)).toBe(true)
  })

  it('keeps maximum validator-accepted area metadata drift eligible', () => {
    const area = 50 + 0.999 * 1e-6 * 50
    const req = request([
      rectPart('first', 0, 5, 10, area),
      rectPart('second', 1, 5, 10, area),
    ])

    expect(() => validateNestingRequest(req)).not.toThrow()
    const result = runBottomLeftNest(req)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements).toHaveLength(2)
    expect(result.sheets).toHaveLength(1)
  })

  it('converts geometry epsilon into a conservative material allowance', () => {
    configureGeometryTolerance({ epsilonMm: 1e-5 })
    try {
      resetCandidateCalls()
      runBottomLeftNest(request([
        rectPart('host', 0, 6, 10),
        rectPart('inside', 1, 4.001, 10),
      ]))
      expect(sawCandidateBeside('inside', 6)).toBe(true)

      resetCandidateCalls()
      runBottomLeftNest(request([
        rectPart('host', 0, 6, 10),
        rectPart('outside', 1, 4.002, 10),
      ]))
      expect(sawCandidateBeside('outside', 6)).toBe(false)
    } finally {
      configureGeometryTolerance({ epsilonMm: 1e-7 })
    }
  })

  it('keeps a containment-tolerated part-in-hole fit eligible', () => {
    configureGeometryTolerance({ epsilonMm: 1e-3 })
    try {
      const host = polygonPart(
        'host',
        0,
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        [[
          { x: 3, y: 1 },
          { x: 3, y: 9 },
          { x: 7, y: 9 },
          { x: 7, y: 1 },
        ]],
      )
      const result = runBottomLeftNest(
        request(
          [host, rectPart('guest', 1, 4.0005, 8)],
          { widthMm: 10, heightMm: 10, marginMm: 0, quantity: 1 },
          { allowPartInPart: true },
        ),
      )

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') return
      expect(result.placements).toHaveLength(2)
    } finally {
      configureGeometryTolerance({ epsilonMm: 1e-7 })
    }
  })

  it('shares the guard with suffix simulations', () => {
    const parts = [
      rectPart('first', 0, 8, 8),
      rectPart('current', 1, 2, 8),
      rectPart('future', 2, 8, 8),
      rectPart('blocked', 3, 11, 11),
    ]

    resetCandidateCalls()
    const result = placeWithOrder(request(parts), parts.map((part) => part.id))

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(sawCandidateBeside('future', 2)).toBe(true)
    expect(sawCandidateBeside('future', 8)).toBe(false)
    expect(result.placements.map((item) => item.partId)).toEqual([
      'first',
      'current',
      'future',
    ])
    expect(result.unplacedPartIds).toEqual(['blocked'])
  })
})
