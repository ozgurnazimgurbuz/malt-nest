import { describe, expect, it } from 'vitest'
import {
  anglesEqual,
  canonicalizeAngle,
  expandAround,
  normalizeDeg,
  sampleCircle,
  searchFreeAngle,
  selectCoarseSeeds,
  resolveFreeConfig,
  type AngleEval,
} from '../src/rotation'
import { makeShape } from '../src/geometry'
import { createSheet, createPlacement } from '../src/placement'
import { nest } from '../src/nest'

describe('angle normalization', () => {
  it('maps negatives and wraps to [0,360)', () => {
    expect(normalizeDeg(-15)).toBeCloseTo(345, 10)
    expect(normalizeDeg(360)).toBe(0)
    expect(normalizeDeg(720)).toBe(0)
    expect(normalizeDeg(405)).toBe(45)
  })

  it('0° ≈ 360° under canonicalize', () => {
    expect(canonicalizeAngle(0)).toBe(0)
    expect(canonicalizeAngle(360)).toBe(0)
    expect(anglesEqual(0, 360)).toBe(true)
  })

  it('canonical precision snaps', () => {
    expect(canonicalizeAngle(37.25001, { decimals: 2 })).toBe(37.25)
  })
})

describe('rotation 360° ≈ original geometry', () => {
  it('bounds match', () => {
    const s = makeShape('r', [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ])
    const a = createPlacement(s, { x: 10, y: 10 }, 0)
    const b = createPlacement(s, { x: 10, y: 10 }, 360)
    expect(a.bounds.minX).toBeCloseTo(b.bounds.minX, 6)
    expect(a.bounds.maxY).toBeCloseTo(b.bounds.maxY, 6)
  })
})

describe('free-angle search properties', () => {
  it('deterministic + baseline refine finds 7° when coarse grid fails', () => {
    const evaluate = (angleDeg: number): AngleEval => {
      const a = canonicalizeAngle(angleDeg)
      if (Math.abs(a - 7) <= 0.5) {
        return {
          angleDeg: a,
          ok: true,
          position: { x: 1, y: 1 },
          bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
          packedBoundsMm2: 4,
        }
      }
      return { angleDeg: a, ok: false }
    }
    const cfg = {
      coarseStepDeg: 15,
      refineStepDeg: 5,
      finalStepDeg: 1,
      coarseTopK: 3,
      baselineAnglesDeg: [0] as const,
      diversityCount: 0,
      baselineFloor: false,
    }
    const a = searchFreeAngle(evaluate, cfg)
    const b = searchFreeAngle(evaluate, cfg)
    expect(a.best?.ok).toBe(true)
    expect(a.best!.angleDeg).toBeCloseTo(7, 0)
    expect(a.anglesEvaluated).toEqual(b.anglesEvaluated)
    expect(a.best!.angleDeg).toBe(b.best!.angleDeg)
    expect(sampleCircle(15).includes(7)).toBe(false)
  })

  it('selectCoarseSeeds always keeps baseline 0', () => {
    const cfg = resolveFreeConfig({
      coarseTopK: 1,
      baselineAnglesDeg: [0],
      diversityCount: 0,
    })
    const evals: AngleEval[] = [
      {
        angleDeg: 45,
        ok: true,
        position: { x: 0, y: 5 },
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        packedBoundsMm2: 1,
      },
    ]
    const seeds = selectCoarseSeeds(evals, cfg)
    expect(seeds).toContain(0)
    expect(seeds).toContain(45)
  })

  it('expandAround covers refine neighborhood', () => {
    const xs = expandAround([0], 15, 5)
    expect(xs).toContain(0)
    expect(xs).toContain(5)
    expect(xs).toContain(15)
    expect(xs).toContain(canonicalizeAngle(-5))
  })
})

describe('nest free-angle properties', () => {
  it('same config → same result', () => {
    const parts = [
      makeShape('a', [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 3 },
        { x: 0, y: 3 },
      ]),
      makeShape('b', [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ]),
    ]
    const sheet = createSheet(40, 30, 0)
    const cfg = {
      gap: 1,
      rotation: {
        kind: 'free' as const,
        free: { baselineFloor: false, coarseTopK: 2 },
      },
    }
    const r1 = nest(parts, sheet, cfg)
    const r2 = nest(parts, sheet, cfg)
    expect(
      r1.placements.map((p) => [p.shapeId, p.rotationDeg, p.position.x, p.position.y]),
    ).toEqual(
      r2.placements.map((p) => [p.shapeId, p.rotationDeg, p.position.x, p.position.y]),
    )
  })

  it('baseline floor reports and places', () => {
    const parts = [
      makeShape('a', [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 8 },
        { x: 0, y: 8 },
      ]),
    ]
    const sheet = createSheet(30, 30, 0)
    const r = nest(parts, sheet, {
      gap: 0,
      rotation: { kind: 'free', free: { baselineFloor: true } },
    })
    expect(r.diagnostics.baselineFloorApplied).toBe(true)
    expect(r.placements.length).toBe(1)
  })
})
