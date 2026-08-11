import { describe, expect, it } from 'vitest'
import { computeOuterNfp, computeInnerNfp } from '../src/nfp'
import { LShape, frameShape, rectShape, triangleShape } from '../src/nfp/oracle'

function bench(label: string, n: number, fn: () => void) {
  const t0 = performance.now()
  for (let i = 0; i < n; i++) fn()
  const ms = performance.now() - t0
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      label,
      n,
      ms: Number(ms.toFixed(2)),
      perOpUs: Number(((ms * 1000) / n).toFixed(2)),
    }),
  )
}

describe('NFP microbenchmark', () => {
  it('outer/inner NFP timings', () => {
    const A = rectShape('A', 100, 80)
    const B = rectShape('B', 20, 15)
    const L = LShape('L')
    const T = triangleShape('T')
    const F = frameShape('F')

    bench('outer_rect_rect_x200', 200, () => {
      computeOuterNfp(A, B, { gap: 5 })
    })
    bench('outer_L_L_x100', 100, () => {
      computeOuterNfp(L, L, { gap: 0 })
    })
    bench('outer_frame_rect_x100', 100, () => {
      computeOuterNfp(F, B, { gap: 0 })
    })
    bench('outer_rect_tri_x100', 100, () => {
      computeOuterNfp(A, T, { gap: 0 })
    })
    bench('inner_rect_x100', 100, () => {
      computeInnerNfp(A, B, { gap: 2 })
    })
    expect(true).toBe(true)
  })
})
