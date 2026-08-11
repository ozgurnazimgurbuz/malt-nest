import { describe, expect, it } from 'vitest'
import { makeShape } from '../src/geometry'
import { createSheet } from '../src/placement'
import { nest } from '../src/nest'
import { optimizeMultiStart } from '../src/optimization'

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

describe('optimization microbench', () => {
  it('single ortho / five-order FAST / single free / multi-start full', () => {
    const sheet = createSheet(100, 100, 2)
    const parts = mixed(6)
    const rows = []

    const singleOrtho = nest(parts, sheet, {
      gap: 1,
      ordering: 'area_desc',
      rotation: { kind: 'orthogonal' },
      maxSheets: 6,
    })
    rows.push(row('single-ordering-orthogonal', singleOrtho.runtimeMs, {
      nfp: singleOrtho.diagnostics.nfpComputeCount,
      candidates: singleOrtho.diagnostics.candidateCount,
      hits: singleOrtho.diagnostics.cacheHits ?? 0,
      misses: singleOrtho.diagnostics.cacheMisses ?? 0,
    }))

    const fastSweep = optimizeMultiStart(parts, sheet, {
      gap: 1,
      maxSheets: 6,
      fullRotation: { kind: 'none' }, // minimize FULL cost; measure FAST path
    })
    rows.push(row('five-ordering-fast-sweep', fastSweep.diagnostics.fastTotalRuntimeMs, {
      nfp: fastSweep.fastCandidates.reduce((s, e) => s + e.nfpCount, 0),
      candidates: fastSweep.fastCandidates.reduce((s, e) => s + e.candidateCount, 0),
      hits: fastSweep.fastCandidates.reduce((s, e) => s + e.cacheHits, 0),
      misses: fastSweep.fastCandidates.reduce((s, e) => s + e.cacheMisses, 0),
    }))

    const singleFree = nest(parts, sheet, {
      gap: 1,
      ordering: 'area_desc',
      rotation: { kind: 'free', free: { baselineFloor: false } },
      maxSheets: 6,
    })
    rows.push(row('single-ordering-free', singleFree.runtimeMs, {
      nfp: singleFree.diagnostics.nfpComputeCount,
      candidates: singleFree.diagnostics.candidateCount,
      hits: singleFree.diagnostics.cacheHits ?? 0,
      misses: singleFree.diagnostics.cacheMisses ?? 0,
    }))

    const fullMs = optimizeMultiStart(parts, sheet, {
      gap: 1,
      maxSheets: 6,
    })
    rows.push(row('multi-start-full', fullMs.diagnostics.fastTotalRuntimeMs + fullMs.diagnostics.fullTotalRuntimeMs, {
      nfp: fullMs.diagnostics.totalNfp,
      candidates: fullMs.diagnostics.totalCandidates,
      hits: fullMs.diagnostics.totalCacheHits,
      misses: fullMs.diagnostics.totalCacheMisses,
    }))

    console.log(JSON.stringify(rows, null, 2))
    expect(rows.length).toBe(4)
  }, 300_000)
})

function row(
  label: string,
  runtimeMs: number,
  d: { nfp: number; candidates: number; hits: number; misses: number },
) {
  return {
    label,
    runtimeMs: Number(runtimeMs.toFixed(1)),
    nfpComputeCount: d.nfp,
    candidateCount: d.candidates,
    cacheHits: d.hits,
    cacheMisses: d.misses,
  }
}
