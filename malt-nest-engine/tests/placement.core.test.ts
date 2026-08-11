import { describe, expect, it } from 'vitest'
import { makeShape, shapeArea } from '../src/geometry'
import {
  collidePlacements,
  createPlacement,
  createSheet,
  isInsideSheet,
  usableRegion,
  validatePlacement,
} from '../src/placement'

const rect = (id: string, w: number, h: number) =>
  makeShape(id, [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ])

const L = makeShape('L', [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
  { x: 3, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 3 },
  { x: 0, y: 3 },
])

const sheet = createSheet(1600, 1000, 10)

describe('sheet', () => {
  it('1. shape fully inside', () => {
    const p = createPlacement(rect('a', 100, 50), { x: 100, y: 100 }, 0)
    expect(isInsideSheet(p, sheet)).toBe(true)
    expect(validatePlacement(p, sheet).reason).toBe('ok')
  })

  it('2. shape outside sheet', () => {
    const p = createPlacement(rect('a', 100, 50), { x: 2000, y: 100 }, 0)
    expect(isInsideSheet(p, sheet)).toBe(false)
    expect(validatePlacement(p, sheet).reason).toBe('outside-sheet')
  })

  it('3. margin violation', () => {
    // centroid at (25, 25), half-size 20 → extends to x=5 < margin 10
    const p = createPlacement(rect('a', 40, 40), { x: 25, y: 25 }, 0)
    expect(isInsideSheet(p, sheet)).toBe(false)
    expect(validatePlacement(p, sheet).reason).toBe('outside-sheet')
  })

  it('4. flush to usable corner', () => {
    const u = usableRegion(sheet)
    // 40×40 rect, centroid inset 20 from usable min
    const p = createPlacement(
      rect('a', 40, 40),
      { x: u.minX + 20, y: u.minY + 20 },
      0,
    )
    expect(isInsideSheet(p, sheet)).toBe(true)
  })

  it('5. tolerance boundary', () => {
    const u = usableRegion(sheet)
    const p = createPlacement(
      rect('a', 40, 40),
      { x: u.minX + 20, y: u.minY + 20 },
      0,
    )
    expect(isInsideSheet(p, sheet)).toBe(true)
  })
})

describe('rotation placements', () => {
  for (const ang of [0, 90, 180, 270, 37.25, 123.456]) {
    it(`rotation ${ang}° keeps area & can sit on sheet`, () => {
      const p = createPlacement(rect('r', 80, 40), { x: 400, y: 400 }, ang)
      expect(shapeArea(p.geometry)).toBeCloseTo(3200, 6)
      expect(validatePlacement(p, sheet).valid).toBe(true)
    })
  }
})

describe('translation', () => {
  it('12. positive translation', () => {
    const p = createPlacement(rect('a', 20, 20), { x: 200, y: 200 }, 0)
    expect(p.bounds.minX).toBeCloseTo(190, 9)
  })

  it('13. negative translation still on large sheet', () => {
    const p = createPlacement(rect('a', 20, 20), { x: 50, y: 50 }, 0)
    expect(validatePlacement(p, sheet).valid).toBe(true)
  })

  it('14. translation to sheet edge', () => {
    const u = usableRegion(sheet)
    const p = createPlacement(
      rect('a', 20, 20),
      { x: u.maxX - 10, y: u.maxY - 10 },
      0,
    )
    expect(validatePlacement(p, sheet).valid).toBe(true)
    const out = createPlacement(
      rect('a', 20, 20),
      { x: u.maxX - 9, y: u.maxY - 10 },
      0,
    )
    expect(validatePlacement(out, sheet).reason).toBe('outside-sheet')
  })
})

