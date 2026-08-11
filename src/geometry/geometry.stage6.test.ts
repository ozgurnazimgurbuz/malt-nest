import { describe, expect, it } from 'vitest'
import {
  classifySeparation,
  computeIfp,
  computeNfp,
  canFitInHole,
  findPartInPartPlacement,
  configureGeometryTolerance,
  geomEps,
  normalizePolygon,
  offsetPolygon,
  offsetSolid,
  solidFromRings,
  solidInsideSheet,
  solidsCollide,
  solidsOverlap,
  translationInNfp,
  translateSolid,
  validateGeometry,
} from './index'
import { rotatePoints, partRotationOrigin } from './transform'

function rect(w: number, h: number, x = 0, y = 0) {
  return solidFromRings(
    [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    [],
  )
}

function LShape() {
  // Concave L
  return solidFromRings(
    [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 30 },
      { x: 0, y: 30 },
    ],
    [],
  )
}

function frameWithHole() {
  return solidFromRings(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    [
      // CW hole
      [
        { x: 20, y: 20 },
        { x: 20, y: 80 },
        { x: 80, y: 80 },
        { x: 80, y: 20 },
      ],
    ],
  )
}

describe('Stage 6 — offset', () => {
  it('1. convex offset expands area', () => {
    const r = rect(10, 10)
    const off = offsetPolygon(r.outer, 2)
    expect(off.polygon.points.length).toBeGreaterThanOrEqual(3)
    const b = off.polygon.points
    const xs = b.map((p) => p.x)
    const ys = b.map((p) => p.y)
    expect(Math.min(...xs)).toBeLessThan(-1)
    expect(Math.max(...xs)).toBeGreaterThan(11)
    expect(Math.min(...ys)).toBeLessThan(-1)
    expect(Math.max(...ys)).toBeGreaterThan(11)
  })

  it('2. concave offset returns polygon', () => {
    const L = LShape()
    const off = offsetPolygon(L.outer, 1)
    expect(off.polygon.points.length).toBeGreaterThanOrEqual(3)
    expect(off.issues.every((i) => i.code !== 'nan')).toBe(true)
  })

  it('3. hole offset shrinks opening on positive solid offset', () => {
    const f = frameWithHole()
    const off = offsetSolid(f, 2)
    expect(off.solid.holes.length).toBe(1)
    const hole = off.solid.holes[0]!
    const xs = hole.points.map((p) => p.x)
    expect(Math.min(...xs)).toBeGreaterThan(20)
    expect(Math.max(...xs)).toBeLessThan(80)
  })

  it('4. positive offset', () => {
    const r = rect(20, 10)
    const a0 = Math.abs(
      r.outer.points.reduce((s, p, i, arr) => {
        const q = arr[(i + 1) % arr.length]!
        return s + (p.x * q.y - q.x * p.y)
      }, 0) / 2,
    )
    const off = offsetPolygon(r.outer, 3)
    const a1 = Math.abs(
      off.polygon.points.reduce((s, p, i, arr) => {
        const q = arr[(i + 1) % arr.length]!
        return s + (p.x * q.y - q.x * p.y)
      }, 0) / 2,
    )
    expect(a1).toBeGreaterThan(a0)
  })

  it('5. negative offset', () => {
    const r = rect(20, 20)
    const off = offsetPolygon(r.outer, -3)
    expect(off.polygon.points.length).toBeGreaterThanOrEqual(3)
    const xs = off.polygon.points.map((p) => p.x)
    expect(Math.min(...xs)).toBeGreaterThan(2)
    expect(Math.max(...xs)).toBeLessThan(18)
  })
})

