import { describe, expect, it } from 'vitest'
import {
  booleanHasArea,
  computeNfp,
  difference,
  intersection,
  normalizePolygon,
  offsetPolygon,
  offsetSolid,
  partRotationOrigin,
  polygonContainsPolygon,
  rotatePoints,
  solidFromRings,
  solidInsideHole,
  solidInsideSheet,
  solidsCollide,
  solidsOverlap,
  translateSolid,
  union,
  xor,
  canFitInHole,
  translationInNfp,
} from './index'

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

function L() {
  return solidFromRings(
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 12 },
      { x: 12, y: 12 },
      { x: 12, y: 40 },
      { x: 0, y: 40 },
    ],
    [],
  )
}

function C() {
  return solidFromRings(
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 12 },
      { x: 12, y: 12 },
      { x: 12, y: 28 },
      { x: 40, y: 28 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ],
    [],
  )
}

function U() {
  return solidFromRings(
    [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 28 },
      { x: 28, y: 28 },
      { x: 28, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ],
    [],
  )
}

function star() {
  const pts = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 20 : 8
    const a = (Math.PI / 2) + (i * Math.PI) / 5
    pts.push({ x: 20 + r * Math.cos(a), y: 20 + r * Math.sin(a) })
  }
  return solidFromRings(pts, [])
}

function donut() {
  return solidFromRings(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    [
      [
        { x: 25, y: 25 },
        { x: 25, y: 75 },
        { x: 75, y: 75 },
        { x: 75, y: 25 },
      ],
    ],
  )
}

function multiHole() {
  return solidFromRings(
    [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 80 },
      { x: 0, y: 80 },
    ],
    [
      [
        { x: 10, y: 10 },
        { x: 10, y: 35 },
        { x: 35, y: 35 },
        { x: 35, y: 10 },
      ],
      [
        { x: 70, y: 20 },
        { x: 70, y: 60 },
        { x: 110, y: 60 },
        { x: 110, y: 20 },
      ],
    ],
  )
}

describe('Stage 7 — boolean ops', () => {
  it('union contains overlapping rectangles', () => {
    const a = rect(10, 10)
    const b = rect(10, 10, 5, 5)
    const u = union(a, b)
    expect(u.ok).toBe(true)
    expect(booleanHasArea(u)).toBe(true)
    expect(u.polygons.length).toBeGreaterThanOrEqual(1)
  })

  it('difference removes overlap', () => {
    const a = rect(20, 20)
    const b = rect(10, 10, 5, 5)
    const d = difference(a, b)
    expect(d.ok).toBe(true)
    expect(booleanHasArea(d)).toBe(true)
  })

  it('intersection of disjoint is empty', () => {
    const a = rect(10, 10)
    const b = rect(10, 10, 20, 0)
    const i = intersection(a, b)
    expect(booleanHasArea(i)).toBe(false)
  })

  it('xor of overlap has area', () => {
    const a = rect(10, 10)
    const b = rect(10, 10, 5, 0)
    const x = xor(a, b)
    expect(booleanHasArea(x)).toBe(true)
  })

  it('concave union', () => {
    const u = union(L(), rect(8, 8, 20, 20))
    expect(u.ok).toBe(true)
  })
})

describe('Stage 7 — Clipper offset', () => {
  it('positive offset expands', () => {
    const r = offsetPolygon(rect(20, 20).outer, 3)
    expect(r.backend).toBe('clipper')
    expect(r.polygon.points.length).toBeGreaterThanOrEqual(3)
    const xs = r.polygon.points.map((p) => p.x)
    expect(Math.min(...xs)).toBeLessThan(-2)
  })

  it('negative offset shrinks', () => {
    const r = offsetPolygon(rect(30, 30).outer, -4)
    expect(r.polygon.points.length).toBeGreaterThanOrEqual(3)
    const xs = r.polygon.points.map((p) => p.x)
    expect(Math.min(...xs)).toBeGreaterThan(3)
  })

  it('concave C offset', () => {
    const r = offsetPolygon(C().outer, 2)
    expect(r.polygon.points.length).toBeGreaterThanOrEqual(3)
  })

  it('solid with hole offset', () => {
    const off = offsetSolid(donut(), 2)
    expect(off.solid.outer.points.length).toBeGreaterThanOrEqual(3)
    expect(off.solid.holes.length).toBeGreaterThanOrEqual(1)
  })
})

