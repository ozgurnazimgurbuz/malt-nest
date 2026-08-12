import { describe, expect, it } from 'vitest'
import {
  boundingBox,
  centroid,
  netArea,
  type GeometryPart,
  type Point,
} from '../../geometry'
import { runAutomaticNest } from '../optimization/automaticOptimizer'
import {
  placeWithOrder,
  placeWithPlan,
  runBottomLeftNest,
} from '../placement/blf'
import type { NestingRequest } from '../types'
import { validateNestingRequest } from './validate'

function part(id = 'a'): GeometryPart {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]
  return {
    id,
    sourceElement: 'rect',
    originalIndex: 0,
    sourceId: id,
    outer: { points },
    holes: [],
    boundingBox: boundingBox(points),
    area: 100,
    centroid: { x: 5, y: 5 },
    originalTransform: null,
  }
}

function polygonPart(id: string, outer: Point[], holes: Point[][] = []): GeometryPart {
  const holePolygons = holes.map((points) => ({ points }))
  return {
    id,
    sourceElement: 'path',
    originalIndex: 0,
    sourceId: id,
    outer: { points: outer },
    holes: holePolygons,
    boundingBox: boundingBox(outer),
    area: netArea({ points: outer }, holePolygons),
    centroid: centroid(outer),
    originalTransform: null,
  }
}

function request(): NestingRequest {
  return {
    parts: [part()],
    sheets: [{ widthMm: 100, heightMm: 100, marginMm: 0, quantity: 1 }],
    settings: {
      spacingMm: 0,
      allowedRotations: [0],
      allowArbitraryRotation: false,
      seed: 1,
    },
  }
}

describe('validateNestingRequest', () => {
  it.each([
    ['negative margin', (req: NestingRequest) => { req.sheets[0]!.marginMm = -1 }],
    ['non-finite width', (req: NestingRequest) => { req.sheets[0]!.widthMm = Infinity }],
    ['infeasible margin', (req: NestingRequest) => { req.sheets[0]!.marginMm = 50 }],
    ['negative spacing', (req: NestingRequest) => { req.settings.spacingMm = -1 }],
    ['non-finite seed', (req: NestingRequest) => { req.settings.seed = Infinity }],
    ['non-finite quantity', (req: NestingRequest) => { req.sheets[0]!.quantity = Infinity }],
    ['fractional quantity', (req: NestingRequest) => { req.sheets[0]!.quantity = 1.5 }],
    ['invalid rotation mode', (req: NestingRequest) => {
      req.settings.rotationMode = 'diagonal' as never
    }],
    ['explosive rotation step', (req: NestingRequest) => {
      req.settings.rotationStepDeg = 0.001
    }],
  ])('rejects %s', (_name, mutate) => {
    const req = request()
    mutate(req)
    expect(() => validateNestingRequest(req)).toThrow()
  })

  it('rejects duplicate IDs and malformed part geometry/metadata', () => {
    const duplicate = request()
    duplicate.parts.push({ ...part(), originalIndex: 1 })
    expect(() => validateNestingRequest(duplicate)).toThrow('unique')

    const malformed = request()
    malformed.parts[0] = {
      ...part(),
      outer: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      area: 0,
      centroid: { x: Number.NaN, y: 0 },
    }
    expect(() => validateNestingRequest(malformed)).toThrow('geometry')
  })

  it('rejects a self-intersecting outer ring', () => {
    const pentagram = [
      { x: 0, y: -10 },
      { x: 5.88, y: 8.09 },
      { x: -9.51, y: -3.09 },
      { x: 9.51, y: -3.09 },
      { x: -5.88, y: 8.09 },
    ]
    const req = request()
    req.parts = [polygonPart('star', pentagram)]

    expect(() => validateNestingRequest(req)).toThrow('self-intersect')
  })

  it.each([
    [
      'outside',
      [
        { x: 20, y: 20 },
        { x: 24, y: 20 },
        { x: 24, y: 24 },
        { x: 20, y: 24 },
      ],
    ],
    [
      'crossing',
      [
        { x: 8, y: 8 },
        { x: 12, y: 8 },
        { x: 12, y: 12 },
        { x: 8, y: 12 },
      ],
    ],
  ])('rejects a %s hole', (_name, hole) => {
    const outer = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const req = request()
    req.parts = [polygonPart('bad-hole', outer, [hole])]

    expect(() => validateNestingRequest(req)).toThrow('hole')
  })

  it('rejects overlapping holes', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ]
    const holes = [
      [
        { x: 2, y: 2 },
        { x: 10, y: 2 },
        { x: 10, y: 10 },
        { x: 2, y: 10 },
      ],
      [
        { x: 8, y: 8 },
        { x: 15, y: 8 },
        { x: 15, y: 15 },
        { x: 8, y: 15 },
      ],
    ]
    const req = request()
    req.parts = [polygonPart('overlap', outer, holes)]

    expect(() => validateNestingRequest(req)).toThrow('overlap')
  })

  it('enforces canonical outer and hole winding', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const clockwiseOuter = request()
    clockwiseOuter.parts = [polygonPart('cw', outer.slice().reverse())]
    expect(() => validateNestingRequest(clockwiseOuter)).toThrow(
      'counter-clockwise',
    )

    const counterClockwiseHole = request()
    counterClockwiseHole.parts = [
      polygonPart('bad-hole-winding', outer, [[
        { x: 2, y: 2 },
        { x: 8, y: 2 },
        { x: 8, y: 8 },
        { x: 2, y: 8 },
      ]]),
    ]
    expect(() => validateNestingRequest(counterClockwiseHole)).toThrow(
      'clockwise',
    )
  })

  it.each([
    ['area', (value: GeometryPart) => { value.area = 99 }],
    ['bounds', (value: GeometryPart) => { value.boundingBox.width = 999 }],
    ['centroid', (value: GeometryPart) => { value.centroid.x = 99 }],
  ])('rejects stale finite %s metadata', (_name, mutate) => {
    const req = request()
    mutate(req.parts[0]!)
    expect(() => validateNestingRequest(req)).toThrow('does not match')
  })

  it('is enforced by both public engine entry points', () => {
    const req = request()
    req.sheets[0]!.marginMm = -5

    expect(() => runBottomLeftNest(req)).toThrow('margin')
    expect(() => runAutomaticNest(req)).toThrow('margin')
    expect(() => placeWithOrder(req, ['a'])).toThrow('margin')
    expect(() =>
      placeWithPlan(req, { order: ['a'], rotations: [0] }),
    ).toThrow('margin')
  })

  it('handles huge safe sheet quantities without eager expansion', () => {
    const req = request()
    req.sheets[0]!.quantity = Number.MAX_SAFE_INTEGER

    expect(() => validateNestingRequest(req)).not.toThrow()
    const result = runBottomLeftNest(req)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements).toHaveLength(1)
    expect(
      result.statistics.placedCount + result.statistics.unplacedCount,
    ).toBe(result.statistics.partCount)
  })
})