describe('Stage 6 — collision', () => {
  it('6. touching polygons', () => {
    const a = rect(10, 10, 0, 0)
    const b = rect(10, 10, 10, 0)
    const sep = classifySeparation(a, b)
    expect(sep.kind).toBe('touching')
    expect(solidsOverlap(a, b)).toBe(false)
    expect(solidsCollide(a, b, 0)).toBe(false)
  })

  it('detects thin collinear overlap without treating exact touch as overlap', () => {
    const a = rect(10, 10, 0, 0)
    const overlapping = rect(10.0005, 10, 9.9995, 0)
    const touching = rect(10, 10, 10, 0)

    expect(solidsOverlap(a, overlapping)).toBe(true)
    expect(solidsCollide(a, overlapping, 0)).toBe(true)
    expect(solidsOverlap(a, touching)).toBe(false)
  })

  it('uses Euclidean spacing at diagonal corners in canonical NFPs', () => {
    const spacing = 2
    const diagonal = spacing / Math.sqrt(2)
    const stationary = rect(10, 10)
    const moving = rect(1, 1)
    const translation = { x: 10 + diagonal, y: 10 + diagonal }
    const placed = translateSolid(moving, translation.x, translation.y)

    expect(solidsCollide(stationary, placed, spacing)).toBe(false)
    expect(
      translationInNfp(
        translation,
        computeNfp(stationary, moving, spacing, { fidelity: 'exact' }),
      ),
    ).toBe(false)
  })

  it('7. overlapping polygons', () => {
    const a = rect(10, 10, 0, 0)
    const b = rect(10, 10, 5, 5)
    expect(solidsOverlap(a, b)).toBe(true)
    expect(classifySeparation(a, b).kind).toBe('overlap')
  })

  it('8. separated polygons', () => {
    const a = rect(10, 10, 0, 0)
    const b = rect(10, 10, 15, 0)
    const sep = classifySeparation(a, b)
    expect(sep.kind).toBe('separated')
    expect(sep.distanceMm).toBeGreaterThan(4.9)
    expect(solidsCollide(a, b, 5)).toBe(false)
    expect(solidsCollide(a, b, 6)).toBe(true)
  })

  it('9. concave collision', () => {
    const L = LShape()
    const block = rect(8, 8, 12, 12) // sits in the L notch — should not overlap L material
    expect(solidsOverlap(L, block)).toBe(false)
    const hit = rect(8, 8, 2, 2)
    expect(solidsOverlap(L, hit)).toBe(true)
  })

  it('10. hole collision — guest in hole does not overlap solid', () => {
    const host = frameWithHole()
    const guest = rect(20, 20, 40, 40)
    expect(solidsOverlap(host, guest)).toBe(false)
    const onRim = rect(20, 20, 10, 10)
    expect(solidsOverlap(host, onRim)).toBe(true)
  })
})

describe('Stage 6 — containment / IFP', () => {
  it('11. rectangle inside sheet', () => {
    const r = rect(50, 40, 10, 10)
    expect(solidInsideSheet(r, 200, 200, 5)).toBe(true)
  })

  it('12. concave shape inside sheet', () => {
    const L = translateSolid(LShape(), 20, 20)
    expect(solidInsideSheet(L, 200, 200, 5)).toBe(true)
  })

  it('13. rotated shape inside sheet', () => {
    const origin = partRotationOrigin(rect(40, 10).outer.points)
    const pts = rotatePoints(rect(40, 10).outer.points, 90, origin)
    const s = solidFromRings(pts, [])
    const moved = translateSolid(s, 50, 50)
    expect(solidInsideSheet(moved, 200, 200, 5)).toBe(true)
  })

  it('14. shape crossing sheet boundary', () => {
    const r = rect(50, 40, -5, 10)
    expect(solidInsideSheet(r, 200, 200, 5)).toBe(false)
    const ifp = computeIfp(rect(50, 40), 100, 100, 10)
    expect(ifp).not.toBeNull()
    expect(ifp!.maxX).toBeLessThan(ifp!.minX + 100)
  })
})