describe('Stage 7 — NFP topology', () => {
  it('rectangle vs rectangle exact', () => {
    const nfp = computeNfp(rect(10, 10), rect(2, 2), 0)
    expect(nfp.exact).toBe(true)
    expect(nfp.regions.length).toBe(1)
  })

  it('triangle vs rectangle', () => {
    const t = solidFromRings(
      [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 6, y: 10 },
      ],
      [],
    )
    const nfp = computeNfp(rect(20, 20), t, 0)
    expect(nfp.regions.length).toBeGreaterThanOrEqual(1)
  })

  it('L shape NFP via clipper', () => {
    const nfp = computeNfp(L(), rect(5, 5), 0)
    expect(nfp.method).toBe('minkowski-clipper')
    expect(nfp.exact).toBe(false)
    expect(nfp.regions.length).toBeGreaterThanOrEqual(1)
  })

  it('C shape NFP', () => {
    const nfp = computeNfp(C(), rect(4, 4), 0)
    expect(nfp.regions.length).toBeGreaterThanOrEqual(1)
  })

  it('U shape NFP', () => {
    const nfp = computeNfp(U(), rect(4, 4), 0)
    expect(nfp.regions.length).toBeGreaterThanOrEqual(1)
  })

  it('star NFP', () => {
    const nfp = computeNfp(star(), rect(3, 3), 0)
    expect(nfp.regions.length).toBeGreaterThanOrEqual(1)
  })

  it('donut NFP uses outer', () => {
    const nfp = computeNfp(donut(), rect(5, 5), 0)
    expect(nfp.regions.length).toBeGreaterThanOrEqual(1)
  })

  it('multiple-hole part NFP', () => {
    const nfp = computeNfp(multiHole(), rect(4, 4), 0)
    expect(nfp.regions.length).toBeGreaterThanOrEqual(1)
  })

  it('rotated concave NFP', () => {
    const origin = partRotationOrigin(L().outer.points)
    const pts = rotatePoints(L().outer.points, 90, origin)
    const nfp = computeNfp(solidFromRings(pts, []), rect(5, 5), 0)
    expect(nfp.regions.length).toBeGreaterThanOrEqual(1)
  })

  it('spacing enlarges NFP', () => {
    const a0 = computeNfp(rect(10, 10), rect(2, 2), 0)
    const a5 = computeNfp(rect(10, 10), rect(2, 2), 5)
    const area = (n: typeof a0) =>
      n.outers.reduce(
        (s, o) =>
          s +
          Math.abs(
            o.points.reduce((acc, p, i, arr) => {
              const q = arr[(i + 1) % arr.length]!
              return acc + (p.x * q.y - q.x * p.y)
            }, 0) / 2,
          ),
        0,
      )
    expect(area(a5)).toBeGreaterThan(area(a0))
  })
})

describe('Stage 7 — hole regressions', () => {
  it('accepts contained concave polygons whose centroid lies in their void', () => {
    const container = {
      points: [
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
        { x: 7, y: 10 }, { x: 7, y: 3 }, { x: 3, y: 3 },
        { x: 3, y: 10 }, { x: 0, y: 10 },
      ],
    }
    const inner = {
      points: [
        { x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 },
        { x: 8, y: 9 }, { x: 8, y: 2 }, { x: 2, y: 2 },
        { x: 2, y: 9 }, { x: 1, y: 9 },
      ],
    }

    expect(polygonContainsPolygon(container, inner)).toBe(true)
  })

  it('1. part fully inside hole — no solid overlap', () => {
    const host = donut()
    const guest = rect(20, 20, 40, 40)
    expect(solidsOverlap(host, guest)).toBe(false)
    expect(solidInsideHole(guest, host.holes[0]!)).toBe(true)
  })

  it('2. part touching hole boundary', () => {
    const host = donut()
    const guest = rect(50, 50, 25, 25) // fills hole exactly
    // touching/contained — must not report as solid overlap if entirely in hole
    expect(solidsOverlap(host, guest)).toBe(false)
  })

  it('3. spacing violation from hole', () => {
    const host = donut()
    const guest = rect(48, 48) // hole 50×50; spacing 2 → reject
    const fit = canFitInHole(host, guest, 0, 2)
    expect(fit.fits).toBe(false)
  })

  it('4. part intersecting solid', () => {
    const host = donut()
    const guest = rect(30, 30, 10, 10)
    expect(solidsOverlap(host, guest)).toBe(true)
  })

  it('5. part too large for hole', () => {
    const fit = canFitInHole(donut(), rect(60, 60), 0, 0)
    expect(fit.fits).toBe(false)
  })
})

