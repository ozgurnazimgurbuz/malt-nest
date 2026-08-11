import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { parseSvg, shapeArea } from '../src/geometry'
import { createSheet } from '../src/placement'
import { nest } from '../src/nest'

const DEMO = '/Users/ozgurnazimgurbuz/Desktop/Demo.svg'

function report(label: string, r: ReturnType<typeof nest>) {
  const hits = r.diagnostics.cacheHits ?? 0
  const misses = r.diagnostics.cacheMisses ?? 0
  const row = {
    label,
    parts: r.placements.length + r.unplaced.length,
    sheets: r.metrics.sheetCount,
    placements: r.placements.length,
    unplaced: r.unplaced.length,
    utilization: Number(r.metrics.utilization.toFixed(4)),
    waste: Number(r.metrics.waste.toFixed(4)),
    packedBoundsMm2: Math.round(r.metrics.packedBoundsMm2),
    usedPartArea: Math.round(r.metrics.usedPartArea),
    runtimeMs: Math.round(r.runtimeMs),
    anglesEvaluated: r.diagnostics.anglesEvaluated ?? 0,
    nfpComputeCount: r.diagnostics.nfpComputeCount,
    cacheHits: hits,
    cacheMisses: misses,
    cacheHitRate: hits + misses > 0 ? Number((hits / (hits + misses)).toFixed(3)) : 0,
    candidateCount: r.diagnostics.candidateCount,
    rejectedCandidates: r.diagnostics.rejectedCandidates,
    baselineFloor: r.diagnostics.baselineFloorKept ?? null,
    rotations: r.placements.map((p) => ({
      id: p.shapeId,
      rot: p.rotationDeg,
      sheet: p.sheetIndex,
    })),
  }
  console.log(JSON.stringify(row, null, 2))
  return row
}

describe('Demo.svg orthogonal vs free-angle', () => {
  it.skipIf(!existsSync(DEMO))('compares baseline orthogonal and free cascade', () => {
    const { shapes } = parseSvg(readFileSync(DEMO, 'utf8'))
    expect(shapes.length).toBe(16)
    const sheet = createSheet(1600, 1000, 10)

    const ortho = nest(shapes, sheet, {
      gap: 5,
      ordering: 'area_desc',
      rotation: { kind: 'orthogonal' },
      maxSheets: 16,
    })
    const free = nest(shapes, sheet, {
      gap: 5,
      ordering: 'area_desc',
      rotation: {
        kind: 'free',
        free: {
          baselineFloor: true,
          coarseStepDeg: 15,
          refineStepDeg: 5,
          finalStepDeg: 1,
          coarseTopK: 3,
        },
      },
      maxSheets: 16,
    })

    const o = report('orthogonal', ortho)
    const f = report('free+floor', free)

    expect(o.placements + o.unplaced).toBe(16)
    expect(f.placements + f.unplaced).toBe(16)
    // Free+floor must not place fewer than orthogonal
    expect(f.placements).toBeGreaterThanOrEqual(o.placements)
    const areaSum = free.placements.reduce((s, p) => s + shapeArea(p.geometry), 0)
    expect(areaSum).toBeCloseTo(free.metrics.usedPartArea, 2)
  }, 600_000)
})
