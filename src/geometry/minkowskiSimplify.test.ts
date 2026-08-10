import { describe, expect, it } from 'vitest'
import { simplifyRingForMinkowski } from './backend/clipperAdapter'
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
})
