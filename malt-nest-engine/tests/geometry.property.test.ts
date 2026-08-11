import { describe, expect, it } from 'vitest'
import {
  makeShape,
  normalizeShape,
  rotateShape,
  scaleShape,
  shapeArea,
  shapesNearlyEqual,
  translateShape,
} from '../src/geometry'

const L = normalizeShape(
  makeShape('L', [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 3 },
    { x: 0, y: 3 },
  ]),
)

describe('property / invariants', () => {
  it('rotate(a) then rotate(b) ≈ rotate(a+b)', () => {
    const a = 17.3
    const b = 41.2
    const sequential = rotateShape(rotateShape(L, a), b)
    const combined = rotateShape(L, a + b)
    expect(shapesNearlyEqual(sequential, combined)).toBe(true)
  })

  it('rotate 360° ≈ original', () => {
    expect(shapesNearlyEqual(rotateShape(L, 360), L)).toBe(true)
  })

  it('scale 1 ≈ original', () => {
    expect(shapesNearlyEqual(scaleShape(L, 1), L)).toBe(true)
  })

  it('translation inverse', () => {
    const t = translateShape(L, 12.5, -7)
    const back = translateShape(t, -12.5, 7)
    expect(shapesNearlyEqual(back, L)).toBe(true)
  })

  it('rotation inverse', () => {
    const ang = 53.7
    const back = rotateShape(rotateShape(L, ang), -ang)
    expect(shapesNearlyEqual(back, L)).toBe(true)
  })

  it('area invariant under rotation', () => {
    for (const ang of [0, 15, 37.25, 90, 180, 271.1]) {
      expect(shapeArea(rotateShape(L, ang))).toBeCloseTo(shapeArea(L), 9)
    }
  })

  it('random seed rotations compose', () => {
    let s = L
    let total = 0
    for (let i = 0; i < 20; i++) {
      const d = ((i * 37) % 50) - 25 + i * 0.17
      s = rotateShape(s, d)
      total += d
    }
    expect(shapesNearlyEqual(s, rotateShape(L, total))).toBe(true)
    expect(shapeArea(s)).toBeCloseTo(shapeArea(L), 9)
  })
})
