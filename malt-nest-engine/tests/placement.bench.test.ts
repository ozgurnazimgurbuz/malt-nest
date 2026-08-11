import { describe, expect, it } from 'vitest'
import { makeShape } from '../src/geometry'
import {
  collidePlacements,
  createPlacement,
  createSheet,
  validatePlacement,
} from '../src/placement'

const rect = (id: string) =>
  makeShape(id, [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ])

const sheet = createSheet(1600, 1000, 10)

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
      perOpUs: Number(((ms * 1000) / n).toFixed(3)),
    }),
  )
  return ms
}

describe('placement micro-benchmarks', () => {
  it('100 / 1000 validations + 10000 collision checks', () => {
    const base = createPlacement(rect('a'), { x: 400, y: 400 }, 0)
    const others = [base]

    bench('validate_100', 100, () => {
      const p = createPlacement(
        rect('b'),
        { x: 500, y: 400 },
        15,
      )
      validatePlacement(p, sheet, others, { gap: 5 })
    })

    bench('validate_1000', 1000, () => {
      const p = createPlacement(
        rect('b'),
        { x: 500, y: 400 },
        15,
      )
      validatePlacement(p, sheet, others, { gap: 5 })
    })

    const a = createPlacement(rect('a'), { x: 400, y: 400 }, 10)
    const b = createPlacement(rect('b'), { x: 430, y: 400 }, 10)
    bench('collide_10000', 10_000, () => {
      collidePlacements(a, b, 5)
    })

    expect(true).toBe(true)
  })
})
