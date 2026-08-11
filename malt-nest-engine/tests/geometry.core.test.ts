import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOLERANCE,
  absoluteArea,
  cleanRing,
  isCcw,
  isValidShape,
  makeShape,
  nearlyEqual,
  normalizeShape,
  pointInPolygon,
  pointInShape,
  pointOnSegment,
  polygonContainsPolygon,
  ringCentroid,
  rotateShape,
  scaleShape,
  shapeArea,
  shapeBounds,
  shapeCentroid,
  shapePerimeter,
  shapesIntersect,
  translateShape,
  validateShape,
} from '../src/geometry'

const rect = (w: number, h: number, id = 'r') =>
  makeShape(id, [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ])

const square = (s: number) => rect(s, s, 'sq')

const triangle = makeShape('tri', [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 0, y: 3 },
])

/** Concave L */
const L = makeShape('L', [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
  { x: 3, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 3 },
  { x: 0, y: 3 },
])

/** Concave U */
const U = makeShape('U', [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 2 },
  { x: 2, y: 2 },
  { x: 2, y: 0 },
  { x: 3, y: 0 },
  { x: 3, y: 3 },
  { x: 0, y: 3 },
])

describe('basic shapes', () => {
  it('1. rectangle area/bounds', () => {
    const s = normalizeShape(rect(10, 5))
    expect(shapeArea(s)).toBeCloseTo(50, 9)
    expect(shapeBounds(s)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 5,
    })
  })

  it('2. square', () => {
    expect(shapeArea(normalizeShape(square(4)))).toBeCloseTo(16, 9)
  })

  it('3. triangle', () => {
    expect(shapeArea(normalizeShape(triangle))).toBeCloseTo(6, 9)
  })

  it('4. concave L area', () => {
    // 3x3 square minus 2x2 = 9-4 = 5
    expect(shapeArea(normalizeShape(L))).toBeCloseTo(5, 9)
  })

  it('5. concave U area', () => {
    // 3x3 - 1x2 pocket = 9-2 = 7
    expect(shapeArea(normalizeShape(U))).toBeCloseTo(7, 9)
  })
})

describe('holes', () => {
  it('6. rectangle with one hole', () => {
    const s = normalizeShape(
      makeShape(
        'hole1',
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        [
          [
            { x: 2, y: 2 },
            { x: 8, y: 2 },
            { x: 8, y: 8 },
            { x: 2, y: 8 },
          ],
        ],
      ),
    )
    expect(shapeArea(s)).toBeCloseTo(100 - 36, 9)
    expect(isCcw(s.polygons[0]!.outer)).toBe(true)
    expect(isCcw(s.polygons[0]!.holes[0]!)).toBe(false)
    expect(pointInShape({ x: 5, y: 5 }, s)).toBe(false)
    expect(pointInShape({ x: 1, y: 1 }, s)).toBe(true)
  })

  it('7. rectangle with multiple holes', () => {
    const s = normalizeShape(
      makeShape(
        'holes',
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 10 },
          { x: 0, y: 10 },
        ],
        [
          [
            { x: 1, y: 1 },
            { x: 3, y: 1 },
            { x: 3, y: 3 },
            { x: 1, y: 3 },
          ],
          [
            { x: 15, y: 5 },
            { x: 18, y: 5 },
            { x: 18, y: 8 },
            { x: 15, y: 8 },
          ],
        ],
      ),
    )
    expect(shapeArea(s)).toBeCloseTo(200 - 4 - 9, 9)
  })

  it('8. donut-like (annulus approx)', () => {
    const outer = [
      { x: 5, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 5 },
    ]
    const hole = [
      { x: 5, y: 3 },
      { x: 7, y: 5 },
      { x: 5, y: 7 },
      { x: 3, y: 5 },
    ]
    const s = normalizeShape(makeShape('donut', outer, [hole]))
    expect(shapeArea(s)).toBeGreaterThan(0)
    expect(shapeArea(s)).toBeLessThan(absoluteArea(outer))
  })
})

