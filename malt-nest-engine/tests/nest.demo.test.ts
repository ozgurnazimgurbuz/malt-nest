import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { parseSvg, shapeArea } from '../src/geometry'
import { createSheet } from '../src/placement'
import { nest } from '../src/nest'

const DEMO = '/Users/ozgurnazimgurbuz/Desktop/Demo.svg'

describe('nest Demo.svg basic benchmark', () => {
  it('nests Demo parts on 1600×1000 gap=5 margin=10', () => {
    if (!existsSync(DEMO)) {
      // Skip silently if fixture not on this machine
      return
    }
    const raw = readFileSync(DEMO, 'utf8')
    const { shapes } = parseSvg(raw)
    expect(shapes.length).toBe(16)

    const sheet = createSheet(1600, 1000, 10)
    const result = nest(shapes, sheet, {
      gap: 5,
      ordering: 'area_desc',
      rotation: { kind: 'orthogonal' },
      maxSheets: 16,
      debug: true,
    })

    // Correctness over quality — report metrics
    console.log(
      JSON.stringify(
        {
          parts: shapes.length,
          sheets: result.metrics.sheetCount,
          placements: result.placements.length,
          unplaced: result.unplaced.length,
          unplacedReasons: result.unplaced,
          utilization: Number(result.metrics.utilization.toFixed(4)),
          packedBoundsMm2: Math.round(result.metrics.packedBoundsMm2),
          usedPartArea: Math.round(result.metrics.usedPartArea),
          runtimeMs: Math.round(result.runtimeMs),
          rotations: result.placements.map((p) => ({
            id: p.shapeId,
            rot: p.rotationDeg,
            sheet: p.sheetIndex,
          })),
          diagnostics: {
            nfp: result.diagnostics.nfpComputeCount,
            validations: result.diagnostics.validationCount,
            candidates: result.diagnostics.candidateCount,
            rejected: result.diagnostics.rejectedCandidates,
          },
          // legacy packed bounds reference (not a target): 780097
          legacyPackedBoundsRef: 780097,
        },
        null,
        2,
      ),
    )

    expect(result.placements.length + result.unplaced.length).toBe(16)
    expect(result.placements.length).toBeGreaterThan(0)
    const areaSum = result.placements.reduce(
      (s, p) => s + shapeArea(p.geometry),
      0,
    )
    expect(areaSum).toBeCloseTo(result.metrics.usedPartArea, 3)
  }, 120_000)
})
