import { describe, expect, it } from 'vitest'
import { formatBackendBench, runBackendBenchmark } from './backendBenchmark'
import { formatBenchmark, runGeometryBenchmark } from './benchmark'

describe('Stage 7 backend + geometry benchmarks', () => {
  it('compares clipper vs custom paths', () => {
    const rows = runBackendBenchmark()
    expect(rows.length).toBeGreaterThanOrEqual(5)
    // eslint-disable-next-line no-console
    console.log('\n' + formatBackendBench(rows) + '\n')
  })

  it('geometry micro-benchmark still runs', () => {
    const rows = runGeometryBenchmark()
    expect(rows.length).toBeGreaterThanOrEqual(5)
    // eslint-disable-next-line no-console
    console.log('\n' + formatBenchmark(rows) + '\n')
  })
})
