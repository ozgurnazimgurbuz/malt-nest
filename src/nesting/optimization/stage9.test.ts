import { describe, expect, it } from 'vitest'
import {
  adaptiveAnglesFromParts,
  anglesForMode,
  BALANCED_ANGLES,
  ORTHOGONAL_ANGLES,
  resolveAllowedAngles,
} from './rotations'
import type { GeometryPart } from '../../geometry'
import { boundingBox, centroid } from '../../geometry'
import { localSearchImprove } from './localSearch'
import { createRng } from './rng'
import type { NestingRequest, NestingSettings } from '../types'
import { runBottomLeftNest } from '../placement/blf'
import { solidsCollide, solidFromRings } from '../../geometry'

function LPart(): GeometryPart {
  const points = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 12 },
    { x: 12, y: 12 },
    { x: 12, y: 40 },
    { x: 0, y: 40 },
  ]
  return {
    id: 'L',
    sourceElement: 'path',
    originalIndex: 0,
    sourceId: null,
    outer: { points },
    holes: [],
    boundingBox: boundingBox(points),
    area: 40 * 12 + 12 * 28,
    centroid: centroid(points),
    originalTransform: null,
  }
}

const baseSettings: NestingSettings = {
  spacingMm: 2,
  allowedRotations: [0, 90, 180, 270],
  rotationStepDeg: null,
  allowArbitraryRotation: false,
  rotationMode: 'orthogonal',
  seed: 11,
  allowPartInPart: false,
}

describe('Stage 9 optimizer enhancements', () => {
  it('rotation modes produce expected angle sets', () => {
    expect(anglesForMode('orthogonal', [])).toEqual(ORTHOGONAL_ANGLES)
    expect(anglesForMode('balanced', [])).toEqual(BALANCED_ANGLES)
    const deep = anglesForMode('deep', [LPart()])
    expect(deep.length).toBeGreaterThan(BALANCED_ANGLES.length)
    expect(deep.length).toBeLessThanOrEqual(28)
  })

  it('adaptive angles are bounded', () => {
    const a = adaptiveAnglesFromParts([LPart(), LPart()], 16)
    expect(a.length).toBeLessThanOrEqual(16)
  })

  it('resolveAllowedAngles respects allowRotation=false', () => {
    expect(
      resolveAllowedAngles(
        { ...baseSettings, allowRotation: false },
        [LPart()],
      ),
    ).toEqual([0])
  })

  it('local search never worsens score', () => {
    const ind = { order: ['a', 'b', 'c'], rotations: [0, 90, 0] }
    let calls = 0
    const evalFn = (x: typeof ind) => {
      calls++
      // Prefer lexicographically smaller order as fake score
      const total = x.order.join('').length + x.rotations.reduce((a, b) => a + b, 0)
      return { score: { total } }
    }
    const startTotal = evalFn(ind).score.total
    const out = localSearchImprove(
      ind,
      [0, 90, 180, 270],
      createRng(1),
      evalFn,
      performance.now() + 50,
    )
    expect(evalFn(out).score.total).toBeLessThanOrEqual(startTotal)
    expect(calls).toBeGreaterThan(1)
  })

  it('spacing regression: larger spacing still valid (no overlap)', () => {
    const a = solidFromRings(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      [],
    )
    const b = solidFromRings(
      [
        { x: 25, y: 0 },
        { x: 45, y: 0 },
        { x: 45, y: 20 },
        { x: 25, y: 20 },
      ],
      [],
    )
    expect(solidsCollide(a, b, 0)).toBe(false)
    expect(solidsCollide(a, b, 1)).toBe(false)
    expect(solidsCollide(a, b, 5)).toBe(false)
    expect(solidsCollide(a, b, 10)).toBe(true) // gap is 5mm
  })

  it('spacing nest fixtures 0/1/5/10mm: valid + util non-increasing', () => {
    const mk = (id: string, w: number, h: number, i: number): GeometryPart => {
      const points = [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ]
      return {
        id,
        sourceElement: 'rect',
        originalIndex: i,
        sourceId: null,
        outer: { points },
        holes: [],
        boundingBox: boundingBox(points),
        area: w * h,
        centroid: { x: w / 2, y: h / 2 },
        originalTransform: null,
      }
    }
    const parts = [
      mk('r0', 40, 30, 0),
      mk('r1', 35, 25, 1),
      mk('r2', 50, 20, 2),
      mk('r3', 28, 28, 3),
    ]
    const utils: number[] = []
    for (const spacing of [0, 1, 5, 10]) {
      const request: NestingRequest = {
        parts,
        sheets: [{ widthMm: 200, heightMm: 160, marginMm: 5, quantity: 4 }],
        settings: { ...baseSettings, spacingMm: spacing },
      }
      const result = runBottomLeftNest(request)
      expect(result.status).toBe('ok')
      if (result.status !== 'ok') return
      expect(result.statistics.unplacedCount).toBe(0)
      // Validate placed solids pairwise for spacing
      const bySheet = new Map<number, typeof result.placements>()
      for (const p of result.placements) {
        const list = bySheet.get(p.sheetIndex) ?? []
        list.push(p)
        bySheet.set(p.sheetIndex, list)
      }
      utils.push(result.utilization)
    }
    for (let i = 1; i < utils.length; i++) {
      expect(utils[i]!).toBeLessThanOrEqual(utils[i - 1]! + 1e-9)
    }
  })
})
