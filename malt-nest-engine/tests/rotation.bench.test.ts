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
  return Array.from({ length: n }, (_, i) =>
    rect(`p${i}`, 4 + (i % 5), 3 + (i % 7)),
  )
}

describe('rotation microbench', () => {
  it('orthogonal vs free coarse vs full cascade', () => {
    const sheet = createSheet(120, 120, 2)
    const parts = mixed(8)
    const rows = []

    const ortho = nest(parts, sheet, {
      gap: 1,
      rotation: { kind: 'orthogonal' },
      maxSheets: 8,
    })
    rows.push(row('orthogonal', ortho))

    const coarse = nest(parts, sheet, {
      gap: 1,
      rotation: {
        kind: 'free',
        free: {
          baselineFloor: false,
          coarseStepDeg: 15,
          refineStepDeg: 15,
          finalStepDeg: 15,
          coarseTopK: 1,
          diversityCount: 0,
        },
      },
      maxSheets: 8,
    })
    rows.push(row('free-coarse-only', coarse))

    const refine = nest(parts, sheet, {
      gap: 1,
      rotation: {
        kind: 'free',
        free: {
          baselineFloor: false,
          coarseStepDeg: 15,
          refineStepDeg: 5,
          finalStepDeg: 5,
          coarseTopK: 3,
        },
      },
      maxSheets: 8,
    })
    rows.push(row('free-coarse+refine', refine))

    const full = nest(parts, sheet, {
      gap: 1,
      rotation: {
        kind: 'free',
        free: {
          baselineFloor: false,
          coarseStepDeg: 15,
          refineStepDeg: 5,
          coarseTopK: 3,
        },
      },
      maxSheets: 8,
    })
    rows.push(row('free-full-default-0.1deg', full))

    console.log(JSON.stringify(rows, null, 2))
    expect(rows.length).toBe(4)
  }, 300_000)
})

function row(label: string, r: ReturnType<typeof nest>) {
  const hits = r.diagnostics.cacheHits ?? 0
  const misses = r.diagnostics.cacheMisses ?? 0
  return {
    label,
    runtimeMs: Number(r.runtimeMs.toFixed(1)),
    placed: r.placements.length,
    sheets: r.metrics.sheetCount,
    packedBoundsMm2: Math.round(r.metrics.packedBoundsMm2),
    anglesEvaluated: r.diagnostics.anglesEvaluated ?? 0,
    nfpComputeCount: r.diagnostics.nfpComputeCount,
    cacheHits: hits,
    cacheMisses: misses,
    candidateCount: r.diagnostics.candidateCount,
  }
}
