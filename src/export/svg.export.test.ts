import { describe, expect, it } from 'vitest'
import {
  buildZip,
  exportNestingToSvg,
  sanitizeBaseName,
  sheetFileName,
  validateNestExport,
  verifyExportConsistency,
} from './index'
import type { GeometryPart } from '../geometry'
import { boundingBox, centroid, netArea } from '../geometry'
import { applyPlacement } from '../nesting/placement/worldGeometry'
import type { NestingSuccess, Placement } from '../nesting'
import { runBottomLeftNest } from '../nesting/placement/blf'

function makePart(
  id: string,
  index: number,
  outer: { x: number; y: number }[],
  holes: { x: number; y: number }[][] = [],
): GeometryPart {
  const o = { points: outer }
  const h = holes.map((pts) => ({ points: pts }))
  return {
    id,
    sourceElement: 'path',
    originalIndex: index,
    sourceId: null,
    outer: o,
    holes: h,
    boundingBox: boundingBox(outer),
    area: netArea(o, h),
    centroid: centroid(outer),
    originalTransform: null,
  }
}

function rect(id: string, index: number, w: number, h: number) {
  return makePart(id, index, [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ])
}

function L(id: string, index: number) {
  return makePart(id, index, [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 12 },
    { x: 12, y: 12 },
    { x: 12, y: 40 },
    { x: 0, y: 40 },
  ])
}

function success(
  parts: GeometryPart[],
  placements: Placement[],
  sheets: NestingSuccess['sheets'],
): NestingSuccess {
  const countedSheets = sheets.map((value) => ({
    ...value,
    placedCount: placements.filter(
      (placement) => placement.sheetIndex === value.sheetIndex,
    ).length,
  }))
  return {
    status: 'ok',
    placements,
    sheets: countedSheets,
    unplacedPartIds: [],
    utilization: 0.1,
    wasteMm2: 0,
    calculationTimeMs: 1,
    statistics: {
      partCount: parts.length,
      placedCount: placements.length,
      unplacedCount: 0,
      sheetCountUsed: countedSheets.length,
      totalPartAreaMm2: parts.reduce((a, p) => a + p.area, 0),
      totalSheetAreaMm2: sheets.reduce((a, s) => a + s.widthMm * s.heightMm, 0),
      overallUtilization: 0.1,
      overallWasteMm2: 0,
    },
    engineId: 'test',
  }
}

function sheet(i: number, w = 200, h = 150) {
  return {
    sheetIndex: i,
    widthMm: w,
    heightMm: h,
    placedCount: 0,
    utilization: 0,
    wasteMm2: 0,
    usedBounds: null,
  }
}

