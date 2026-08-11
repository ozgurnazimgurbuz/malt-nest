import { describe, expect, it } from 'vitest'
import { makeShape } from '../src/geometry'
import { createSheet, validatePlacement } from '../src/placement'
import { nest } from '../src/nest'
import { searchFreeAngle, canonicalizeAngle, type AngleEval } from '../src/rotation'

function rect(id: string, w: number, h: number) {
  return makeShape(id, [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ])
}

function L(id: string) {
  return makeShape(id, [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 6 },
    { x: 0, y: 6 },
  ])
}

const freeNoFloor = {
  kind: 'free' as const,
  free: { baselineFloor: false as const },
}

describe('free-angle fixtures', () => {
  it('1. rectangle where 45° can help packing two parts', () => {
    const sheet = createSheet(30, 20, 0)
    const parts = [rect('a', 12, 8), rect('b', 12, 8)]
    const ortho = nest(parts, sheet, { gap: 0, rotation: { kind: 'orthogonal' } })
    const free = nest(parts, sheet, { gap: 0, rotation: freeNoFloor })
    expect(free.placements.length).toBeGreaterThanOrEqual(ortho.placements.length)
    expect(free.placements.length).toBeGreaterThan(0)
  })

  it('2. long rectangle — free places when orthogonal cannot', () => {
    // 21×2 on 20×20: orthogonal AABB fails; ~25°+ fits
    const sheet = createSheet(20, 20, 0)
    const parts = [rect('bar', 21, 2)]
    const ortho = nest(parts, sheet, { gap: 0, rotation: { kind: 'orthogonal' } })
    const free = nest(parts, sheet, { gap: 0, rotation: freeNoFloor })
    expect(ortho.placements.length).toBe(0)
    expect(free.placements.length).toBe(1)
    expect(free.placements[0]!.rotationDeg % 90).not.toBe(0)
  })

  it('3. L shape free-angle', () => {
    const sheet = createSheet(40, 40, 0)
    const r = nest([L('L'), rect('r', 3, 3)], sheet, {
      gap: 0,
      rotation: freeNoFloor,
    })
    expect(r.placements.length).toBe(2)
  })

  it('4. irregular concave', () => {
    const sheet = createSheet(50, 50, 0)
    const r = nest([L('L1'), L('L2')], sheet, { gap: 1, rotation: freeNoFloor })
    expect(r.placements.length).toBe(2)
  })

  it('5. mixed shapes', () => {
    const sheet = createSheet(60, 50, 1)
    const r = nest(
      [rect('a', 10, 6), L('L'), rect('b', 4, 8)],
      sheet,
      { gap: 1, rotation: freeNoFloor },
    )
    expect(r.placements.length).toBe(3)
  })

  it('6. non-orthogonal orientation required', () => {
    const sheet = createSheet(20, 20, 0)
    const r = nest([rect('bar', 21, 2)], sheet, { gap: 0, rotation: freeNoFloor })
    expect(r.placements.length).toBe(1)
    const ang = r.placements[0]!.rotationDeg
    expect([0, 90, 180, 270].includes(ang)).toBe(false)
  })

  it('7. coarse misleading — only ~7° valid; cascade finds it via baseline', () => {
    const evaluate = (angleDeg: number): AngleEval => {
      const a = canonicalizeAngle(angleDeg)
      if (Math.abs(a - 7) <= 0.5) {
        return {
          angleDeg: a,
          ok: true,
          position: { x: 2, y: 2 },
          bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
          packedBoundsMm2: 16,
        }
      }
      // Coarse 45° looks "ok" but worse Y — if we trusted coarse-only we'd pick 45
      if (a === 45) {
        return {
          angleDeg: a,
          ok: true,
          position: { x: 2, y: 50 },
          bounds: { minX: 0, minY: 48, maxX: 4, maxY: 52 },
          packedBoundsMm2: 200,
        }
      }
      return { angleDeg: a, ok: false }
    }
    const found = searchFreeAngle(evaluate, {
      coarseStepDeg: 15,
      refineStepDeg: 5,
      finalStepDeg: 1,
      coarseTopK: 1, // would keep only 45 without baseline/diversity rescue
      baselineAnglesDeg: [0],
      diversityCount: 0,
      baselineFloor: false,
    })
    expect(found.best?.ok).toBe(true)
    expect(found.best!.angleDeg).toBeCloseTo(7, 0)
    expect(found.best!.position!.y).toBeLessThan(45)
  })

  it('8. 1° refinement improves over coarse-only winner', () => {
    const evaluate = (angleDeg: number): AngleEval => {
      const a = canonicalizeAngle(angleDeg)
      // Landscape: 15° ok (y=10), 14° better (y=3), 0° fail
      if (Math.abs(a - 14) < 0.01) {
        return {
          angleDeg: a,
          ok: true,
          position: { x: 1, y: 3 },
          bounds: { minX: 0, minY: 0, maxX: 2, maxY: 6 },
          packedBoundsMm2: 12,
        }
      }
      if (a === 15) {
        return {
          angleDeg: a,
          ok: true,
          position: { x: 1, y: 10 },
          bounds: { minX: 0, minY: 0, maxX: 2, maxY: 20 },
          packedBoundsMm2: 40,
        }
      }
      return { angleDeg: a, ok: false }
    }
    const full = searchFreeAngle(evaluate, {
      coarseStepDeg: 15,
      refineStepDeg: 5,
      finalStepDeg: 1,
      coarseTopK: 3,
      baselineAnglesDeg: [0],
      diversityCount: 0,
      baselineFloor: false,
    })
    expect(full.best?.angleDeg).toBe(14)
    expect(full.best!.position!.y).toBe(3)
  })

  it('streams a caller-requested 0.01° final grid within its resource bound', () => {
    const result = searchFreeAngle(
      (angleDeg) => ({
        angleDeg,
        ok: true,
        position: { x: angleDeg, y: 0 },
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      }),
      {
        coarseStepDeg: 90,
        refineStepDeg: 45,
        finalStepDeg: 0.01,
        coarseTopK: 1,
        baselineAnglesDeg: [0],
        diversityCount: 0,
        baselineFloor: false,
        precision: { decimals: 2 },
      },
    )

    expect(result.evalCount).toBe(36_000)
    expect(result.best?.angleDeg).toBe(0)
  })
})

describe('free-angle validity', () => {
  it('placements validate under gap', () => {
    const sheet = createSheet(40, 40, 0)
    const r = nest([rect('a', 6, 4), rect('b', 5, 5)], sheet, {
      gap: 2,
      rotation: freeNoFloor,
    })
    expect(r.placements.length).toBe(2)
    for (const p of r.placements) {
      const others = r.placements.filter((o) => o.shapeId !== p.shapeId)
      expect(validatePlacement(p, sheet, others, { gap: 2 }).valid).toBe(true)
    }
  })
})