describe('Stage 6 — NFP', () => {
  it('15. rectangle vs rectangle', () => {
    const A = rect(10, 10)
    const B = rect(2, 2)
    const nfp = computeNfp(A, B, 0)
    expect(nfp.exact).toBe(true)
    expect(nfp.regions.length).toBe(1)
    expect(nfp.outer.points.length).toBeGreaterThanOrEqual(4)
    const xs = nfp.outer.points.map((p) => p.x)
    const ys = nfp.outer.points.map((p) => p.y)
    // Forbidden region covers near-origin translations
    expect(Math.min(...xs)).toBeLessThanOrEqual(0)
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.min(...ys)).toBeLessThanOrEqual(0)
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(0)
    // Far point outside NFP AABB
    expect(100 > Math.max(...xs) || 100 > Math.max(...ys)).toBe(true)
  })

  it('16. triangle vs rectangle', () => {
    const A = rect(20, 20)
    const B = solidFromRings(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 8 },
      ],
      [],
    )
    const nfp = computeNfp(A, B, 0)
    expect(nfp.regions.length).toBeGreaterThanOrEqual(1)
    expect(nfp.outer.points.length).toBeGreaterThanOrEqual(3)
  })

  it('17. concave vs rectangle', () => {
    const nfp = computeNfp(LShape(), rect(5, 5), 0)
    expect(nfp.method).toMatch(/minkowski/)
    expect(nfp.regions.length).toBeGreaterThanOrEqual(1)
    expect(nfp.exact).toBe(false)
    // Topology: may include holes in forbidden region
    expect(nfp.outers.length).toBeGreaterThanOrEqual(1)
  })

  it('18. hole-containing polygon NFP uses outer only', () => {
    const nfp = computeNfp(frameWithHole(), rect(5, 5), 0)
    expect(nfp.regions.length).toBeGreaterThanOrEqual(1)
    // NFP should be finite / non-empty geometry, not a bbox claim without regions
    expect(nfp.outer.points.length).toBeGreaterThanOrEqual(3)
  })

  it('19. spacing-aware NFP enlarges forbidden region', () => {
    const A = rect(10, 10)
    const B = rect(2, 2)
    const n0 = computeNfp(A, B, 0)
    const n5 = computeNfp(A, B, 5)
    const area = (pts: { x: number; y: number }[]) =>
      Math.abs(
        pts.reduce((s, p, i, arr) => {
          const q = arr[(i + 1) % arr.length]!
          return s + (p.x * q.y - q.x * p.y)
        }, 0) / 2,
      )
    expect(area(n5.outer.points)).toBeGreaterThan(area(n0.outer.points))
  })

  it('20. rotated NFP', () => {
    const A = rect(20, 10)
    const origin = partRotationOrigin(rect(8, 4).outer.points)
    const pts = rotatePoints(rect(8, 4).outer.points, 90, origin)
    const B = solidFromRings(pts, [])
    const nfp = computeNfp(A, B, 0)
    expect(nfp.regions.length).toBeGreaterThanOrEqual(1)
    expect(nfp.outer.points.length).toBeGreaterThanOrEqual(3)
  })
})

