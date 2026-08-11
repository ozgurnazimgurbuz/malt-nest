import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOLERANCE,
  createClipper2Backend,
  makeShape,
  normalizeShape,
  roundTripScaled,
  shapesIntersect,
} from '../src/geometry'

describe('clipper2 backend adapter', () => {
  it('detects overlapping rectangles', () => {
    const backend = createClipper2Backend()
    const a = normalizeShape(
      makeShape('a', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    )
    const b = normalizeShape(
      makeShape('b', [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 15, y: 15 },
        { x: 5, y: 15 },
      ]),
    )
    expect(
      backend.pathsIntersect(a.polygons[0]!.outer, b.polygons[0]!.outer),
    ).toBe(true)
    expect(shapesIntersect(a, b)).toBe(true)
    expect(backend.intersectionArea(a.polygons[0]!, b.polygons[0]!)).toBeCloseTo(
      25,
      5,
    )
  })

  it('integer scale round-trip within 1/scale', () => {
    const p = { x: 12.345678, y: -0.987654 }
    const q = roundTripScaled(p, DEFAULT_TOLERANCE.clipperScale)
    expect(Math.abs(p.x - q.x)).toBeLessThanOrEqual(1 / DEFAULT_TOLERANCE.clipperScale)
    expect(Math.abs(p.y - q.y)).toBeLessThanOrEqual(1 / DEFAULT_TOLERANCE.clipperScale)
  })
})
