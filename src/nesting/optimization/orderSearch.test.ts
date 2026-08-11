import { describe, expect, it } from 'vitest'
import { prepareParts, type PreparedPart } from '../core/prepare'
import type { GeometryPart } from '../../geometry'
import { boundingBox } from '../../geometry'
import { buildOrderCandidates } from './orderSearch'
import { createRng } from './rng'
import type { NestingSettings } from '../types'

function rect(id: string, w: number, h: number, index: number): GeometryPart {
  const points = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
  return {
    id,
    sourceElement: 'rect',
    originalIndex: index,
    sourceId: id,
    outer: { points },
    holes: [],
    boundingBox: boundingBox(points),
    area: w * h,
    centroid: { x: w / 2, y: h / 2 },
    originalTransform: null,
  }
}

const settings: NestingSettings = {
  spacingMm: 2,
  allowedRotations: [0, 90],
  rotationStepDeg: null,
  allowArbitraryRotation: false,
  rotationMode: 'orthogonal',
  allowRotation: true,
  optimizationLevel: 'fast',
  timeLimitMs: 500,
}

describe('buildOrderCandidates', () => {
  it('returns 8–16 distinct named orders', () => {
    const parts = prepareParts(
      [
        rect('a', 40, 10, 0),
        rect('b', 20, 20, 1),
        rect('c', 10, 30, 2),
        rect('d', 15, 15, 3),
      ],
      settings,
      { sortByArea: false },
    )
    const cands = buildOrderCandidates(parts, createRng(7), 14)
    expect(cands.length).toBeGreaterThanOrEqual(8)
    expect(cands.length).toBeLessThanOrEqual(14)
    const keys = new Set(cands.map((c) => c.order.join(',')))
    expect(keys.size).toBe(cands.length)
    expect(cands.some((c) => c.name === 'area_desc')).toBe(true)
    expect(cands.some((c) => c.name.startsWith('shuffle_'))).toBe(true)
  })

  it('keeps every generated seeded order when no diagnostic limit is requested', () => {
    const metrics = [
      ['a', 83, 65, 2766.85, 464.47, false],
      ['b', 42, 53, 1837.83, 374.41, true],
      ['c', 82, 63, 1895.62, 384.85, true],
      ['d', 47, 9, 204.78, 134.34, false],
      ['e', 23, 70, 892.57, 297.2, false],
      ['f', 40, 6, 163.74, 163.07, false],
      ['g', 52, 14, 633.42, 187.45, false],
      ['h', 16, 52, 329.82, 168.9, true],
      ['i', 32, 12, 311.15, 164.14, false],
      ['j', 14, 17, 91.78, 112.45, false],
      ['k', 77, 72, 2283.14, 415.01, false],
      ['l', 63, 32, 1307.27, 338.28, true],
    ] as const
    const parts: PreparedPart[] = metrics.map(
      ([partId, width, height, area, perimeter, hasHoles], sourceIndex) => ({
        partId,
        sourceIndex,
        area,
        hasHoles,
        sourceOuter: [],
        sourceHoles: [],
        rotations: [0],
        maxWidth: width,
        maxHeight: height,
        perimeter,
        widestRotation: 0,
        tallestRotation: 0,
        variants: [{
          partId,
          sourceIndex,
          rotation: 0,
          solid: null as never,
          area,
          rankSize: Math.max(width, height),
          width,
          height,
          perimeter,
        }],
      }),
    )

    const names = buildOrderCandidates(parts, createRng(7)).map(
      (candidate) => candidate.name,
    )
    expect(names).toEqual(expect.arrayContaining([
      'shuffle_0',
      'shuffle_1',
      'shuffle_2',
      'shuffle_3',
      'shuffle_4',
    ]))
  })
})
