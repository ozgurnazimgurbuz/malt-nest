import { describe, expect, it } from 'vitest'
import { makeShape } from '../src/geometry'
import { createSheet } from '../src/placement'
import { nest } from '../src/nest'

function rect(id: string, w: number, h: number) {
  return makeShape(id, [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ])
}

function mixed(n: number) {
  const out = []
  for (let i = 0; i < n; i++) {
    const w = 4 + (i % 5)
    const h = 3 + (i % 7)
    out.push(rect(`p${i}`, w, h))
  }
  return out
}

describe('nest microbench', () => {
  it('reports runtime + counters for 4 / 16 / 32 / 64 parts', () => {
    const sheet = createSheet(200, 200, 2)
    const sizes = [4, 16, 32, 64]
    const rows: Record<string, unknown>[] = []

    for (const n of sizes) {
      const parts = mixed(n)
      const r = nest(parts, sheet, {
        gap: 1,
        ordering: 'area_desc',
        rotation: { kind: 'orthogonal' },
        maxSheets: n,
      })
      rows.push({
        n,
        runtimeMs: Number(r.runtimeMs.toFixed(2)),
        sheets: r.metrics.sheetCount,
        placed: r.placements.length,
        unplaced: r.unplaced.length,
        nfpComputeCount: r.diagnostics.nfpComputeCount,
        validationCount: r.diagnostics.validationCount,
        candidateCount: r.diagnostics.candidateCount,
        rejectedCandidates: r.diagnostics.rejectedCandidates,
      })
    }

    console.log(JSON.stringify(rows, null, 2))
    expect(rows.length).toBe(4)
    expect(rows.every((x) => (x.runtimeMs as number) >= 0)).toBe(true)
  }, 180_000)
})
