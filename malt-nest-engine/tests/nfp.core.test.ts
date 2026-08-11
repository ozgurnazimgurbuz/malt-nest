import { describe, expect, it } from 'vitest'
import { absoluteArea, reverseRing, makeShape } from '../src/geometry'
import {
  computeInnerNfp,
  computeOuterNfp,
  nfpContainsPoint,
} from '../src/nfp'
import {
  LShape,
  crossCheckOuterNfp,
  frameShape,
  oracleCollides,
  rectShape,
  triangleShape,
} from '../src/nfp/oracle'

/** Golden: rect 10×10 vs rect 4×4 → forbidden AABB [-2,12]² area 196 */
const GOLDEN_RECT_RECT = {
  minX: -2,
  minY: -2,
  maxX: 12,
  maxY: 12,
  area: 196,
} as const

describe('NFP outer — golden & cases', () => {
  it('1. rectangle × rectangle golden', () => {
    const nfp = computeOuterNfp(rectShape('A', 10, 10), rectShape('B', 4, 4), {
      gap: 0,
    })
    expect(nfp.regions.length).toBe(1)
    const b = nfp.bounds!
    expect(b.minX).toBeCloseTo(GOLDEN_RECT_RECT.minX, 6)
    expect(b.minY).toBeCloseTo(GOLDEN_RECT_RECT.minY, 6)
    expect(b.maxX).toBeCloseTo(GOLDEN_RECT_RECT.maxX, 6)
    expect(b.maxY).toBeCloseTo(GOLDEN_RECT_RECT.maxY, 6)
    expect(absoluteArea(nfp.regions[0]!.outer)).toBeCloseTo(
      GOLDEN_RECT_RECT.area,
      4,
    )
    // center collides
    expect(nfpContainsPoint({ x: 5, y: 5 }, nfp)).toBe(true)
    expect(oracleCollides(rectShape('A', 10, 10), rectShape('B', 4, 4), { x: 5, y: 5 }, 0)).toBe(true)
    // far away
    expect(nfpContainsPoint({ x: -5, y: 5 }, nfp)).toBe(false)
  })

  it('2. rectangle × triangle', () => {
    const A = rectShape('A', 10, 10)
    const B = triangleShape('B')
    const nfp = computeOuterNfp(A, B, { gap: 0 })
    expect(nfp.regions.length).toBeGreaterThanOrEqual(1)
    expect(nfp.bounds).toBeTruthy()
    const chk = crossCheckOuterNfp(A, B, 0, 1.0)
    expect(chk.checked).toBeGreaterThan(50)
    expect(chk.disagreements).toBe(0)
  })

  it('3. convex × convex (hex-ish)', () => {
    const hex = makeShape('H', [
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 1.5 },
      { x: 4, y: 3 },
      { x: 2, y: 3 },
      { x: 1, y: 1.5 },
    ])
    const A = rectShape('A', 8, 8)
    const nfp = computeOuterNfp(A, hex, { gap: 0 })
    expect(nfp.regions[0]!.outer.length).toBeGreaterThanOrEqual(3)
    expect(crossCheckOuterNfp(A, hex, 0, 1).disagreements).toBe(0)
  })

  it('4. L × rectangle', () => {
    const A = LShape('L')
    const B = rectShape('R', 1.2, 1.2)
    expect(crossCheckOuterNfp(A, B, 0, 0.5).disagreements).toBe(0)
  })

  it('5. L × L', () => {
    const A = LShape('L1')
    const B = LShape('L2')
    const nfp = computeOuterNfp(A, B, { gap: 0 })
    expect(nfp.regions.length).toBeGreaterThanOrEqual(1)
    expect(crossCheckOuterNfp(A, B, 0, 0.6).disagreements).toBe(0)
  })

  it('6. polygon with hole (frame × small rect)', () => {
    const A = frameShape('F')
    const B = rectShape('b', 2, 2)
    const nfp = computeOuterNfp(A, B, { gap: 0 })
    // Center of frame hole should NOT be in outer NFP (no material collision)
    expect(nfpContainsPoint({ x: 10, y: 10 }, nfp)).toBe(false)
    expect(oracleCollides(A, B, { x: 10, y: 10 }, 0)).toBe(false)
    // On the rim — should collide
    expect(oracleCollides(A, B, { x: 2, y: 10 }, 0)).toBe(true)
    expect(nfpContainsPoint({ x: 2, y: 10 }, nfp)).toBe(true)
    expect(crossCheckOuterNfp(A, B, 0, 1).disagreements).toBe(0)
  })
})

