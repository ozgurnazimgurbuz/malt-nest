import { describe, expect, it } from 'vitest'
import { formatBenchmark, runGeometryBenchmark } from './benchmark'

describe('geometry benchmark', () => {
  it('runs deterministic geometry benchmark', () => {
    const rows = runGeometryBenchmark()
    expect(rows.length).toBeGreaterThanOrEqual(5)
    for (const r of rows) {
      expect(r.ms).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(r.ms)).toBe(true)
    }
    // eslint-disable-next-line no-console
    console.log('\n' + formatBenchmark(rows) + '\n')
  })
})