describe('transforms', () => {
  it('9. translation', () => {
    const s = translateShape(normalizeShape(rect(2, 2)), 5, -3)
    expect(shapeBounds(s)).toEqual({
      minX: 5,
      minY: -3,
      maxX: 7,
      maxY: -1,
    })
  })

  it('10. 90° rotation', () => {
    const s = rotateShape(normalizeShape(rect(4, 2)), 90)
    const b = shapeBounds(s)!
    expect(nearlyEqual(b.maxX - b.minX, 2)).toBe(true)
    expect(nearlyEqual(b.maxY - b.minY, 4)).toBe(true)
  })

  it('11. 37.25° rotation preserves area', () => {
    const base = normalizeShape(L)
    const rot = rotateShape(base, 37.25)
    expect(shapeArea(rot)).toBeCloseTo(shapeArea(base), 9)
  })

  it('12. 180° rotation', () => {
    const s = rotateShape(normalizeShape(rect(3, 1)), 180)
    expect(shapeArea(s)).toBeCloseTo(3, 9)
  })

  it('13. scaling', () => {
    const s = scaleShape(normalizeShape(rect(2, 3)), 2)
    expect(shapeArea(s)).toBeCloseTo(24, 9)
  })
})

describe('measurement', () => {
  it('14–17 area perimeter centroid bbox', () => {
    const s = normalizeShape(rect(10, 4))
    expect(shapeArea(s)).toBeCloseTo(40, 9)
    expect(shapePerimeter(s)).toBeCloseTo(28, 9)
    const c = shapeCentroid(s)!
    expect(c.x).toBeCloseTo(5, 9)
    expect(c.y).toBeCloseTo(2, 9)
    expect(shapeBounds(s)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 4,
    })
  })
})

