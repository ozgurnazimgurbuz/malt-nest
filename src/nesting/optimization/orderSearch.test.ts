import { describe, expect, it } from 'vitest'
import { prepareParts } from '../core/prepare'
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
})
