import { describe, expect, it } from 'vitest'
import { formatFabBench, runFabBenchmark } from './fabFixtures'

describe('Stage 9 fabrication fixtures', () => {
  it('runs fabrication fixtures A–J; automatic never regresses from its exact seed', () => {
    const rows = runFabBenchmark()
    expect(rows.length).toBe(20) // 10 × BLF + automatic
    expect(new Set(rows.map(({ engine }) => engine))).toEqual(
      new Set(['blf', 'automatic']),
    )
    // eslint-disable-next-line no-console
    console.log('\n' + formatFabBench(rows) + '\n')

    const byId = new Map<string, { blf?: (typeof rows)[0]; automatic?: (typeof rows)[0] }>()
    for (const r of rows) {
      const e = byId.get(r.id) ?? {}
      if (r.engine === 'blf') e.blf = r
      else e.automatic = r
      byId.set(r.id, e)
    }
    for (const [, pair] of byId) {
      if (!pair.blf || !pair.automatic) continue
      expect(pair.automatic.canonicalVsSeed).not.toBeNull()
      expect(pair.automatic.canonicalVsSeed).toBeLessThanOrEqual(0)
    }
  }, 300_000)
})
