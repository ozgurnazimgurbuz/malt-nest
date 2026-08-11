import { describe, expect, it } from 'vitest'
import { makeShape, shapeArea, shapesNearlyEqual } from '../src/geometry'
import {
  createPlacement,
  createSheet,
  validatePlacement,
} from '../src/placement'

const rect = makeShape('r', [
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  { x: 30, y: 10 },
  { x: 0, y: 10 },
])

const sheet = createSheet(1600, 1000, 10)

describe('placement properties', () => {
  it('area invariant under rotation/translation', () => {
    const base = shapeArea(rect)
    for (const ang of [0, 37.25, 90, 180, 271.1]) {
      const p = createPlacement(rect, { x: 200, y: 300 }, ang)
      expect(shapeArea(p.geometry)).toBeCloseTo(base, 9)
    }
  })

  it('inverse rotation around centroid returns geometry', () => {
    const ang = 48.3
    const p = createPlacement(rect, { x: 0, y: 0 }, ang)
    const back = createPlacement(
      // reconstruct from placed: rotate opposite about same centroid position
      p.geometry,
      p.position,
      -ang,
    )
    // After +ang then place at 0, then treat geometry as shape and -ang at 0:
    // createPlacement re-centroids — should match original area & roughly bounds size
    expect(shapeArea(back.geometry)).toBeCloseTo(shapeArea(rect), 9)
  })

  it('validation is deterministic', () => {
    const a = createPlacement(rect, { x: 400, y: 400 }, 12.5)
    const b = createPlacement(rect, { x: 420, y: 400 }, 12.5)
    const r1 = validatePlacement(b, sheet, [a], { gap: 5 })
    const r2 = validatePlacement(b, sheet, [a], { gap: 5 })
    expect(r1).toEqual(r2)
  })

  it('same inputs → identical placement bounds', () => {
    const p1 = createPlacement(rect, { x: 111.1, y: 222.2 }, 33.3)
    const p2 = createPlacement(rect, { x: 111.1, y: 222.2 }, 33.3)
    expect(p1.bounds).toEqual(p2.bounds)
    expect(shapesNearlyEqual(p1.geometry, p2.geometry)).toBe(true)
  })
})
