import { describe, expect, it } from 'vitest'
import { makeShape } from '../src/geometry'
import { createSheet, validatePlacement } from '../src/placement'
import { nest } from '../src/nest'

function rect(id: string, w: number, h: number) {
  return makeShape(id, [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ])
}

describe('nest invariants', () => {
  it('valid gap/margin, unique parts, placed+unplaced=input, deterministic', () => {
    const parts = [
      rect('a', 5, 5),
      rect('b', 4, 4),
      rect('c', 3, 6),
      rect('d', 2, 2),
    ]
    const sheet = createSheet(25, 20, 1)
    const cfg = {
      gap: 2,
      ordering: 'area_desc' as const,
      rotation: { kind: 'orthogonal' as const },
    }
    const r1 = nest(parts, sheet, cfg)
    const r2 = nest(parts, sheet, cfg)

    expect(r1.placements.length).toBe(r2.placements.length)
    expect(r1.unplaced.length).toBe(r2.unplaced.length)
    expect(r1.metrics.packedBoundsMm2).toBeCloseTo(r2.metrics.packedBoundsMm2, 6)

    for (let i = 0; i < r1.placements.length; i++) {
      const a = r1.placements[i]!
      const b = r2.placements[i]!
      expect(a.shapeId).toBe(b.shapeId)
      expect(a.rotationDeg).toBe(b.rotationDeg)
      expect(a.position.x).toBeCloseTo(b.position.x, 6)
      expect(a.position.y).toBeCloseTo(b.position.y, 6)
      expect(a.sheetIndex).toBe(b.sheetIndex)
    }

    for (const sh of r1.sheets) {
      for (const p of sh.placements) {
        const others = sh.placements.filter((o) => o.shapeId !== p.shapeId)
        const v = validatePlacement(p, sh.sheet, others, { gap: cfg.gap })
        expect(v.valid).toBe(true)
      }
    }

    const ids = new Set([
      ...r1.placements.map((p) => p.shapeId),
      ...r1.unplaced.map((u) => u.shapeId),
    ])
    expect(ids.size).toBe(parts.length)
    expect(new Set(r1.placements.map((p) => p.shapeId)).size).toBe(
      r1.placements.length,
    )
  })
})
