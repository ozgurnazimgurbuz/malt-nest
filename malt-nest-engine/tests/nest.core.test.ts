import { describe, expect, it } from 'vitest'
import { makeShape } from '../src/geometry'
import { createSheet, validatePlacement } from '../src/placement'
import { nest } from '../src/nest'
import { sortParts } from '../src/ordering'
import type { NestConfig } from '../src/nest'

function rect(id: string, w: number, h: number, ox = 0, oy = 0) {
  return makeShape(id, [
    { x: ox, y: oy },
    { x: ox + w, y: oy },
    { x: ox + w, y: oy + h },
    { x: ox, y: oy + h },
  ])
}

function L(id: string) {
  // 3×3 L: thickness 1
  return makeShape(id, [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 3 },
    { x: 0, y: 3 },
  ])
}

function U(id: string) {
  return makeShape(id, [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 3, y: 3 },
    { x: 3, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 3 },
    { x: 0, y: 3 },
  ])
}

function triangle(id: string) {
  return makeShape(id, [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 2, y: 3 },
  ])
}

function frame(id: string) {
  return makeShape(
    id,
    [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 6 },
      { x: 0, y: 6 },
    ],
    [
      [
        { x: 2, y: 2 },
        { x: 4, y: 2 },
        { x: 4, y: 4 },
        { x: 2, y: 4 },
      ],
    ],
  )
}

const base: NestConfig = {
  gap: 0,
  ordering: 'area_desc',
  rotation: { kind: 'none' },
}

describe('nest — simple', () => {
  it('1. rectangle × rectangle', () => {
    const sheet = createSheet(20, 20, 0)
    const r = nest([rect('a', 4, 4), rect('b', 4, 4)], sheet, base)
    expect(r.placements.length).toBe(2)
    expect(r.unplaced.length).toBe(0)
    expect(r.metrics.sheetCount).toBe(1)
  })

  it('2. multiple identical rectangles', () => {
    const sheet = createSheet(30, 20, 0)
    const parts = [1, 2, 3, 4].map((i) => rect(`r${i}`, 5, 5))
    const r = nest(parts, sheet, base)
    expect(r.placements.length).toBe(4)
    expect(r.unplaced.length).toBe(0)
  })

  it('3. mixed rectangles', () => {
    const sheet = createSheet(40, 30, 1)
    const parts = [rect('a', 10, 5), rect('b', 6, 6), rect('c', 4, 8)]
    const r = nest(parts, sheet, { ...base, gap: 0 })
    expect(r.placements.length).toBe(3)
  })

  it('4. triangle', () => {
    const sheet = createSheet(20, 20, 0)
    const r = nest([triangle('t'), rect('r', 3, 3)], sheet, base)
    expect(r.placements.length).toBe(2)
  })

  it('5. L shape', () => {
    const sheet = createSheet(20, 20, 0)
    const r = nest([L('L'), rect('r', 2, 2)], sheet, base)
    expect(r.placements.length).toBe(2)
  })

  it('6. U shape', () => {
    const sheet = createSheet(20, 20, 0)
    const r = nest([U('U'), rect('r', 1.5, 1.5)], sheet, base)
    expect(r.placements.length).toBe(2)
  })
})

describe('nest — rotation', () => {
  it('7. orthogonal rotation', () => {
    // Tall thin part: 2×10 on 12×12 sheet — needs 90° to pack with another
    const sheet = createSheet(12, 12, 0)
    const parts = [rect('a', 2, 10), rect('b', 2, 10)]
    const r = nest(parts, sheet, {
      gap: 0,
      ordering: 'area_desc',
      rotation: { kind: 'orthogonal' },
    })
    expect(r.placements.length).toBe(2)
    expect(r.placements.every((p) => [0, 90, 180, 270].includes(p.rotationDeg))).toBe(
      true,
    )
  })

  it('8. fixed rotation', () => {
    const sheet = createSheet(20, 20, 0)
    const r = nest([rect('a', 4, 2)], sheet, {
      gap: 0,
      rotation: { kind: 'fixed', anglesDeg: [45] },
    })
    expect(r.placements[0]!.rotationDeg).toBe(45)
  })

  it('9. no rotation', () => {
    const sheet = createSheet(20, 20, 0)
    const r = nest([rect('a', 4, 2)], sheet, {
      gap: 0,
      rotation: { kind: 'none' },
    })
    expect(r.placements[0]!.rotationDeg).toBe(0)
  })
})