describe('Stage 7 — property invariants', () => {
  it('overlap ⇒ collide', () => {
    const a = rect(10, 10)
    const b = rect(10, 10, 4, 4)
    expect(solidsOverlap(a, b)).toBe(true)
    expect(solidsCollide(a, b, 0)).toBe(true)
  })

  it('separated ⇒ no collide', () => {
    const a = rect(10, 10)
    const b = rect(10, 10, 20, 0)
    expect(solidsCollide(a, b, 0)).toBe(false)
  })

  it('increasing spacing does not shrink NFP area', () => {
    const areas = [0, 2, 5].map((s) => {
      const n = computeNfp(rect(10, 10), rect(3, 3), s)
      return n.outers.reduce(
        (sum, o) =>
          sum +
          Math.abs(
            o.points.reduce((acc, p, i, arr) => {
              const q = arr[(i + 1) % arr.length]!
              return acc + (p.x * q.y - q.x * p.y)
            }, 0) / 2,
          ),
        0,
      )
    })
    expect(areas[1]!).toBeGreaterThanOrEqual(areas[0]! - 1e-6)
    expect(areas[2]!).toBeGreaterThanOrEqual(areas[1]! - 1e-6)
  })

  it('translate preserves shape area', () => {
    const a = L()
    const t = translateSolid(a, 12.5, -3.25)
    const area = (s: typeof a) =>
      Math.abs(
        s.outer.points.reduce((acc, p, i, arr) => {
          const q = arr[(i + 1) % arr.length]!
          return acc + (p.x * q.y - q.x * p.y)
        }, 0) / 2,
      )
    expect(Math.abs(area(a) - area(t))).toBeLessThan(1e-6)
  })

  it('rotate + inverse ≈ identity', () => {
    const origin = partRotationOrigin(L().outer.points)
    const r = rotatePoints(L().outer.points, 37, origin)
    const back = rotatePoints(r, -37, origin)
    for (let i = 0; i < L().outer.points.length; i++) {
      expect(Math.abs(back[i]!.x - L().outer.points[i]!.x)).toBeLessThan(1e-6)
      expect(Math.abs(back[i]!.y - L().outer.points[i]!.y)).toBeLessThan(1e-6)
    }
  })

  it('union area ≥ max input area', () => {
    const a = rect(10, 10)
    const b = rect(10, 10, 5, 0)
    const u = union(a, b)
    const ua = u.polygons.reduce(
      (s, mp) =>
        s +
        Math.abs(
          mp.outer.points.reduce((acc, p, i, arr) => {
            const q = arr[(i + 1) % arr.length]!
            return acc + (p.x * q.y - q.x * p.y)
          }, 0) / 2,
        ),
      0,
    )
    expect(ua).toBeGreaterThanOrEqual(100 - 1e-3)
  })

  it('difference does not contain removed interior sample', () => {
    const a = rect(20, 20)
    const b = rect(6, 6, 7, 7)
    const d = difference(a, b)
    expect(d.ok).toBe(true)
    const center = { x: 10, y: 10 }
    const inDiff = d.polygons.some((mp) => {
      let inside = false
      const ring = mp.outer.points
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const pi = ring[i]!
        const pj = ring[j]!
        const inter =
          pi.y > center.y !== pj.y > center.y &&
          center.x <
            ((pj.x - pi.x) * (center.y - pi.y)) / (pj.y - pi.y + 1e-30) + pi.x
        if (inter) inside = !inside
      }
      if (!inside) return false
      for (const h of mp.holes) {
        let inH = false
        for (let i = 0, j = h.points.length - 1; i < h.points.length; j = i++) {
          const pi = h.points[i]!
          const pj = h.points[j]!
          const inter =
            pi.y > center.y !== pj.y > center.y &&
            center.x <
              ((pj.x - pi.x) * (center.y - pi.y)) / (pj.y - pi.y + 1e-30) +
                pi.x
          if (inter) inH = !inH
        }
        if (inH) return false
      }
      return true
    })
    expect(inDiff).toBe(false)
  })

  it('contained part stays inside after small translate within sheet', () => {
    const p = translateSolid(rect(20, 20), 30, 30)
    expect(solidInsideSheet(p, 200, 200, 5)).toBe(true)
    expect(solidInsideSheet(translateSolid(p, 1, 1), 200, 200, 5)).toBe(true)
  })

  it('NFP origin translation is forbidden for overlapping locals', () => {
    const nfp = computeNfp(rect(10, 10), rect(10, 10), 0)
    expect(translationInNfp({ x: 0, y: 0 }, nfp)).toBe(true)
  })

  it('normalize drops duplicates', () => {
    const n = normalizePolygon(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
        { x: 0, y: 5 },
      ],
      true,
    )
    expect(n.ok).toBe(true)
    expect(n.polygon.points.length).toBe(4)
  })
})
