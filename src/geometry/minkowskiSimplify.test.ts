import { describe, expect, it } from 'vitest'
import {
  clipperInflate,
  clipperMinkowskiDiffNfp,
  pathsDToMultiPolygons,
  simplifyRingForMinkowski,
} from './backend/clipperAdapter'
import type { Point } from './types'

function distToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function maxDeviation(original: Point[], simplified: Point[]): number {
  let max = 0
  const m = simplified.length
  for (const p of original) {
    let best = Infinity
    for (let i = 0; i < m; i++) {
      const d = distToSeg(p, simplified[i]!, simplified[(i + 1) % m]!)
      if (d < best) best = d
    }
    if (best > max) max = best
  }
  return max
}

describe('simplifyRingForMinkowski', () => {
  it('preserves sub-centimeter Minkowski and offset coordinates', () => {
    const stationary = [
      { x: 0, y: 0 },
      { x: 10.004, y: 0 },
      { x: 10.004, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 10 },
      { x: 0, y: 10 },
    ]
    const moving = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]

    const nfp = clipperMinkowskiDiffNfp(stationary, moving, {
      fidelity: 'exact',
    })
    expect(
      nfp.paths.flat().some((point) => Math.abs(point.x - 10.004) < 1e-6),
    ).toBe(true)

    const offset = clipperInflate([stationary], 0.004)
    expect(Math.max(...offset.paths.flat().map((point) => point.x))).toBeCloseTo(
      10.008,
      6,
    )
  })

  it('assigns a concave hole to its actual containing component', () => {
    const square = [
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 10, y: 10 }, { x: 0, y: 10 },
    ]
    const outer = [
      { x: 20, y: 0 }, { x: 30, y: 0 },
      { x: 30, y: 10 }, { x: 28, y: 10 },
      { x: 28, y: 2 }, { x: 22, y: 2 },
      { x: 22, y: 10 }, { x: 20, y: 10 },
    ]
    const hole = [
      { x: 20.5, y: 0.5 }, { x: 29.5, y: 0.5 },
      { x: 29.5, y: 9.5 }, { x: 28.5, y: 9.5 },
      { x: 28.5, y: 1.5 }, { x: 21.5, y: 1.5 },
      { x: 21.5, y: 9.5 }, { x: 20.5, y: 9.5 },
    ].reverse()

    const regions = pathsDToMultiPolygons([square, outer, hole])

    expect(regions).toHaveLength(2)
    expect(regions[0]!.holes).toHaveLength(0)
    expect(regions[1]!.holes).toHaveLength(1)
  })

  it('keeps small rings intact', () => {
    const sq: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(simplifyRingForMinkowski(sq)).toHaveLength(4)
  })

  it('Hausdorff-to-edges ≤ eps on dense wobble ring', () => {
    const pts: Point[] = []
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2
      const w = 1 + 0.12 * Math.sin(a * 7)
      pts.push({ x: Math.cos(a) * 80 * w, y: Math.sin(a) * 80 * w })
    }
    const eps = 0.5
    const simp = simplifyRingForMinkowski(pts, eps)
    expect(simp.length).toBeLessThan(pts.length)
    expect(simp.length).toBeGreaterThanOrEqual(3)
    expect(maxDeviation(pts, simp)).toBeLessThanOrEqual(eps + 1e-6)
  })

  it('retains sub-0.5mm dense-ring features in exact Minkowski mode', () => {
    const dense: Point[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
    ]
    for (let i = 1; i < 40; i++) {
      dense.push({
        x: 20 - i * 0.5,
        y: 10 + (i % 2 === 0 ? 0.2 : 0),
      })
    }
    dense.push({ x: 0, y: 10 })
    const moving: Point[] = [
      { x: 0, y: 0 },
      { x: 0.1, y: 0 },
      { x: 0.1, y: 0.1 },
      { x: 0, y: 0.1 },
    ]

    const simplified = clipperMinkowskiDiffNfp(dense, moving)
    const exact = clipperMinkowskiDiffNfp(dense, moving, {
      fidelity: 'exact',
    })
    const vertexCount = (paths: typeof exact.paths) =>
      paths.reduce((total, path) => total + path.length, 0)

    expect(vertexCount(exact.paths)).toBeGreaterThan(
      vertexCount(simplified.paths),
    )
  })
})
