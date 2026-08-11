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

/**
 * Hard regression: orthogonal policy must match ETAP 4 golden behavior.
 */
describe('ETAP 4 orthogonal regression', () => {
  it('2 rectangles BLF positions unchanged', () => {
    const sheet = createSheet(30, 20, 0)
    const r = nest([rect('a', 10, 10), rect('b', 8, 8)], sheet, {
      gap: 0,
      rotation: { kind: 'orthogonal' },
      ordering: 'area_desc',
    })
    expect(r.metrics.sheetCount).toBe(1)
    expect(r.placements.length).toBe(2)
    const first = r.placements.find((p) => p.shapeId === 'a')!
    expect(first.position.x).toBeCloseTo(5, 4)
    expect(first.position.y).toBeCloseTo(5, 4)
    expect([0, 90, 180, 270]).toContain(first.rotationDeg)
  })

  it('mixed orthogonal still places all', () => {
    const sheet = createSheet(50, 40, 1)
    const r = nest(
      [rect('a', 8, 6), rect('b', 5, 5), L('L')],
      sheet,
      { gap: 2, rotation: { kind: 'orthogonal' }, ordering: 'area_desc' },
    )
    expect(r.placements.length).toBe(3)
    expect(r.unplaced.length).toBe(0)
  })

  it('none policy still forces 0°', () => {
    const sheet = createSheet(20, 20, 0)
    const r = nest([rect('a', 4, 2)], sheet, {
      gap: 0,
      rotation: { kind: 'none' },
    })
    expect(r.placements[0]!.rotationDeg).toBe(0)
  })
})