describe('Stage 6 — part-in-part', () => {
  it('21. fitting part inside hole', () => {
    const host = frameWithHole()
    const guest = rect(30, 30)
    const fit = canFitInHole(host, guest, 0, 0)
    expect(fit.fits).toBe(true)
    expect(fit.translation).toBeDefined()
  })

  it('22. oversized part rejected', () => {
    const host = frameWithHole()
    const guest = rect(70, 70)
    const fit = canFitInHole(host, guest, 0, 0)
    expect(fit.fits).toBe(false)
    expect(fit.reason).toMatch(/too_large|not_contained/)
  })

  it('23. spacing violation rejected', () => {
    const host = frameWithHole()
    // hole is 60×60; guest 55 with spacing 5 → effective hole 50 → reject
    const guest = rect(55, 55)
    const fit = canFitInHole(host, guest, 0, 5)
    expect(fit.fits).toBe(false)
  })

  it('finds an off-center fit in an asymmetric hole and checks obstacles', () => {
    const host = solidFromRings(
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 30 },
        { x: 0, y: 30 },
      ],
      [[
        { x: 5, y: 5 },
        { x: 25, y: 25 },
        { x: 25, y: 5 },
      ]],
    )
    const guest = rect(10, 10)

    const fit = findPartInPartPlacement(host, guest, 0)
    expect(fit?.fits).toBe(true)
    expect(fit?.translation?.x).toBeCloseTo(15)
    expect(fit?.translation?.y).toBeCloseTo(5)

    const blocker = rect(10, 10, 15, 5)
    expect(findPartInPartPlacement(host, guest, 0, [host, blocker])).toBeNull()
  })

  it('searches every component when spacing splits a concave hole', () => {
    const opening = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 2 },
      { x: 110, y: 2 },
      { x: 110, y: 0 },
      { x: 130, y: 0 },
      { x: 130, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 3 },
      { x: 100, y: 3 },
      { x: 100, y: 5 },
      { x: 0, y: 5 },
    ]
    const host = solidFromRings(
      [
        { x: -10, y: -10 },
        { x: 140, y: -10 },
        { x: 140, y: 30 },
        { x: -10, y: 30 },
      ],
      [opening.slice().reverse()],
    )

    const fit = findPartInPartPlacement(host, rect(50, 2), 0.6)
    expect(fit?.translation?.x).toBeLessThan(50)
  })

  it('finds dense-ring fits independently of the guest cyclic start vertex', () => {
    const segmentedRectangle = (): Array<{ x: number; y: number }> => [
      ...Array.from({ length: 20 }, (_, i) => ({ x: i * 5, y: 0 })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 100, y: i * 5 })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 100 - i * 5, y: 100 })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 0, y: 100 - i * 5 })),
    ]
    const opening = segmentedRectangle().flatMap((point) => {
      if (point.x === 0 && point.y === 0) {
        return [point, { x: 0, y: -2 }, { x: 5, y: -2 }]
      }
      if (point.x === 100 && point.y === 0) {
        return [point, { x: 104, y: 0 }, { x: 104, y: 5 }]
      }
      if (point.x === 100 && point.y === 100) {
        return [point, { x: 100, y: 105 }, { x: 95, y: 105 }]
      }
      if (point.x === 0 && point.y === 100) {
        return [point, { x: -3, y: 100 }, { x: -3, y: 95 }]
      }
      return [point]
    })
    const host = solidFromRings(
      [
        { x: -10, y: -10 },
        { x: 110, y: -10 },
        { x: 110, y: 110 },
        { x: -10, y: 110 },
      ],
      [opening.slice().reverse()],
    )
    const unshifted = segmentedRectangle()
    const shifted = [...unshifted.slice(3), ...unshifted.slice(0, 3)]

    for (const ring of [unshifted, shifted]) {
      const fit = findPartInPartPlacement(host, solidFromRings(ring, []), 0)
      expect(fit?.translation?.x).toBeCloseTo(0)
      expect(fit?.translation?.y).toBeCloseTo(0)
    }
  })

  it('finds the exact zero-area IFP in a four-bump rotated chamber', () => {
    const width = 9.7918
    const height = 8.414057
    const guestRing = [
      { x: 1.805445, y: 0 },
      { x: width, y: 6.01815 },
      { x: 7.986355, y: height },
      { x: 0, y: 2.395907 },
    ]
    const opening = [
      { x: 0, y: 0 },
      { x: width * 0.2, y: 0 },
      { x: width * 0.2, y: -5 },
      { x: width * 0.3, y: -5 },
      { x: width * 0.3, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height * 0.2 },
      { x: width + 5, y: height * 0.2 },
      { x: width + 5, y: height * 0.3 },
      { x: width, y: height * 0.3 },
      { x: width, y: height },
      { x: width * 0.8, y: height },
      { x: width * 0.8, y: height + 6 },
      { x: width * 0.7, y: height + 6 },
      { x: width * 0.7, y: height },
      { x: 0, y: height },
      { x: 0, y: height * 0.8 },
      { x: -4, y: height * 0.8 },
      { x: -4, y: height * 0.7 },
      { x: 0, y: height * 0.7 },
    ]
    const host = solidFromRings(
      [
        { x: -20, y: -20 },
        { x: 30, y: -20 },
        { x: 30, y: 30 },
        { x: -20, y: 30 },
      ],
      [opening.slice().reverse()],
    )

    const fit = findPartInPartPlacement(
      host,
      solidFromRings(guestRing, []),
      0,
    )
    expect(fit?.translation?.x).toBeCloseTo(0)
    expect(fit?.translation?.y).toBeCloseTo(0)
  })

  it('falls through from failed centroid alignment for near-equal shapes', () => {
    const opening = [
      { x: 0, y: 0 },
      { x: 1_000_000, y: 0 },
      { x: 1_000_000, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 1_000_000 },
      { x: 0, y: 1_000_000 },
    ]
    const guest = solidFromRings(
      [
        { x: 0, y: 0 },
        { x: 999_999.9, y: 0 },
        { x: 999_999.9, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 1_000_000 },
        { x: 0, y: 1_000_000 },
      ],
      [],
    )
    const host = solidFromRings(
      [
        { x: -1, y: -1 },
        { x: 1_000_001, y: -1 },
        { x: 1_000_001, y: 1_000_001 },
        { x: -1, y: 1_000_001 },
      ],
      [opening.slice().reverse()],
    )

    const fit = canFitInHole(host, guest, 0, 0)

    expect(fit.translation?.x).toBeCloseTo(0)
    expect(fit.translation?.y).toBeCloseTo(0)
  })

  it('collapses dense collinear rings before configuration-space search', () => {
    const sideSegments = 250
    const step = 100 / sideSegments
    const ring = [
      ...Array.from({ length: sideSegments }, (_, i) => ({ x: i * step, y: 0 })),
      ...Array.from({ length: sideSegments }, (_, i) => ({ x: 100, y: i * step })),
      ...Array.from({ length: sideSegments }, (_, i) => ({ x: 100 - i * step, y: 100 })),
      ...Array.from({ length: sideSegments }, (_, i) => ({ x: 0, y: 100 - i * step })),
    ]
    const host = solidFromRings(
      [
        { x: -10, y: -10 },
        { x: 110, y: -10 },
        { x: 110, y: 110 },
        { x: -10, y: 110 },
      ],
      [ring.slice().reverse()],
    )
    const shifted = [...ring.slice(337), ...ring.slice(0, 337)]
    const started = performance.now()

    const fit = findPartInPartPlacement(
      host,
      solidFromRings(shifted, []),
      0,
    )

    expect(fit?.translation).toEqual({ x: 0, y: 0 })
    expect(performance.now() - started).toBeLessThan(1_500)
  })

  it('subtracts obstacle forbidden regions before probing a positive-area IFP', () => {
    const opening = [
      { x: 5, y: 5 },
      { x: 5, y: 25 },
      { x: 35, y: 25 },
      { x: 35, y: 5 },
    ]
    const host = solidFromRings(
      [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 30 },
        { x: 0, y: 30 },
      ],
      [opening],
    )
    const guest = rect(4, 4)
    const finiteProbes = [5, 18, 31].flatMap((x) =>
      [5, 13, 21].map((y) => rect(1, 1, x + 1.5, y + 1.5)),
    )

    const fit = findPartInPartPlacement(host, guest, 0, [host, ...finiteProbes])

    expect(fit?.translation).toBeDefined()
    const placed = translateSolid(
      guest,
      fit!.translation!.x,
      fit!.translation!.y,
    )
    expect(finiteProbes.some((blocker) => solidsCollide(blocker, placed, 0))).toBe(
      false,
    )
  })

  it('keeps zero-width fit branches when a positive-area room is blocked', () => {
    const opening = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 8, y: 1 },
      { x: 8, y: 3 },
      { x: 4, y: 3 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]
    const host = solidFromRings(
      [
        { x: -1, y: -1 },
        { x: 9, y: -1 },
        { x: 9, y: 5 },
        { x: -1, y: 5 },
      ],
      [opening.reverse()],
    )
    const blockers = [
      rect(2, 2),
      rect(2, 2, 2, 0),
      rect(2, 2, 0, 2),
      rect(2, 2, 2, 2),
    ]

    const fit = findPartInPartPlacement(host, rect(2, 2), 0, [host, ...blockers])

    expect(fit?.translation?.x).toBeGreaterThanOrEqual(4)
    expect(fit?.translation?.y).toBeCloseTo(1)
  })

  it('rejects a dense near-fit without quadratic contact intersections', () => {
    const count = 200
    const radius = 10
    const regularRing = (phase: number) =>
      Array.from({ length: count }, (_, index) => {
        const angle = phase + (index * Math.PI * 2) / count
        return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
      })
    const host = solidFromRings(
      [
        { x: -20, y: -20 },
        { x: 20, y: -20 },
        { x: 20, y: 20 },
        { x: -20, y: 20 },
      ],
      [regularRing(0).reverse()],
    )
    const guest = solidFromRings(regularRing(Math.PI / count), [])
    const started = performance.now()

    expect(findPartInPartPlacement(host, guest, 0)).toBeNull()
    expect(performance.now() - started).toBeLessThan(1_500)
  })
})

