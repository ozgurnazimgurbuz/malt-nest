import { describe, expect, it } from 'vitest'
import { makeShape } from '../src/geometry'
import { createSheet } from '../src/placement'
import { nest } from '../src/nest'

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
    { x: 4, y: 0 },
    { x: 4, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 4 },
    { x: 0, y: 4 },
  ])
}

describe('nest golden fixtures', () => {
  it('2 rectangles — 1 sheet, 2 placed', () => {
    const sheet = createSheet(30, 20, 0)
    const r = nest([rect('a', 10, 10), rect('b', 8, 8)], sheet, {
      gap: 0,
      rotation: { kind: 'none' },
      ordering: 'area_desc',
    })
    expect(r.metrics.sheetCount).toBe(1)
    expect(r.placements.length).toBe(2)
    expect(r.unplaced.length).toBe(0)
    // First (larger) sits bottom-left: centroid at (5,5)
    const first = r.placements.find((p) => p.shapeId === 'a')!
    expect(first.position.x).toBeCloseTo(5, 4)
    expect(first.position.y).toBeCloseTo(5, 4)
  })

  it('3 rectangles — all placed valid', () => {
    const sheet = createSheet(40, 30, 0)
    const r = nest(
      [rect('a', 10, 10), rect('b', 10, 10), rect('c', 10, 10)],
      sheet,
      { gap: 0, rotation: { kind: 'none' } },
    )
    expect(r.placements.length).toBe(3)
    expect(r.metrics.sheetCount).toBe(1)
  })

  it('L + rectangle', () => {
    const sheet = createSheet(30, 30, 0)
    const r = nest([L('L'), rect('r', 3, 3)], sheet, {
      gap: 0,
      rotation: { kind: 'none' },
    })
    expect(r.placements.length).toBe(2)
    expect(r.unplaced.length).toBe(0)
  })

  it('mixed shapes golden validity', () => {
    const sheet = createSheet(50, 40, 1)
    const r = nest(
      [rect('a', 8, 6), rect('b', 5, 5), L('L')],
      sheet,
      { gap: 2, rotation: { kind: 'orthogonal' }, ordering: 'area_desc' },
    )
    expect(r.placements.length).toBe(3)
    expect(r.metrics.utilization).toBeGreaterThan(0)
    expect(r.metrics.packedBoundsMm2).toBeGreaterThan(0)
  })
})
