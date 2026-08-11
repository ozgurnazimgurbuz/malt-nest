import { describe, expect, it } from 'vitest'
import { absoluteArea } from '../src/geometry'
import { computeOuterNfp, normalizeNfp } from '../src/nfp'
import { rectShape } from '../src/nfp/oracle'

describe('NFP properties', () => {
  it('deterministic: same inputs → same bounds/area', () => {
    const A = rectShape('A', 10, 10)
    const B = rectShape('B', 3, 5)
    const a = computeOuterNfp(A, B, { gap: 2 })
    const b = computeOuterNfp(A, B, { gap: 2 })
    expect(a.bounds).toEqual(b.bounds)
    expect(absoluteArea(a.regions[0]!.outer)).toBeCloseTo(
      absoluteArea(b.regions[0]!.outer),
      9,
    )
  })

  it('normalize is idempotent', () => {
    const nfp = computeOuterNfp(rectShape('A', 8, 8), rectShape('B', 2, 2))
    const once = normalizeNfp(nfp)
    const twice = normalizeNfp(once)
    expect(once.bounds).toEqual(twice.bounds)
  })

  it('gap monotonic: larger gap ⇒ larger or equal forbidden area', () => {
    const A = rectShape('A', 12, 12)
    const B = rectShape('B', 4, 4)
    let prev = 0
    for (const g of [0, 1, 2, 5, 8]) {
      const area = absoluteArea(
        computeOuterNfp(A, B, { gap: g }).regions[0]!.outer,
      )
      expect(area).toBeGreaterThanOrEqual(prev - 1e-6)
      prev = area
    }
  })
})