describe('robustness', () => {
  it('scales point-on-segment tolerance by edge length', () => {
    const tolerance = { ...DEFAULT_TOLERANCE, abs: 0.1 }

    expect(
      pointOnSegment(
        { x: 500, y: 0.0002 },
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        tolerance,
      ),
    ).toBe(true)
    expect(
      pointOnSegment(
        { x: 0.0005, y: 0.2 },
        { x: 0, y: 0 },
        { x: 0.001, y: 0 },
        tolerance,
      ),
    ).toBe(false)
  })

  it('uses an area tolerance for thin valid rings', () => {
    const tolerance = { ...DEFAULT_TOLERANCE, abs: 0.1 }
    const thin = rect(0.45, 0.11, 'thin')

    expect(ringCentroid(thin.polygons[0]!.outer, tolerance)).not.toBeNull()
    expect(shapeCentroid(thin, tolerance)).not.toBeNull()
    expect(validateShape(thin, tolerance).ok).toBe(true)
  })

  it('18. duplicate points cleaned', () => {
    const dirty = makeShape('dup', [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ])
    const n = normalizeShape(dirty)
    expect(n.polygons[0]!.outer.length).toBe(4)
    expect(isValidShape(n)).toBe(true)
  })

  it('19. collinear points cleaned', () => {
    const dirty = makeShape('col', [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ])
    const cleaned = cleanRing(dirty.polygons[0]!.outer, DEFAULT_TOLERANCE)
    expect(cleaned.length).toBeLessThanOrEqual(4)
  })

  it('20. very small edges', () => {
    const s = normalizeShape(
      makeShape('tiny', [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1 + 1e-15, y: 1e-15 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]),
    )
    expect(shapeArea(s)).toBeGreaterThan(0)
  })

  it('21. nearly touching — no false intersection', () => {
    const a = normalizeShape(rect(1, 1))
    const b = translateShape(normalizeShape(rect(1, 1)), 1.001, 0)
    expect(shapesIntersect(a, b)).toBe(false)
  })

  it('22. reversed winding normalized', () => {
    const cw = makeShape('cw', [
      { x: 0, y: 0 },
      { x: 0, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 0 },
    ])
    const n = normalizeShape(cw)
    expect(isCcw(n.polygons[0]!.outer)).toBe(true)
  })

  it('23. invalid polygon reported', () => {
    const bad = makeShape('bad', [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ])
    expect(validateShape(bad).ok).toBe(false)
  })

  it('rejects non-finite coordinates', () => {
    const nan = makeShape('nan', [
      { x: 0, y: 0 },
      { x: Number.NaN, y: 0 },
      { x: 0, y: 1 },
    ])
    const infinite = makeShape('infinite', [
      { x: 0, y: 0 },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 0, y: 1 },
    ])

    expect(validateShape(nan)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(['non_finite_coordinate']),
    })
    expect(validateShape(infinite)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(['non_finite_coordinate']),
    })
  })

  it('reports an explicit closing point instead of treating it as a vertex', () => {
    const closed = makeShape('closed', [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 0, y: 0 },
    ])

    expect(validateShape(closed)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(['open_ring_duplicate']),
    })
  })

  it('rejects non-adjacent vertex touches and collinear edge overlaps', () => {
    const selfTouching = makeShape('self-touching', [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 2, y: 2 },
      { x: 0, y: 4 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ])
    const overlappingEdges = makeShape('overlapping-edges', [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 0, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
      { x: 1, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 1 },
      { x: 0, y: 1 },
    ])

    for (const shape of [selfTouching, overlappingEdges]) {
      expect(validateShape(shape)).toMatchObject({
        ok: false,
        issues: expect.arrayContaining(['self_intersecting']),
      })
    }
  })

  it('requires holes to be strictly inside the outer ring', () => {
    const outer = rect(10, 10).polygons[0]!.outer
    const outside = [
      { x: 8, y: 2 },
      { x: 12, y: 2 },
      { x: 12, y: 4 },
      { x: 8, y: 4 },
    ]
    const touching = [
      { x: 0, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ]

    for (const hole of [outside, touching]) {
      expect(validateShape(makeShape('bad-hole', outer, [hole]))).toMatchObject(
        {
          ok: false,
          issues: expect.arrayContaining(['hole_outside']),
        },
      )
    }
  })

  it('rejects overlapping or touching holes but accepts disjoint holes', () => {
    const outer = rect(20, 10).polygons[0]!.outer
    const left = [
      { x: 2, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 8 },
      { x: 2, y: 8 },
    ]
    const overlapping = [
      { x: 6, y: 3 },
      { x: 10, y: 3 },
      { x: 10, y: 7 },
      { x: 6, y: 7 },
    ]
    const touching = [
      { x: 8, y: 3 },
      { x: 10, y: 3 },
      { x: 10, y: 7 },
      { x: 8, y: 7 },
    ]
    const right = [
      { x: 12, y: 2 },
      { x: 18, y: 2 },
      { x: 18, y: 8 },
      { x: 12, y: 8 },
    ]

    for (const second of [overlapping, touching]) {
      expect(validateShape(makeShape('bad-holes', outer, [left, second]))).toMatchObject(
        {
          ok: false,
          issues: expect.arrayContaining(['holes_intersect']),
        },
      )
    }
    expect(validateShape(makeShape('good-holes', outer, [left, right])).ok).toBe(
      true,
    )
  })

  it('rejects provably overlapping multipolygons', () => {
    const ringAt = (x: number, y: number, w: number, h: number) => [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ]
    const shape = (second: ReturnType<typeof ringAt>) => ({
      id: 'multi',
      polygons: [
        { outer: ringAt(0, 0, 5, 5), holes: [] },
        { outer: second, holes: [] },
      ],
    })

    expect(validateShape(shape(ringAt(4, 1, 5, 3)))).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(['polygons_overlap']),
    })
    expect(validateShape(shape(ringAt(1, 1, 2, 2)))).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(['polygons_overlap']),
    })
    expect(validateShape(shape(ringAt(4, 0, 5, 5)))).toMatchObject({
      ok: false,
      issues: expect.arrayContaining(['polygons_overlap']),
    })
    expect(validateShape(shape(ringAt(6, 0, 2, 2))).ok).toBe(true)
    expect(validateShape(shape(ringAt(5, 0, 2, 2))).ok).toBe(true)
  })

  it('allows a multipolygon island inside another polygon hole', () => {
    const shape = {
      id: 'island',
      polygons: [
        {
          outer: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          holes: [
            [
              { x: 5, y: 5 },
              { x: 15, y: 5 },
              { x: 15, y: 15 },
              { x: 5, y: 15 },
            ],
          ],
        },
        {
          outer: [
            { x: 8, y: 8 },
            { x: 12, y: 8 },
            { x: 12, y: 12 },
            { x: 8, y: 12 },
          ],
          holes: [],
        },
      ],
    }

    expect(validateShape(shape).ok).toBe(true)
  })
})

describe('relations', () => {
  it('contains / intersect', () => {
    const outer = normalizeShape(rect(10, 10))
    const inner = translateShape(normalizeShape(rect(2, 2)), 3, 3)
    expect(
      polygonContainsPolygon(outer.polygons[0]!, inner.polygons[0]!),
    ).toBe(true)
    expect(pointInPolygon({ x: 4, y: 4 }, outer.polygons[0]!)).toBe(true)
    const overlap = translateShape(normalizeShape(rect(5, 5)), 8, 8)
    expect(shapesIntersect(outer, overlap)).toBe(true)
  })
})