describe('Stage 8 — SVG export', () => {
  it('1. single rectangle', () => {
    const parts = [rect('a', 0, 20, 10)]
    const result = success(
      parts,
      [{ partId: 'a', sheetIndex: 0, x: 5, y: 5, rotation: 0 }],
      [sheet(0)],
    )
    const out = exportNestingToSvg(result, parts, {
      sourceFileName: 'rect.svg',
      timestamp: '2026-01-01T00:00:00.000Z',
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.sheets[0]!.svg).toContain('width="200mm"')
    expect(out.sheets[0]!.svg).toContain('height="150mm"')
    expect(out.sheets[0]!.svg).toContain('data-part-id="a"')
    expect(out.sheets[0]!.svg).toContain('viewBox="0 0 200 150"')
  })

  it('2. multiple rectangles', () => {
    const parts = [rect('a', 0, 10, 10), rect('b', 1, 12, 8)]
    const result = success(
      parts,
      [
        { partId: 'a', sheetIndex: 0, x: 0, y: 0, rotation: 0 },
        { partId: 'b', sheetIndex: 0, x: 20, y: 0, rotation: 0 },
      ],
      [sheet(0)],
    )
    const out = exportNestingToSvg(result, parts)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.sheets[0]!.svg.match(/data-part-id=/g)?.length).toBe(2)
  })

  it('3. irregular path (letter-like)', () => {
    const parts = [
      makePart('E', 0, [
        { x: 0, y: 0 },
        { x: 28, y: 0 },
        { x: 28, y: 8 },
        { x: 10, y: 8 },
        { x: 10, y: 40 },
        { x: 0, y: 40 },
      ]),
    ]
    const result = success(
      parts,
      [{ partId: 'E', sheetIndex: 0, x: 10, y: 10, rotation: 0 }],
      [sheet(0)],
    )
    const out = exportNestingToSvg(result, parts)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.sheets[0]!.svg).toContain('M ')
    expect(out.sheets[0]!.svg).toContain('Z')
  })

  it('4. concave L part', () => {
    const parts = [L('L0', 0)]
    const result = success(
      parts,
      [{ partId: 'L0', sheetIndex: 0, x: 2, y: 3, rotation: 0 }],
      [sheet(0)],
    )
    const out = exportNestingToSvg(result, parts)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.sheets[0]!.svg).toContain('data-part-id="L0"')
  })

  it('5. hole', () => {
    const parts = [
      makePart(
        'donut',
        0,
        [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 50 },
          { x: 0, y: 50 },
        ],
        [
          [
            { x: 15, y: 15 },
            { x: 15, y: 35 },
            { x: 35, y: 35 },
            { x: 35, y: 15 },
          ],
        ],
      ),
    ]
    const result = success(
      parts,
      [{ partId: 'donut', sheetIndex: 0, x: 5, y: 5, rotation: 0 }],
      [sheet(0)],
    )
    const out = exportNestingToSvg(result, parts)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // compound path: outer + hole → at least two Z closes
    expect((out.sheets[0]!.svg.match(/ Z/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(out.sheets[0]!.svg).toContain('fill-rule="evenodd"')
  })

  it('6. multiple holes', () => {
    const parts = [
      makePart(
        'mh',
        0,
        [
          { x: 0, y: 0 },
          { x: 80, y: 0 },
          { x: 80, y: 50 },
          { x: 0, y: 50 },
        ],
        [
          [
            { x: 5, y: 5 },
            { x: 5, y: 20 },
            { x: 20, y: 20 },
            { x: 20, y: 5 },
          ],
          [
            { x: 40, y: 10 },
            { x: 40, y: 30 },
            { x: 60, y: 30 },
            { x: 60, y: 10 },
          ],
        ],
      ),
    ]
    const result = success(
      parts,
      [{ partId: 'mh', sheetIndex: 0, x: 0, y: 0, rotation: 0 }],
      [sheet(0)],
    )
    const out = exportNestingToSvg(result, parts)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect((out.sheets[0]!.svg.match(/ Z/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  for (const rot of [0, 90, 180, 270] as const) {
    it(`${7 + rot / 90}. ${rot}° rotation (asymmetric L)`, () => {
      const parts = [L('Lrot', 0)]
      const pl: Placement = {
        partId: 'Lrot',
        sheetIndex: 0,
        x: 20,
        y: 15,
        rotation: rot,
      }
      const result = success(parts, [pl], [sheet(0)])
      const out = exportNestingToSvg(result, parts)
      expect(out.ok).toBe(true)
      if (!out.ok) return
      expect(out.sheets[0]!.svg).toContain(`data-rotation="${rot}"`)
      const placed = applyPlacement(parts[0]!, pl)
      const sample = placed.outer[0]!
      const rx = Math.round(sample.x * 1e6) / 1e6
      const ry = Math.round(sample.y * 1e6) / 1e6
      expect(out.sheets[0]!.svg).toContain(String(rx))
      expect(out.sheets[0]!.svg).toContain(String(ry))
    })
  }

  it('11. multiple sheets → one SVG each', () => {
    const parts = [rect('a', 0, 30, 20), rect('b', 1, 30, 20)]
    const result = success(
      parts,
      [
        { partId: 'a', sheetIndex: 0, x: 0, y: 0, rotation: 0 },
        { partId: 'b', sheetIndex: 1, x: 0, y: 0, rotation: 0 },
      ],
      [sheet(0), sheet(1)],
    )
    const out = exportNestingToSvg(result, parts, {
      sourceFileName: 'signage.svg',
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.sheets).toHaveLength(2)
    expect(out.sheets[0]!.fileName).toBe('signage-nested-01.svg')
    expect(out.sheets[1]!.fileName).toBe('signage-nested-02.svg')
    expect(out.sheets[0]!.svg).toContain('data-part-id="a"')
    expect(out.sheets[0]!.svg).not.toContain('data-part-id="b"')
    expect(out.sheets[1]!.svg).toContain('data-part-id="b"')
  })

  it('12. filename sanitization', () => {
    expect(sanitizeBaseName('signage.svg')).toBe('signage')
    expect(sheetFileName('signage.svg', 0)).toBe('signage-nested-01.svg')
    expect(sheetFileName('foo bar/*.svg', 0)).toMatch(/nested-01\.svg$/)
    expect(sheetFileName('../../../etc/passwd.svg', 2)).toBe(
      'etc-passwd-nested-03.svg',
    )
  })

  it('13. invalid geometry rejected', () => {
    const parts = [rect('a', 0, 10, 10)]
    const result = success(
      parts,
      [{ partId: 'a', sheetIndex: 0, x: Number.NaN, y: 0, rotation: 0 }],
      [sheet(0)],
    )
    const v = validateNestExport(result, parts)
    expect(v.ok).toBe(false)
    const out = exportNestingToSvg(result, parts)
    expect(out.ok).toBe(false)
  })

  it('14. part ID preservation', () => {
    const parts = [rect('custom-id-42', 0, 10, 10)]
    const result = success(
      parts,
      [{ partId: 'custom-id-42', sheetIndex: 0, x: 1, y: 2, rotation: 0 }],
      [sheet(0)],
    )
    const out = exportNestingToSvg(result, parts)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.sheets[0]!.svg).toContain('data-part-id="custom-id-42"')
  })

  it('15. transform preservation', () => {
    const parts = [L('L1', 0)]
    const pl = { partId: 'L1', sheetIndex: 0, x: 11.5, y: 7.25, rotation: 90 }
    const result = success(parts, [pl], [sheet(0)])
    const out = exportNestingToSvg(result, parts)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.sheets[0]!.svg).toContain('data-x="11.5"')
    expect(out.sheets[0]!.svg).toContain('data-y="7.25"')
    expect(out.sheets[0]!.svg).toContain('data-rotation="90"')
  })

  it('16. sheet dimensions', () => {
    const parts = [rect('a', 0, 10, 10)]
    const result = success(
      parts,
      [{ partId: 'a', sheetIndex: 0, x: 0, y: 0, rotation: 0 }],
      [sheet(0, 2050, 3050)],
    )
    const out = exportNestingToSvg(result, parts)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.sheets[0]!.widthMm).toBe(2050)
    expect(out.sheets[0]!.heightMm).toBe(3050)
    expect(out.sheets[0]!.svg).toContain('width="2050mm"')
    expect(out.sheets[0]!.svg).toContain('height="3050mm"')
  })

  it('17. exported geometry bounding box matches placement', () => {
    const parts = [L('L2', 0)]
    const pl = { partId: 'L2', sheetIndex: 0, x: 8, y: 9, rotation: 180 }
    const result = success(parts, [pl], [sheet(0)])
    const consistency = verifyExportConsistency(result, parts)
    expect(consistency.ok).toBe(true)
    const placed = applyPlacement(parts[0]!, pl)
    const xs = placed.outer.map((p) => p.x)
    const ys = placed.outer.map((p) => p.y)
    const b = consistency.placements[0]!.bbox
    expect(b.minX).toBeCloseTo(Math.min(...xs), 6)
    expect(b.maxX).toBeCloseTo(Math.max(...xs), 6)
    expect(b.minY).toBeCloseTo(Math.min(...ys), 6)
    expect(b.maxY).toBeCloseTo(Math.max(...ys), 6)
  })

  it('18. NestPreview/export consistency (shared applyPlacement)', () => {
    const parts = [L('Lx', 0), rect('r', 1, 15, 10)]
    const request = {
      parts,
      sheets: [{ widthMm: 300, heightMm: 200, marginMm: 5, quantity: 2 }],
      settings: {
        spacingMm: 2,
        allowedRotations: [0, 90, 180, 270],
        allowArbitraryRotation: false,
        seed: 1,
        allowPartInPart: false,
      },
    }
    const nest = runBottomLeftNest(request)
    expect(nest.status).toBe('ok')
    if (nest.status !== 'ok') return
    const consistency = verifyExportConsistency(nest, parts)
    expect(consistency.ok).toBe(true)
    expect(consistency.placementCount).toBe(nest.placements.length)
    const out = exportNestingToSvg(nest, parts, { sourceFileName: 'job.svg' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    for (const pl of nest.placements) {
      const sheet = out.sheets.find((s) => s.sheetIndex === pl.sheetIndex)
      expect(sheet).toBeTruthy()
      expect(sheet!.svg).toContain(`data-part-id="${pl.partId}"`)
      const placed = applyPlacement(parts.find((p) => p.id === pl.partId)!, pl)
      const rx = Math.round(placed.outer[0]!.x * 1e6) / 1e6
      expect(sheet!.svg).toContain(String(rx))
    }
  })

  it('sheet boundary is marked non-cut', () => {
    const parts = [rect('a', 0, 10, 10)]
    const result = success(
      parts,
      [{ partId: 'a', sheetIndex: 0, x: 0, y: 0, rotation: 0 }],
      [sheet(0)],
    )
    const out = exportNestingToSvg(result, parts)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.sheets[0]!.svg).toContain('id="sheet"')
    expect(out.sheets[0]!.svg).toContain('data-cut="false"')
  })

  it('ZIP packs multiple SVG entries', () => {
    const zip = buildZip([
      { name: 'a.svg', data: '<svg/>' },
      { name: 'b.svg', data: '<svg/>' },
    ])
    expect(zip.length).toBeGreaterThan(40)
    // Local file header signature
    expect(zip[0]).toBe(0x50)
    expect(zip[1]).toBe(0x4b)
  })

  it('missing part fails validation', () => {
    const parts = [rect('a', 0, 10, 10)]
    const result = success(
      parts,
      [{ partId: 'missing', sheetIndex: 0, x: 0, y: 0, rotation: 0 }],
      [sheet(0)],
    )
    expect(validateNestExport(result, parts).ok).toBe(false)
  })

  it('rejects placements on an unknown or invalid sheet index', () => {
    const parts = [rect('a', 0, 10, 10)]
    const unknown = success(
      parts,
      [{ partId: 'a', sheetIndex: 2, x: 0, y: 0, rotation: 0 }],
      [sheet(0)],
    )
    const fractional = success(
      parts,
      [{ partId: 'a', sheetIndex: 0.5, x: 0, y: 0, rotation: 0 }],
      [sheet(0)],
    )

    expect(validateNestExport(unknown, parts).ok).toBe(false)
    expect(validateNestExport(fractional, parts).ok).toBe(false)
  })

  it('rejects duplicate sheet IDs and duplicate placements by part ID', () => {
    const parts = [rect('a', 0, 10, 10)]
    const duplicateSheet = success(
      parts,
      [{ partId: 'a', sheetIndex: 0, x: 0, y: 0, rotation: 0 }],
      [sheet(0), sheet(0)],
    )
    const duplicatePart = success(
      parts,
      [
        { partId: 'a', sheetIndex: 0, x: 0, y: 0, rotation: 0 },
        { partId: 'a', sheetIndex: 0, x: 20, y: 0, rotation: 0 },
      ],
      [sheet(0)],
    )

    expect(validateNestExport(duplicateSheet, parts).ok).toBe(false)
    expect(validateNestExport(duplicatePart, parts).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate_placement' }),
      ]),
    )
  })

  it('rejects transformed geometry outside its declared sheet', () => {
    const parts = [rect('a', 0, 20, 20)]
    const result = success(
      parts,
      [{ partId: 'a', sheetIndex: 0, x: -1, y: 0, rotation: 0 }],
      [sheet(0, 10, 10)],
    )

    expect(validateNestExport(result, parts).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'out_of_bounds' }),
      ]),
    )
  })

  it('rejects inconsistent result and per-sheet placement counts', () => {
    const parts = [rect('a', 0, 10, 10)]
    const result = success(
      parts,
      [{ partId: 'a', sheetIndex: 0, x: 0, y: 0, rotation: 0 }],
      [sheet(0)],
    )
    result.statistics.placedCount = 0
    result.sheets[0]!.placedCount = 0

    expect(validateNestExport(result, parts).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'inconsistent_counts' }),
      ]),
    )
  })

  it('rejects aliased source IDs and a corrupt placed/unplaced partition', () => {
    const duplicateParts = [rect('a', 0, 10, 10), rect('a', 1, 12, 12)]
    const duplicateSource = success(
      duplicateParts,
      [{ partId: 'a', sheetIndex: 0, x: 0, y: 0, rotation: 0 }],
      [sheet(0)],
    )
    expect(validateNestExport(duplicateSource, duplicateParts).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate_part' }),
      ]),
    )

    const parts = [rect('a', 0, 10, 10), rect('b', 1, 10, 10)]
    const corruptPartition = success(
      parts,
      [{ partId: 'a', sheetIndex: 0, x: 0, y: 0, rotation: 0 }],
      [sheet(0)],
    )
    corruptPartition.unplacedPartIds = ['a']
    corruptPartition.statistics.unplacedCount = 1
    expect(validateNestExport(corruptPartition, parts).ok).toBe(false)
  })

  it('rejects positive-area overlap between distinct placements on one sheet', () => {
    const parts = [rect('a', 0, 20, 20), rect('b', 1, 20, 20)]
    const result = success(
      parts,
      [
        { partId: 'a', sheetIndex: 0, x: 10, y: 10, rotation: 0 },
        { partId: 'b', sheetIndex: 0, x: 10, y: 10, rotation: 0 },
      ],
      [sheet(0)],
    )

    expect(validateNestExport(result, parts).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'overlap' })]),
    )
    expect(exportNestingToSvg(result, parts).ok).toBe(false)
  })

  it('rejects malformed source rings before export', () => {
    const malformed = {
      ...rect('a', 0, 20, 20),
      outer: { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] },
    }
    const result = success(
      [malformed],
      [{ partId: 'a', sheetIndex: 0, x: 10, y: 10, rotation: 0 }],
      [sheet(0)],
    )

    expect(validateNestExport(result, [malformed]).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_geometry' }),
      ]),
    )
  })
})