describe('Stage 6 — numerical robustness', () => {
  it('24. duplicate points', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const n = normalizePolygon(pts, true)
    expect(n.ok).toBe(true)
    expect(n.polygon.points.length).toBe(4)
  })

  it('25. tiny edges', () => {
    const e = geomEps()
    const pts = [
      { x: 0, y: 0 },
      { x: e / 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const n = normalizePolygon(pts, true)
    expect(n.ok).toBe(true)
    expect(n.polygon.points.length).toBeGreaterThanOrEqual(3)
  })

  it('26. nearly collinear edges', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 1e-9 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const issues = validateGeometry(pts)
    const n = normalizePolygon(pts, true)
    expect(n.ok).toBe(true)
    expect(issues.every((i) => i.code !== 'nan')).toBe(true)
  })

  it('27. floating point boundary + tolerance config', () => {
    configureGeometryTolerance({ epsilonMm: 1e-6 })
    expect(geomEps()).toBe(1e-6)
    const a = rect(10, 10, 0, 0)
    const b = rect(10, 10, 10 + 1e-8, 0)
    // nearly touching / micro-gap within eps after restore
    configureGeometryTolerance({ epsilonMm: 1e-7 })
    expect(Number.isFinite(geomEps())).toBe(true)
    expect(solidsCollide(a, b, 0)).toBe(false)
  })
})