describe('nest — gap', () => {
  it('10. gap 0 allows touching', () => {
    const sheet = createSheet(20, 10, 0)
    const r = nest([rect('a', 5, 5), rect('b', 5, 5)], sheet, {
      gap: 0,
      rotation: { kind: 'none' },
    })
    expect(r.placements.length).toBe(2)
    const v = validatePlacement(
      r.placements[1]!,
      sheet,
      [r.placements[0]!],
      { gap: 0 },
    )
    expect(v.valid).toBe(true)
  })

  it('11. gap 5 enforced', () => {
    const sheet = createSheet(30, 20, 0)
    const r = nest([rect('a', 5, 5), rect('b', 5, 5)], sheet, {
      gap: 5,
      rotation: { kind: 'none' },
    })
    expect(r.placements.length).toBe(2)
    const v = validatePlacement(
      r.placements[1]!,
      sheet,
      [r.placements[0]!],
      { gap: 5 },
    )
    expect(v.valid).toBe(true)
    // Positions should be farther apart than gap=0 case would allow tightly
    const dx = Math.abs(r.placements[0]!.position.x - r.placements[1]!.position.x)
    const dy = Math.abs(r.placements[0]!.position.y - r.placements[1]!.position.y)
    expect(dx >= 10 - 1e-6 || dy >= 10 - 1e-6).toBe(true) // 5+5 centroids + gap
  })
})

describe('nest — sheet', () => {
  it('12. margin respected', () => {
    const sheet = createSheet(20, 20, 2)
    const r = nest([rect('a', 4, 4)], sheet, base)
    expect(r.placements[0]!.bounds.minX).toBeGreaterThanOrEqual(2 - 1e-6)
    expect(r.placements[0]!.bounds.minY).toBeGreaterThanOrEqual(2 - 1e-6)
  })

  it('13. part exactly fitting usable area', () => {
    const sheet = createSheet(20, 20, 5) // usable 10×10
    const r = nest([rect('a', 10, 10)], sheet, base)
    expect(r.placements.length).toBe(1)
    expect(r.unplaced.length).toBe(0)
  })

  it('14. part too large', () => {
    const sheet = createSheet(20, 20, 5) // usable 10×10
    const r = nest([rect('a', 12, 12)], sheet, base)
    expect(r.placements.length).toBe(0)
    expect(r.unplaced[0]!.reason).toBe('too-large')
  })

  it('15. multiple sheets', () => {
    const sheet = createSheet(12, 12, 0)
    const parts = [1, 2, 3].map((i) => rect(`r${i}`, 8, 8))
    const r = nest(parts, sheet, {
      gap: 0,
      rotation: { kind: 'none' },
      maxSheets: 5,
    })
    expect(r.placements.length).toBe(3)
    expect(r.metrics.sheetCount).toBeGreaterThanOrEqual(2)
    expect(new Set(r.placements.map((p) => p.sheetIndex)).size).toBe(
      r.metrics.sheetCount,
    )
  })
})

describe('nest — irregular', () => {
  it('16. concave parts', () => {
    const sheet = createSheet(30, 30, 0)
    const r = nest([L('L1'), L('L2')], sheet, {
      gap: 0,
      rotation: { kind: 'orthogonal' },
    })
    expect(r.placements.length).toBe(2)
  })

  it('17. hole-containing part', () => {
    const sheet = createSheet(30, 30, 0)
    const r = nest([frame('F'), rect('r', 2, 2)], sheet, base)
    expect(r.placements.length).toBe(2)
  })

  it('18. mixed concave + convex', () => {
    const sheet = createSheet(40, 40, 0)
    const r = nest([L('L'), rect('r', 3, 3), triangle('t')], sheet, {
      gap: 1,
      rotation: { kind: 'orthogonal' },
    })
    expect(r.placements.length).toBe(3)
  })

  it('19. rotated irregular parts', () => {
    const sheet = createSheet(30, 30, 0)
    const r = nest([L('L'), U('U')], sheet, {
      gap: 0,
      rotation: { kind: 'orthogonal' },
    })
    expect(r.placements.length).toBe(2)
  })
})

describe('nest — ordering', () => {
  it('sortParts area_desc is deterministic', () => {
    const parts = [rect('b', 2, 2), rect('a', 5, 5), rect('c', 5, 5)]
    const s1 = sortParts(parts, 'area_desc').map((p) => p.id)
    const s2 = sortParts(parts, 'area_desc').map((p) => p.id)
    expect(s1).toEqual(s2)
    expect(s1[0]).toBe('a') // equal area a before c by id
    expect(s1[1]).toBe('c')
  })
})