describe('collision', () => {
  it('15. rectangle overlap', () => {
    const a = createPlacement(rect('a', 40, 40), { x: 100, y: 100 }, 0)
    const b = createPlacement(rect('b', 40, 40), { x: 110, y: 100 }, 0)
    expect(collidePlacements(a, b, 0).kind).toBe('overlap')
    expect(validatePlacement(b, sheet, [a], { gap: 0 }).reason).toBe(
      'collision',
    )
  })

  it('16. rectangle touching (gap=0 allowed)', () => {
    const a = createPlacement(rect('a', 40, 40), { x: 100, y: 100 }, 0)
    // half-width 20 → right edge 120; b left edge 120 when centroid 140
    const b = createPlacement(rect('b', 40, 40), { x: 140, y: 100 }, 0)
    const hit = collidePlacements(a, b, 0)
    expect(hit.kind === 'touch' || hit.kind === 'none').toBe(true)
    expect(validatePlacement(b, sheet, [a], { gap: 0 }).valid).toBe(true)
  })

  it('17. rectangles separate', () => {
    const a = createPlacement(rect('a', 40, 40), { x: 100, y: 100 }, 0)
    const b = createPlacement(rect('b', 40, 40), { x: 300, y: 100 }, 0)
    expect(collidePlacements(a, b, 0).kind).toBe('none')
  })

  it('18. concave overlap', () => {
    const a = createPlacement(L, { x: 200, y: 200 }, 0)
    const b = createPlacement(rect('b', 2, 2), { x: 200.5, y: 200.5 }, 0)
    // L centroid ~ (1.1, 1.1) area-weighted — place overlapping arm
    expect(collidePlacements(a, b, 0).kind).toBe('overlap')
  })

  it('19. hole: small part inside hole — no collision', () => {
    const frame = makeShape(
      'frame',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      [
        [
          { x: 20, y: 20 },
          { x: 80, y: 20 },
          { x: 80, y: 80 },
          { x: 20, y: 80 },
        ],
      ],
    )
    const a = createPlacement(frame, { x: 400, y: 400 }, 0)
    const b = createPlacement(rect('inner', 20, 20), { x: 400, y: 400 }, 0)
    expect(['none', 'touch']).toContain(collidePlacements(a, b, 0).kind)
    expect(validatePlacement(b, sheet, [a], { gap: 0 }).valid).toBe(true)
  })

  it('20. hole: overlap with frame material', () => {
    const frame = makeShape(
      'frame',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      [
        [
          { x: 20, y: 20 },
          { x: 80, y: 20 },
          { x: 80, y: 80 },
          { x: 20, y: 80 },
        ],
      ],
    )
    const a = createPlacement(frame, { x: 400, y: 400 }, 0)
    // sit on the rim (left strip ~ x in [350,370] if centroid 400)
    const b = createPlacement(rect('rim', 10, 10), { x: 355, y: 400 }, 0)
    expect(collidePlacements(a, b, 0).kind).toBe('overlap')
  })
})

describe('gap', () => {
  it('21. gap=0 overlap invalid', () => {
    const a = createPlacement(rect('a', 40, 40), { x: 200, y: 200 }, 0)
    const b = createPlacement(rect('b', 40, 40), { x: 210, y: 200 }, 0)
    expect(validatePlacement(b, sheet, [a], { gap: 0 }).reason).toBe(
      'collision',
    )
  })

  it('22–24. gap=5 exact / violation', () => {
    const a = createPlacement(rect('a', 40, 40), { x: 200, y: 200 }, 0)
    // right edge at 220; with gap 5, next left edge ≥ 225 → centroid ≥ 245
    const exact = createPlacement(rect('b', 40, 40), { x: 245, y: 200 }, 0)
    expect(collidePlacements(a, exact, 5).kind).toBe('none')
    expect(validatePlacement(exact, sheet, [a], { gap: 5 }).valid).toBe(true)

    const violate = createPlacement(rect('c', 40, 40), { x: 244, y: 200 }, 0)
    expect(collidePlacements(a, violate, 5).kind).toBe('gap-violation')
    expect(validatePlacement(violate, sheet, [a], { gap: 5 }).reason).toBe(
      'gap-violation',
    )
  })
})

describe('combined', () => {
  it('25. rotated + translated', () => {
    const p = createPlacement(rect('a', 60, 20), { x: 500, y: 500 }, 37.25)
    expect(validatePlacement(p, sheet).valid).toBe(true)
  })

  it('26. rotated + margin', () => {
    // 200×10 → after 90°, half-extent 100 in Y; centroid y=100 → reaches y=0 < margin 10
    const p = createPlacement(rect('a', 200, 10), { x: 200, y: 100 }, 90)
    expect(validatePlacement(p, sheet).reason).toBe('outside-sheet')
  })

  it('27. concave + collision', () => {
    const a = createPlacement(L, { x: 300, y: 300 }, 15)
    const b = createPlacement(L, { x: 300.2, y: 300.2 }, 15)
    expect(validatePlacement(b, sheet, [a], { gap: 0 }).reason).toBe(
      'collision',
    )
  })

  it('28. hole-containing shape on sheet', () => {
    const frame = makeShape(
      'frame',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      [
        [
          { x: 30, y: 30 },
          { x: 70, y: 30 },
          { x: 70, y: 70 },
          { x: 30, y: 70 },
        ],
      ],
    )
    const p = createPlacement(frame, { x: 400, y: 400 }, 0)
    expect(validatePlacement(p, sheet).valid).toBe(true)
    expect(shapeArea(p.geometry)).toBeCloseTo(10000 - 1600, 5)
  })
})