describe('NFP inner', () => {
  it('7. inner NFP rect container', () => {
    const container = rectShape('C', 20, 20)
    const part = rectShape('P', 4, 4)
    const ifp = computeInnerNfp(container, part, { gap: 0 })
    expect(ifp.kind).toBe('inner')
    expect(ifp.regions.length).toBeGreaterThanOrEqual(1)
    // Centroid must stay in [2,18]^2
    expect(nfpContainsPoint({ x: 10, y: 10 }, ifp)).toBe(true)
    expect(nfpContainsPoint({ x: 1, y: 10 }, ifp)).toBe(false)
    expect(nfpContainsPoint({ x: 2, y: 2 }, ifp)).toBe(true)
  })
})

describe('NFP gap', () => {
  it('8. gap = 0', () => {
    const A = rectShape('A', 10, 10)
    const B = rectShape('B', 4, 4)
    const nfp = computeOuterNfp(A, B, { gap: 0 })
    expect(absoluteArea(nfp.regions[0]!.outer)).toBeCloseTo(196, 3)
  })

  it('9. gap = 5 expands forbidden region', () => {
    const A = rectShape('A', 10, 10)
    const B = rectShape('B', 4, 4)
    const g0 = computeOuterNfp(A, B, { gap: 0 })
    const g5 = computeOuterNfp(A, B, { gap: 5 })
    expect(absoluteArea(g5.regions[0]!.outer)).toBeGreaterThan(
      absoluteArea(g0.regions[0]!.outer),
    )
    // Point that was just outside at gap0 may be inside at gap5
    // At gap0, x=-2 is boundary; x=-3 outside. At gap5 forbidden grows by 5 → x=-7..17
    expect(nfpContainsPoint({ x: -5, y: 5 }, g5)).toBe(true)
    expect(nfpContainsPoint({ x: -5, y: 5 }, g0)).toBe(false)
    expect(crossCheckOuterNfp(A, B, 5, 1).disagreements).toBe(0)
  })
})

describe('NFP robustness', () => {
  it('10. touching / coincident edges (gap=0)', () => {
    const A = rectShape('A', 10, 10)
    const B = rectShape('B', 4, 4)
    // Centroid at (-2, 5): B touches left edge of A
    const p = { x: -2, y: 5 }
    expect(oracleCollides(A, B, p, 0)).toBe(false)
    // On NFP boundary
    expect(nfpContainsPoint(p, computeOuterNfp(A, B))).toBe(true)
  })

  it('11. reversed winding input', () => {
    const cw = makeShape('cw', reverseRing([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]))
    const B = rectShape('B', 2, 2)
    const nfp = computeOuterNfp(cw, B, { gap: 0 })
    expect(nfp.regions.length).toBe(1)
    expect(crossCheckOuterNfp(cw, B, 0, 1).disagreements).toBe(0)
  })

  it('12. duplicate vertices cleaned', () => {
    const dirty = makeShape('d', [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
      { x: 8, y: 8 },
      { x: 0, y: 8 },
    ])
    const B = rectShape('B', 2, 2)
    expect(computeOuterNfp(dirty, B).regions[0]!.outer.length).toBeGreaterThanOrEqual(3)
    expect(crossCheckOuterNfp(dirty, B, 0, 1).disagreements).toBe(0)
  })

  it('13. brute-force collision cross-check suite', () => {
    const pairs: Array<[ReturnType<typeof rectShape>, ReturnType<typeof rectShape> | ReturnType<typeof LShape>, number]> = [
      [rectShape('A', 10, 10), rectShape('B', 4, 4), 0],
      [rectShape('A', 10, 10), rectShape('B', 4, 4), 5],
      [rectShape('A', 10, 10), triangleShape('T'), 0],
      [LShape('L'), rectShape('R', 1.5, 1.5), 0],
      [LShape('L1'), LShape('L2'), 0],
      [frameShape('F'), rectShape('b', 2, 2), 0],
    ]
    for (const [A, B, gap] of pairs) {
      const r = crossCheckOuterNfp(A, B, gap, gap > 0 ? 1.25 : 0.75)
      expect(r.disagreements, `${A.id}×${B.id} gap=${gap}`).toBe(0)
      expect(r.checked).toBeGreaterThan(20)
    }
  })
})
