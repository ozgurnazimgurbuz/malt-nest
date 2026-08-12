import { describe, expect, it } from 'vitest'
import type { GeometryPart } from '../../geometry'
import {
  boundingBox,
  centroid,
  netArea,
  partRotationOrigin,
  rotatePoints,
  solidFromRings,
  solidsCollide,
  solidsOverlap,
} from '../../geometry'
import {
  beginBlfProfiling,
  endBlfProfiling,
  getBlfProfileSnapshot,
} from '../../geometry/debug/blfProfiler'
import {
  placeWithOrder,
  placeWithOrderUnchecked,
  placeWithPlan,
  placeWithPlanUnchecked,
  runBottomLeftNest,
} from './blf'
import type {
  NestAttempt,
  NestingRequest,
  NestingSettings,
  Placement,
} from '../types'
import { prepareParts } from '../core/prepare'

const baseSettings: NestingSettings = {
  spacingMm: 0,
  allowedRotations: [0],
  rotationStepDeg: null,
  allowArbitraryRotation: false,
}

function rectPart(
  id: string,
  index: number,
  x: number,
  y: number,
  w: number,
  h: number,
): GeometryPart {
  const points = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
  return {
    id,
    sourceElement: 'rect',
    originalIndex: index,
    sourceId: id,
    outer: { points },
    holes: [],
    boundingBox: boundingBox(points),
    area: w * h,
    centroid: { x: x + w / 2, y: y + h / 2 },
    originalTransform: null,
  }
}

function request(
  parts: GeometryPart[],
  opts?: {
    sheet?: { widthMm: number; heightMm: number; marginMm: number; quantity: number }
    settings?: Partial<NestingSettings>
  },
): NestingRequest {
  return {
    parts,
    sheets: [
      opts?.sheet ?? {
        widthMm: 100,
        heightMm: 100,
        marginMm: 0,
        quantity: 10,
      },
    ],
    settings: { ...baseSettings, ...opts?.settings },
  }
}

function worldSolid(part: GeometryPart, pl: Placement) {
  const origin = partRotationOrigin(part.outer.points)
  const outer = rotatePoints(part.outer.points, pl.rotation, origin).map((p) => ({
    x: p.x + pl.x,
    y: p.y + pl.y,
  }))
  const holes = part.holes.map((h) =>
    rotatePoints(h.points, pl.rotation, origin).map((p) => ({
      x: p.x + pl.x,
      y: p.y + pl.y,
    })),
  )
  return solidFromRings(outer, holes)
}

function denseContactFixture(stepped = false, denseCount = 117) {
  const outer = Array.from({ length: denseCount }, (_, index) => ({
    x: (20 * index) / (denseCount - 1),
    y: index % 2 === 0 ? 0 : 0.05,
  }))
  outer.push(
    { x: 20, y: 5 },
    { x: 20, y: 10 },
    { x: 15, y: 10 },
    { x: 12, y: 10 },
    { x: 10.4, y: 10 },
    ...(stepped
      ? [
          { x: 10.4, y: 9.8 },
          { x: 10.35, y: 9.8 },
        ]
      : []),
    { x: stepped ? 10.35 : 10.4, y: 9.6 },
    { x: 10, y: 9.6 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  )
  const host: GeometryPart = {
    id: 'dense-host',
    sourceElement: 'path',
    originalIndex: 0,
    sourceId: 'dense-host',
    outer: { points: outer },
    holes: [],
    boundingBox: boundingBox(outer),
    area: netArea({ points: outer }, []),
    centroid: centroid(outer),
    originalTransform: null,
  }
  const guest = rectPart('tiny', 1, 0, 0, 0.35, 0.35)
  return request([host, guest], {
    sheet: { widthMm: 20, heightMm: 10, marginMm: 0, quantity: 1 },
    settings: { allowedRotations: [0] },
  })
}

describe('runBottomLeftNest', () => {
  it('emits ordered candidate verdicts without changing the result', () => {
    const req = request(
      [
        rectPart('a', 0, 0, 0, 6, 6),
        rectPart('b', 1, 0, 0, 6, 6),
      ],
      {
        sheet: { widthMm: 10, heightMm: 10, marginMm: 0, quantity: 1 },
      },
    )
    const attempts: NestAttempt[] = []

    const traced = runBottomLeftNest(req, {
      onAttempt: (attempt) => attempts.push(attempt),
    })
    const plain = runBottomLeftNest(req)

    expect(attempts.length).toBeGreaterThan(0)
    expect(attempts.map(({ sequence }) => sequence)).toEqual(
      attempts.map((_, index) => index),
    )
    expect(attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          partId: 'a',
          sheetIndex: 0,
          rotation: 0,
          verdict: 'accepted',
        }),
        expect.objectContaining({ verdict: 'rejected' }),
      ]),
    )
    expect(traced.status).toBe('ok')
    expect(plain.status).toBe('ok')
    if (traced.status !== 'ok' || plain.status !== 'ok') return
    expect({ ...traced, calculationTimeMs: 0 }).toEqual({
      ...plain,
      calculationTimeMs: 0,
    })
  })

  it('isolates telemetry callback failures from placement', () => {
    const req = request([rectPart('a', 0, 0, 0, 6, 6)])
    const plain = runBottomLeftNest(req)
    let attempts = 0
    let flushes = 0
    const traced = runBottomLeftNest(req, {
      onAttempt: () => {
        attempts += 1
        throw new Error('telemetry failed')
      },
      onAttemptFlush: () => {
        flushes += 1
        throw new Error('flush failed')
      },
    })

    expect(attempts).toBeGreaterThan(0)
    expect(flushes).toBeGreaterThan(0)
    expect(traced.status).toBe('ok')
    expect(plain.status).toBe('ok')
    if (traced.status !== 'ok' || plain.status !== 'ok') return
    expect({ ...traced, calculationTimeMs: 0 }).toEqual({
      ...plain,
      calculationTimeMs: 0,
    })
  })

  it('1. rectangle inside sheet', () => {
    const part = rectPart('a', 0, 0, 0, 20, 10)
    const result = runBottomLeftNest(request([part]))
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements).toHaveLength(1)
    expect(result.unplacedPartIds).toHaveLength(0)
    const solid = worldSolid(part, result.placements[0]!)
    expect(solid.bounds.minX).toBeGreaterThanOrEqual(-1e-6)
    expect(solid.bounds.minY).toBeGreaterThanOrEqual(-1e-6)
    expect(solid.bounds.maxX).toBeLessThanOrEqual(100 + 1e-6)
    expect(solid.bounds.maxY).toBeLessThanOrEqual(100 + 1e-6)
  })

  it('2. rectangle outside sheet rejected (too large)', () => {
    const part = rectPart('big', 0, 0, 0, 200, 10)
    const result = runBottomLeftNest(
      request([part], {
        sheet: { widthMm: 100, heightMm: 100, marginMm: 0, quantity: 1 },
      }),
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements).toHaveLength(0)
    expect(result.unplacedPartIds).toContain('big')
  })

  it('3. two rectangles cannot overlap', () => {
    const a = rectPart('a', 0, 0, 0, 30, 30)
    const b = rectPart('b', 1, 0, 0, 30, 30)
    const result = runBottomLeftNest(request([a, b]))
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements).toHaveLength(2)
    const sa = worldSolid(a, result.placements.find((p) => p.partId === 'a')!)
    const sb = worldSolid(b, result.placements.find((p) => p.partId === 'b')!)
    expect(solidsOverlap(sa, sb)).toBe(false)
  })

  it('4. spacing is respected', () => {
    const a = rectPart('a', 0, 0, 0, 20, 20)
    const b = rectPart('b', 1, 0, 0, 20, 20)
    const spacing = 5
    const result = runBottomLeftNest(
      request([a, b], { settings: { spacingMm: spacing } }),
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements).toHaveLength(2)
    const sa = worldSolid(a, result.placements.find((p) => p.partId === 'a')!)
    const sb = worldSolid(b, result.placements.find((p) => p.partId === 'b')!)
    expect(solidsCollide(sa, sb, spacing)).toBe(false)
  })

  it('5. margin is respected', () => {
    const part = rectPart('a', 0, 0, 0, 20, 20)
    const margin = 10
    const result = runBottomLeftNest(
      request([part], {
        sheet: { widthMm: 100, heightMm: 100, marginMm: margin, quantity: 1 },
      }),
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const solid = worldSolid(part, result.placements[0]!)
    expect(solid.bounds.minX).toBeGreaterThanOrEqual(margin - 1e-6)
    expect(solid.bounds.minY).toBeGreaterThanOrEqual(margin - 1e-6)
    expect(solid.bounds.maxX).toBeLessThanOrEqual(100 - margin + 1e-6)
    expect(solid.bounds.maxY).toBeLessThanOrEqual(100 - margin + 1e-6)
  })

  it('6. 90° rotation', () => {
    // Tall part only fits after 90° on a wide short usable sheet
    const part = rectPart('tall', 0, 0, 0, 10, 80)
    const result = runBottomLeftNest(
      request([part], {
        sheet: { widthMm: 100, heightMm: 40, marginMm: 0, quantity: 1 },
        settings: { allowedRotations: [0, 90] },
      }),
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements).toHaveLength(1)
    expect(result.placements[0]!.rotation).toBe(90)
    const solid = worldSolid(part, result.placements[0]!)
    expect(solid.bounds.height).toBeLessThan(40 + 1e-6)
    expect(solid.bounds.width).toBeGreaterThan(70)
  })

  it('7. concave polygon', () => {
    // L-shape
    const points = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 15 },
      { x: 15, y: 15 },
      { x: 15, y: 40 },
      { x: 0, y: 40 },
    ]
    const part: GeometryPart = {
      id: 'L',
      sourceElement: 'polygon',
      originalIndex: 0,
      sourceId: 'L',
      outer: { points },
      holes: [],
      boundingBox: boundingBox(points),
      area: 40 * 15 + 15 * 25,
      centroid: centroid(points),
      originalTransform: null,
    }
    const result = runBottomLeftNest(request([part, rectPart('r', 1, 0, 0, 10, 10)]))
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements.length).toBe(2)
    const sL = worldSolid(part, result.placements.find((p) => p.partId === 'L')!)
    const sR = worldSolid(
      rectPart('r', 1, 0, 0, 10, 10),
      result.placements.find((p) => p.partId === 'r')!,
    )
    expect(solidsOverlap(sL, sR)).toBe(false)
  })

  it('8. multiple parts', () => {
    const parts = [
      rectPart('a', 0, 0, 0, 20, 20),
      rectPart('b', 1, 0, 0, 15, 15),
      rectPart('c', 2, 0, 0, 10, 25),
      rectPart('d', 3, 0, 0, 12, 12),
    ]
    const result = runBottomLeftNest(request(parts))
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements).toHaveLength(4)
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const sa = worldSolid(
          parts[i]!,
          result.placements.find((p) => p.partId === parts[i]!.id)!,
        )
        const sb = worldSolid(
          parts[j]!,
          result.placements.find((p) => p.partId === parts[j]!.id)!,
        )
        expect(solidsOverlap(sa, sb)).toBe(false)
      }
    }
  })

  it('9. multi-sheet placement', () => {
    const parts = [
      rectPart('a', 0, 0, 0, 60, 60),
      rectPart('b', 1, 0, 0, 60, 60),
    ]
    const result = runBottomLeftNest(
      request(parts, {
        sheet: { widthMm: 100, heightMm: 100, marginMm: 0, quantity: 5 },
      }),
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements).toHaveLength(2)
    expect(result.statistics.sheetCountUsed).toBeGreaterThanOrEqual(2)
    const sheets = new Set(result.placements.map((p) => p.sheetIndex))
    expect(sheets.size).toBeGreaterThanOrEqual(2)
  })

  it('10. unplaceable part', () => {
    const parts = [rectPart('ok', 0, 0, 0, 10, 10), rectPart('huge', 1, 0, 0, 500, 500)]
    const result = runBottomLeftNest(
      request(parts, {
        sheet: { widthMm: 100, heightMm: 100, marginMm: 5, quantity: 3 },
      }),
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements.some((p) => p.partId === 'ok')).toBe(true)
    expect(result.unplacedPartIds).toContain('huge')
  })

  it('11. hole-containing geometry', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 0, y: 50 },
    ]
    const hole = [
      { x: 15, y: 15 },
      { x: 15, y: 35 },
      { x: 35, y: 35 },
      { x: 35, y: 15 },
    ]
    const frame: GeometryPart = {
      id: 'frame',
      sourceElement: 'path',
      originalIndex: 0,
      sourceId: 'frame',
      outer: { points: outer },
      holes: [{ points: hole }],
      boundingBox: boundingBox(outer),
      area: 50 * 50 - 20 * 20,
      centroid: { x: 25, y: 25 },
      originalTransform: null,
    }
    const small = rectPart('s', 1, 0, 0, 10, 10)
    const result = runBottomLeftNest(request([frame, small]))
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements).toHaveLength(2)
    const sf = worldSolid(frame, result.placements.find((p) => p.partId === 'frame')!)
    const ss = worldSolid(small, result.placements.find((p) => p.partId === 's')!)
    expect(sf.holes.length).toBe(1)
    expect(solidsOverlap(sf, ss)).toBe(false)
    // Stage 4 does not place into holes — small must be outside frame solid
    expect(solidsCollide(sf, ss, 0)).toBe(false)
  })

  it('12. deterministic result', () => {
    const parts = [
      rectPart('a', 0, 0, 0, 25, 15),
      rectPart('b', 1, 0, 0, 18, 18),
      rectPart('c', 2, 0, 0, 12, 30),
    ]
    const req = request(parts, {
      settings: { spacingMm: 2, allowedRotations: [0, 90, 180, 270] },
    })
    const r1 = runBottomLeftNest(req)
    const r2 = runBottomLeftNest(req)
    expect(r1.status).toBe('ok')
    expect(r2.status).toBe('ok')
    if (r1.status !== 'ok' || r2.status !== 'ok') return
    expect(r1.placements).toEqual(r2.placements)
    expect(r1.unplacedPartIds).toEqual(r2.unplacedPartIds)
  })

  it('13. dayamaX/Y only change candidate preference (same sheet, different order)', () => {
    const parts = [
      rectPart('a', 0, 0, 0, 40, 40),
      rectPart('b', 1, 0, 0, 40, 40),
    ]
    const sheet = { widthMm: 100, heightMm: 100, marginMm: 0, quantity: 1 }
    const both = runBottomLeftNest(
      request(parts, {
        sheet,
        settings: { dayamaX: true, dayamaY: true, allowedRotations: [0] },
      }),
    )
    const xOnly = runBottomLeftNest(
      request(parts, {
        sheet,
        settings: { dayamaX: true, dayamaY: false, allowedRotations: [0] },
      }),
    )
    expect(both.status).toBe('ok')
    expect(xOnly.status).toBe('ok')
    if (both.status !== 'ok' || xOnly.status !== 'ok') return
    expect(both.placements).toHaveLength(2)
    expect(xOnly.placements).toHaveLength(2)
    // Preference change should move at least the second part (or both).
    expect(both.placements).not.toEqual(xOnly.placements)
    // Collision/spacing still hold for both runs.
    for (const r of [both, xOnly]) {
      const sa = worldSolid(parts[0]!, r.placements.find((p) => p.partId === 'a')!)
      const sb = worldSolid(parts[1]!, r.placements.find((p) => p.partId === 'b')!)
      expect(solidsOverlap(sa, sb)).toBe(false)
    }
  })

  it('14. dayamaX packs toward vertical edge; dayamaY toward horizontal edge', () => {
    // Several equal squares — bias should shift mean placement axis.
    const parts = Array.from({ length: 6 }, (_, i) =>
      rectPart(`p${i}`, i, 0, 0, 20, 20),
    )
    const sheet = { widthMm: 120, heightMm: 120, marginMm: 0, quantity: 1 }
    const mean = (
      r: Extract<ReturnType<typeof runBottomLeftNest>, { status: 'ok' }>,
    ) => {
      const n = r.placements.length
      const sx = r.placements.reduce((s, p) => s + p.x, 0)
      const sy = r.placements.reduce((s, p) => s + p.y, 0)
      return { x: sx / n, y: sy / n }
    }

    const dikey = runBottomLeftNest(
      request(parts, {
        sheet,
        settings: { dayamaX: true, dayamaY: false, allowedRotations: [0] },
      }),
    )
    const yatay = runBottomLeftNest(
      request(parts, {
        sheet,
        settings: { dayamaX: false, dayamaY: true, allowedRotations: [0] },
      }),
    )
    const both = runBottomLeftNest(
      request(parts, {
        sheet,
        settings: { dayamaX: true, dayamaY: true, allowedRotations: [0] },
      }),
    )
    const off = runBottomLeftNest(
      request(parts, {
        sheet,
        settings: { dayamaX: false, dayamaY: false, allowedRotations: [0] },
      }),
    )

    for (const r of [dikey, yatay, both, off]) {
      expect(r.status).toBe('ok')
      if (r.status !== 'ok') return
      expect(r.placements).toHaveLength(6)
    }
    if (
      dikey.status !== 'ok' ||
      yatay.status !== 'ok' ||
      both.status !== 'ok' ||
      off.status !== 'ok'
    ) {
      return
    }

    const mD = mean(dikey)
    const mY = mean(yatay)
    // Dikey (X) should sit further left than Yatay (Y) on average.
    expect(mD.x).toBeLessThan(mY.x)
    // Yatay (Y) should sit further toward the top than Dikey (X) on average.
    expect(mY.y).toBeLessThan(mD.y)
    // All four modes are not identical layouts.
    expect(dikey.placements).not.toEqual(yatay.placements)
    expect(both.placements).not.toEqual(off.placements)
    expect(dikey.placements).not.toEqual(off.placements)
  })

  it('15. full free-angle search finds an exact 37° fit outside coarse windows', () => {
    const part = rectPart('bar', 0, 0, 0, 100, 1)
    const radians = (37 * Math.PI) / 180
    const width = 100 * Math.cos(radians) + Math.sin(radians)
    const height = 100 * Math.sin(radians) + Math.cos(radians)
    const result = runBottomLeftNest(
      request([part], {
        sheet: {
          widthMm: width + 1e-6,
          heightMm: height + 1e-6,
          marginMm: 0,
          quantity: 1,
        },
        settings: {
          rotationMode: 'free',
          allowRotation: true,
          allowArbitraryRotation: true,
        },
      }),
      { freeAngleDepth: 'full' },
    )

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements).toHaveLength(1)
    expect([37, 143, 217, 323]).toContain(result.placements[0]?.rotation)
  })

  it('honors explicit rotations even when rotationMode is free', () => {
    const result = runBottomLeftNest(
      request([rectPart('bar', 0, 0, 0, 20, 5)], {
        settings: {
          rotationMode: 'free',
          allowRotation: true,
          allowArbitraryRotation: true,
          allowedRotationsExplicit: [37],
        },
      }),
      { freeAngleDepth: 'full' },
    )

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements[0]?.rotation).toBe(37)
  })

  it('does not round away a material sub-millidegree explicit rotation', () => {
    const source = rectPart('precision-bar', 0, 0, 0, 100_000, 1)
    const points = rotatePoints(
      source.outer.points,
      -0.0004,
      partRotationOrigin(source.outer.points),
    )
    const part: GeometryPart = {
      ...source,
      outer: { points },
      boundingBox: boundingBox(points),
      centroid: centroid(points),
    }
    const req = request([part], {
      sheet: {
        widthMm: 100_000.001,
        heightMm: 1.001,
        marginMm: 0,
        quantity: 1,
      },
      settings: {
        allowedRotationsExplicit: [0.0004],
        allowRotation: true,
      },
    })

    const result = runBottomLeftNest(req)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.statistics.placedCount).toBe(1)
    expect(result.placements[0]?.rotation).toBe(0.0004)
  })

  it('16. tries later sheet definitions when an earlier stock cannot fit', () => {
    const part = rectPart('a', 0, 0, 0, 20, 20)
    const req = request([part])
    req.sheets = [
      { widthMm: 10, heightMm: 10, marginMm: 0, quantity: 1 },
      { widthMm: 30, heightMm: 30, marginMm: 0, quantity: 1 },
    ]

    const result = runBottomLeftNest(req)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements).toHaveLength(1)
    expect(result.sheets[0]).toMatchObject({
      sheetIndex: 0,
      widthMm: 30,
      heightMm: 30,
    })
  })

  it('16b. reserves less-constrained stock regardless of definition order', () => {
    const parts = [
      rectPart('compact', 0, 0, 0, 7, 7),
      rectPart('long', 1, 0, 0, 10, 4),
    ]
    const stocks = [
      { widthMm: 10, heightMm: 10, marginMm: 0, quantity: 1 },
      { widthMm: 7, heightMm: 7, marginMm: 0, quantity: 1 },
    ]

    for (const sheets of [stocks, stocks.slice().reverse()]) {
      const req = request(parts)
      req.sheets = sheets
      const result = runBottomLeftNest(req)

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') continue
      expect(result.statistics.placedCount).toBe(2)
      expect(result.unplacedPartIds).toEqual([])
      expect(result.sheets.map((sheet) => [sheet.widthMm, sheet.heightMm]))
        .toEqual([[7, 7], [10, 10]])
    }
  })

  it('16c. preserves uniquely compatible stock before comparing sheet area', () => {
    const parts = [
      rectPart('flexible', 0, 0, 0, 6, 10),
      rectPart('wide', 1, 0, 0, 9, 6),
    ]
    const stocks = [
      { widthMm: 10, heightMm: 10, marginMm: 0, quantity: 1 },
      { widthMm: 6, heightMm: 20, marginMm: 0, quantity: 1 },
    ]

    for (const sheets of [stocks, stocks.slice().reverse()]) {
      const req = request(parts)
      req.sheets = sheets
      const result = runBottomLeftNest(req)

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') continue
      expect(result.statistics.placedCount).toBe(2)
      expect(result.unplacedPartIds).toEqual([])
      expect(result.sheets.map((sheet) => [sheet.widthMm, sheet.heightMm]))
        .toEqual([[6, 20], [10, 10]])
    }
  })

  it('16d. preserves a maximum Hall-safe heterogeneous-stock assignment', () => {
    const parts = [
      rectPart('p', 0, 0, 0, 6, 4),
      rectPart('q', 1, 0, 0, 4, 9),
      rectPart('r', 2, 0, 0, 9, 4),
      rectPart('s', 3, 0, 0, 4, 6),
    ]
    const stocks = [
      { widthMm: 6, heightMm: 6, marginMm: 0, quantity: 1 },
      { widthMm: 10, heightMm: 4, marginMm: 0, quantity: 2 },
      { widthMm: 4, heightMm: 10, marginMm: 0, quantity: 1 },
    ]

    for (const sheets of [stocks, stocks.slice().reverse()]) {
      const req = request(parts)
      req.sheets = sheets
      const result = placeWithOrder(req, ['p', 'q', 'r', 's'])

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') continue
      expect(result.statistics.placedCount).toBe(4)
      expect(result.unplacedPartIds).toEqual([])
      expect(result.sheets.map((sheet) => [sheet.widthMm, sheet.heightMm]))
        .toEqual([[10, 4], [4, 10], [10, 4], [6, 6]])
    }
  })

  it('16e. stock lookahead sees future fits at non-coarse free angles', () => {
    const flexible = rectPart('flexible', 0, 0, 0, 20, 20)
    const bar = rectPart('bar', 1, 0, 0, 100, 1)
    const rotated = rotatePoints(
      bar.outer.points,
      37,
      partRotationOrigin(bar.outer.points),
    )
    const exact = boundingBox(rotated)
    const stocks = [
      {
        widthMm: exact.width,
        heightMm: exact.height,
        marginMm: 0,
        quantity: 1,
      },
      { widthMm: 71, heightMm: 71, marginMm: 0, quantity: 1 },
    ]

    for (const sheets of [stocks, stocks.slice().reverse()]) {
      const req = request([flexible, bar], {
        settings: {
          rotationMode: 'free',
          allowRotation: true,
          allowArbitraryRotation: true,
        },
      })
      req.sheets = sheets
      const result = placeWithOrder(req, ['flexible', 'bar'], {
        freeAngleDepth: 'full',
      })

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') continue
      expect(result.statistics.placedCount).toBe(2)
      expect(result.sheets[0]).toMatchObject({ widthMm: 71, heightMm: 71 })
      const placement = result.placements.find(
        (candidate) => candidate.partId === 'bar',
      )
      expect(placement?.sheetIndex).toBe(1)
      expect([37, 143, 217, 323]).toContain(placement?.rotation)
    }
  })

  it('16f. merges huge equivalent inventories without slot expansion', () => {
    const parts = Array.from({ length: 2_000 }, (_, index) =>
      rectPart(`bulk-${index.toString().padStart(4, '0')}`, index, 0, 0, 1, 1),
    )
    const req = request(parts)
    req.sheets = Array.from({ length: 10 }, () => ({
      widthMm: 1,
      heightMm: 1,
      marginMm: 0,
      quantity: 2_000,
    }))
    let abort = false
    const started = performance.now()

    const result = runBottomLeftNest(req, {
      signal: {
        get aborted() {
          return abort
        },
      } as AbortSignal,
      onProgress: () => {
        abort = true
      },
    })

    expect(result.status).toBe('cancelled')
    expect(performance.now() - started).toBeLessThan(3_000)
  })

  it('16g. lookahead accounts for multiple future parts sharing one sheet', () => {
    const parts = [
      rectPart('current', 0, 0, 0, 6, 7),
      rectPart('q', 1, 0, 0, 10, 7),
      rectPart('p1', 2, 0, 0, 3, 10),
      rectPart('p2', 3, 0, 0, 3, 10),
    ]
    const stocks = [
      { widthMm: 6, heightMm: 10, marginMm: 0, quantity: 1 },
      { widthMm: 10, heightMm: 7, marginMm: 0, quantity: 1 },
    ]

    for (const sheets of [stocks, stocks.slice().reverse()]) {
      const req = request(parts)
      req.sheets = sheets
      const result = placeWithOrder(req, ['current', 'q', 'p1', 'p2'])

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') continue
      expect(result.statistics.placedCount).toBe(3)
      expect(result.unplacedPartIds).toEqual(['q'])
      expect(result.sheets[0]).toMatchObject({ widthMm: 10, heightMm: 7 })
      expect(
        result.placements.filter((placement) => placement.sheetIndex === 1),
      ).toHaveLength(2)
    }
  })

  it('16h. skips suffix simulations when area proves one part per sheet', () => {
    const parts = Array.from({ length: 60 }, (_, index) =>
      rectPart(`single-${index}`, index, 0, 0, 9, 9),
    )
    const req = request(parts)
    req.sheets = [
      { widthMm: 10, heightMm: 10, marginMm: 0, quantity: 60 },
      { widthMm: 11, heightMm: 11, marginMm: 0, quantity: 60 },
    ]
    const started = performance.now()

    const result = placeWithOrder(req, parts.map((part) => part.id))

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.statistics.placedCount).toBe(60)
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  it('does not repeat complete suffix simulations for shareable stock', () => {
    const parts = Array.from({ length: 60 }, (_, index) =>
      rectPart(`small-${index}`, index, 0, 0, 1, 1),
    )
    const req = request(parts)
    req.sheets = [
      { widthMm: 10, heightMm: 10, marginMm: 0, quantity: 1 },
      { widthMm: 11, heightMm: 11, marginMm: 0, quantity: 1 },
    ]
    const started = performance.now()

    const result = placeWithOrder(req, parts.map(({ id }) => id))

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.statistics.placedCount).toBe(60)
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  it('uses a valid existing homogeneous sheet without simulating an identical opening', () => {
    const parts = Array.from({ length: 4 }, (_, index) =>
      rectPart(`part-${index}`, index, 0, 0, 10, 10),
    )
    const singleSheetRequest = request(parts, {
      sheet: { widthMm: 40, heightMm: 10, marginMm: 0, quantity: 1 },
    })
    const spareSheetRequest = request(parts, {
      sheet: { widthMm: 40, heightMm: 10, marginMm: 0, quantity: 2 },
    })
    const expected = placeWithOrder(
      singleSheetRequest,
      parts.map(({ id }) => id),
    )

    beginBlfProfiling()
    let actual: ReturnType<typeof placeWithOrder>
    let profile: ReturnType<typeof getBlfProfileSnapshot>
    try {
      actual = placeWithOrder(
        spareSheetRequest,
        parts.map(({ id }) => id),
      )
      profile = getBlfProfileSnapshot()
    } finally {
      endBlfProfiling()
    }

    expect(expected.status).toBe('ok')
    expect(actual.status).toBe('ok')
    if (expected.status !== 'ok' || actual.status !== 'ok') return
    expect(actual.statistics.sheetCountUsed).toBe(1)
    expect(actual.placements).toEqual(expected.placements)
    expect(profile.parts.map(({ partId }) => partId)).toEqual(
      parts.map(({ id }) => id),
    )
    expect(profile.parts.slice(1).every(({ sheetsTried }) => sheetsTried === 1))
      .toBe(true)
  })

  it('16i. opens alternate stock instead of blocking a restricted future part', () => {
    const parts = [
      rectPart('first', 0, 0, 0, 10, 4),
      rectPart('flex', 1, 0, 0, 5, 5),
      rectPart('future', 2, 0, 0, 10, 4),
    ]
    const req = request(parts)
    req.sheets = [
      { widthMm: 10, heightMm: 10, marginMm: 0, quantity: 1 },
      { widthMm: 5, heightMm: 5, marginMm: 0, quantity: 1 },
    ]

    const result = placeWithOrder(req, ['first', 'flex', 'future'], {
      nfpFidelity: 'exact',
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.statistics.placedCount).toBe(3)
    expect(result.placements.find((placement) => placement.partId === 'flex'))
      .toMatchObject({ sheetIndex: 1 })
  })

  it('opens alternate stock to preserve shared capacity on an existing sheet', () => {
    const parts = [
      rectPart('first', 0, 0, 0, 10, 5),
      rectPart('current', 1, 0, 0, 5, 5),
      rectPart('f1', 2, 0, 0, 3, 5),
      rectPart('f2', 3, 0, 0, 3, 5),
      rectPart('f3', 4, 0, 0, 3, 5),
    ]
    const req = request(parts)
    req.sheets = [
      { widthMm: 10, heightMm: 10, marginMm: 0, quantity: 1 },
      { widthMm: 5, heightMm: 5, marginMm: 0, quantity: 1 },
    ]

    const result = placeWithOrder(req, parts.map(({ id }) => id))

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.statistics.placedCount).toBe(5)
    expect(result.placements.find(({ partId }) => partId === 'current'))
      .toMatchObject({ sheetIndex: 1 })
  })

  it('keeps cancelled lookahead results partitioned without duplicate part ids', () => {
    const parts = [
      rectPart('first', 0, 0, 0, 10, 4),
      rectPart('flex', 1, 0, 0, 5, 5),
      rectPart('future', 2, 0, 0, 10, 4),
    ]
    let sawCancellationAfterPlacement = false

    for (let abortAfter = 1; abortAfter <= 64; abortAfter++) {
      const req = request(parts)
      req.sheets = [
        { widthMm: 10, heightMm: 10, marginMm: 0, quantity: 1 },
        { widthMm: 5, heightMm: 5, marginMm: 0, quantity: 1 },
      ]
      let checks = 0
      const result = placeWithOrder(req, ['first', 'flex', 'future'], {
        nfpFidelity: 'exact',
        signal: {
          get aborted() {
            return ++checks >= abortAfter
          },
        } as AbortSignal,
      })
      if (result.status !== 'cancelled' || !result.bestSoFar) continue

      const placed = result.bestSoFar.placements.map(({ partId }) => partId)
      const all = [...placed, ...result.bestSoFar.unplacedPartIds]
      expect(all).toHaveLength(parts.length)
      expect(new Set(all)).toEqual(new Set(parts.map(({ id }) => id)))
      if (placed.length > 0) sawCancellationAfterPlacement = true
    }

    expect(sawCancellationAfterPlacement).toBe(true)
  })

  it('does not rebuild quadratic progress snapshots when no listener exists', () => {
    const req = request([
      rectPart('a', 0, 0, 0, 10, 10),
      rectPart('b', 1, 0, 0, 10, 10),
      rectPart('c', 2, 0, 0, 10, 10),
    ])
    let reductions = 0
    let finds = 0
    req.parts = new Proxy(req.parts, {
      get(target, property, receiver) {
        if (property === 'reduce') reductions += 1
        if (property === 'find') finds += 1
        return Reflect.get(target, property, receiver)
      },
    })

    const result = runBottomLeftNest(req)

    expect(result.status).toBe('ok')
    expect(reductions).toBe(1)
    expect(finds).toBe(0)
  })

  it('keeps dense explicit rotation grids lazy', () => {
    const parts = [
      rectPart('dense-angles-a', 0, 0, 0, 10, 2),
      rectPart('dense-angles-b', 1, 0, 0, 8, 3),
    ]
    const settings = { ...baseSettings, rotationStepDeg: 0.01 }

    const prepared = prepareParts(parts, settings)

    expect(prepared[0]!.rotations).toHaveLength(36_000)
    expect(prepared.every(({ variants }) => variants.length === 1)).toBe(true)
    expect(prepared[0]!.rotations).toBe(prepared[1]!.rotations)
  })

  it('bounds dense stepped rotations during explicit coarse depth', () => {
    const req = request([rectPart('dense-coarse', 0, 0, 0, 10, 2)], {
      settings: { allowRotation: true, rotationStepDeg: 0.01 },
    })
    const allowed = new Set(prepareParts(req.parts, req.settings)[0]!.rotations)
    const attempts: NestAttempt[] = []

    const result = placeWithOrder(req, ['dense-coarse'], {
      freeAngleDepth: 'coarse',
      onAttempt: (attempt) => attempts.push(attempt),
    })

    expect(result.status).toBe('ok')
    expect(attempts.length).toBeLessThanOrEqual(24)
    expect(new Set(attempts.map(({ rotation }) => rotation)).size)
      .toBe(attempts.length)
    expect(attempts.some(({ rotation }) => rotation === 0)).toBe(true)
    expect(attempts.every(({ rotation }) => allowed.has(rotation))).toBe(true)
  })

  it('samples only allowed large coarse sets and preserves small sets', () => {
    const evaluate = (allowedRotationsExplicit: number[]) => {
      const attempts: NestAttempt[] = []
      const result = placeWithOrder(
        request([rectPart('explicit-coarse', 0, 0, 0, 10, 2)], {
          settings: { allowRotation: true, allowedRotationsExplicit },
        }),
        ['explicit-coarse'],
        {
          freeAngleDepth: 'coarse',
          onAttempt: (attempt) => attempts.push(attempt),
        },
      )
      expect(result.status).toBe('ok')
      return attempts.map(({ rotation }) => rotation)
    }
    const large = Array.from({ length: 60 }, (_, index) => index * 6 + 1)

    const sampled = evaluate(large)

    expect(sampled.length).toBeLessThanOrEqual(24)
    expect(new Set(sampled).size).toBe(sampled.length)
    expect(sampled).toContain(large[0])
    expect(sampled.every((rotation) => large.includes(rotation))).toBe(true)
    expect(evaluate([15, 30, 75])).toEqual([15, 30, 75])
  })

  it('keeps canonical non-free rotation evaluation when coarse is implicit', () => {
    const allowedRotationsExplicit = Array.from(
      { length: 30 },
      (_, index) => index * 12,
    )
    const attempts: NestAttempt[] = []

    const result = placeWithOrder(
      request([rectPart('implicit-coarse', 0, 0, 0, 10, 2)], {
        settings: { allowRotation: true, allowedRotationsExplicit },
      }),
      ['implicit-coarse'],
      { onAttempt: (attempt) => attempts.push(attempt) },
    )

    expect(result.status).toBe('ok')
    expect(attempts.map(({ rotation }) => rotation))
      .toEqual(allowedRotationsExplicit)
  })

  it('orthogonal depth evaluates exactly the four orthogonal angles', () => {
    const rotations = new Set<number>()
    const result = placeWithOrder(
      request([rectPart('free', 0, 0, 0, 20, 10)], {
        settings: {
          rotationMode: 'free',
          allowRotation: true,
          allowArbitraryRotation: true,
        },
      }),
      ['free'],
      {
        freeAngleDepth: 'orthogonal',
        nfpFidelity: 'exact',
        onAttempt: ({ rotation }) => rotations.add(rotation),
      },
    )

    expect(result.status).toBe('ok')
    expect([...rotations].sort((a, b) => a - b)).toEqual([0, 90, 180, 270])
  })

  it('bounds a one-degree rotation grid to orthogonal depth angles', () => {
    const rotations = new Set<number>()
    const result = placeWithOrder(
      request([rectPart('stepped', 0, 0, 0, 20, 10)], {
        settings: { allowRotation: true, rotationStepDeg: 1 },
      }),
      ['stepped'],
      {
        freeAngleDepth: 'orthogonal',
        onAttempt: ({ rotation }) => rotations.add(rotation),
      },
    )

    expect(result.status).toBe('ok')
    expect([...rotations].sort((a, b) => a - b)).toEqual([0, 90, 180, 270])
  })

  it('bounds a one-degree rotation grid to quick depth angles', () => {
    const rotations = new Set<number>()
    const result = placeWithOrder(
      request([rectPart('stepped', 0, 0, 0, 20, 10)], {
        settings: { allowRotation: true, rotationStepDeg: 1 },
      }),
      ['stepped'],
      {
        freeAngleDepth: 'quick',
        onAttempt: ({ rotation }) => rotations.add(rotation),
      },
    )

    expect(result.status).toBe('ok')
    expect([...rotations].sort((a, b) => a - b)).toEqual([
      0, 45, 90, 135, 180, 225, 270, 315,
    ])
  })

  it('intersects bounded depth with explicit rotations and falls back when empty', () => {
    const evaluate = (allowedRotationsExplicit: number[]) => {
      const rotations = new Set<number>()
      const result = placeWithOrder(
        request([rectPart('explicit', 0, 0, 0, 20, 10)], {
          settings: { allowRotation: true, allowedRotationsExplicit },
        }),
        ['explicit'],
        {
          freeAngleDepth: 'orthogonal',
          onAttempt: ({ rotation }) => rotations.add(rotation),
        },
      )
      expect(result.status).toBe('ok')
      return [...rotations].sort((a, b) => a - b)
    }

    expect(evaluate([15, 90])).toEqual([90])
    expect(evaluate([15])).toEqual([15])
  })

  it('refine depth evaluates only the five-degree window around a plan rotation', () => {
    const rotations = new Set<number>()
    const result = placeWithPlan(
      request([rectPart('free', 0, 0, 0, 20, 10)], {
        settings: {
          rotationMode: 'free',
          allowRotation: true,
          allowArbitraryRotation: true,
        },
      }),
      { order: ['free'], rotations: [37] },
      {
        freeAngleDepth: 'refine',
        nfpFidelity: 'exact',
        onAttempt: ({ rotation }) => rotations.add(rotation),
      },
    )

    expect(result.status).toBe('ok')
    expect([...rotations].sort((a, b) => a - b)).toEqual([
      22, 27, 32, 37, 42, 47, 52,
    ])
  })

  it('reuses supplied prepared parts without mutating their order', () => {
    const req = request([
      rectPart('first', 0, 0, 0, 2, 2),
      rectPart('second', 1, 0, 0, 2, 2),
    ])
    const supplied = Object.freeze(
      prepareParts(req.parts, req.settings, { sortByArea: false }).reverse(),
    )
    const before = supplied.slice()
    const results = [
      runBottomLeftNest(req, { preparedParts: supplied }),
      placeWithOrderUnchecked(req, [], { preparedParts: supplied }),
      placeWithPlanUnchecked(req, { order: [], rotations: [] }, {
        preparedParts: supplied,
      }),
    ]

    for (const result of results) {
      expect(result.status).toBe('ok')
      if (result.status !== 'ok') continue
      expect(result.placements.map(({ partId }) => partId)).toEqual([
        'second',
        'first',
      ])
    }
    expect(supplied).toEqual(before)
  })

  it('17. plan placement never duplicates a source part', () => {
    const req = request([rectPart('a', 0, 0, 0, 20, 20)])
    const duplicate = { order: ['a', 'a'], rotations: [0, 0] }

    expect(() => placeWithPlan(req, duplicate)).toThrow('duplicate')
    const defensive = placeWithPlanUnchecked(req, duplicate)
    expect(defensive.status).toBe('ok')
    if (defensive.status !== 'ok') return
    expect(defensive.placements.map((placement) => placement.partId)).toEqual([
      'a',
    ])
    expect(defensive.statistics.placedCount).toBe(1)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    '18. rejects a non-finite plan rotation (%s)',
    (rotation) => {
      const req = request([rectPart('a', 0, 0, 0, 20, 20)])
      const plan = { order: ['a'], rotations: [rotation] }

      expect(() => placeWithPlan(req, plan)).toThrow('rotation')
      expect(() => placeWithPlanUnchecked(req, plan)).toThrow('rotation')
    },
  )

  it('19. canonical BLF path finds an off-center asymmetric-hole placement', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
      { x: 0, y: 30 },
    ]
    const hole = [
      { x: 5, y: 5 },
      { x: 25, y: 25 },
      { x: 25, y: 5 },
    ]
    const host: GeometryPart = {
      id: 'host',
      sourceElement: 'path',
      originalIndex: 0,
      sourceId: 'host',
      outer: { points: outer },
      holes: [{ points: hole }],
      boundingBox: boundingBox(outer),
      area: netArea({ points: outer }, [{ points: hole }]),
      centroid: centroid(outer),
      originalTransform: null,
    }
    const guest = rectPart('guest', 1, 0, 0, 10, 10)
    const result = runBottomLeftNest(
      request([host, guest], {
        sheet: { widthMm: 30, heightMm: 30, marginMm: 0, quantity: 1 },
        settings: { allowPartInPart: true },
      }),
    )

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.statistics.placedCount).toBe(2)
    expect(result.placements.find((placement) => placement.partId === 'guest'))
      .toMatchObject({ x: 15, y: 5, sheetIndex: 0 })
  })

  it('20. discrete canonical placement preserves a dense sub-0.5mm contact', () => {
    const req = denseContactFixture()

    const canonical = runBottomLeftNest(req)
    const cheap = runBottomLeftNest(req, { nfpFidelity: 'simplified' })

    expect(canonical.status).toBe('ok')
    expect(cheap.status).toBe('ok')
    if (canonical.status !== 'ok' || cheap.status !== 'ok') return
    expect(canonical.statistics.placedCount).toBe(2)
    expect(canonical.placements.find((placement) => placement.partId === 'tiny'))
      .toMatchObject({ x: 10, y: 9.6 })
    expect(cheap.placements.find((placement) => placement.partId === 'tiny'))
      .toMatchObject({ x: 10.05, y: 9.65 })
  })

  it('retries a failed simplified dense contact with exact candidates', () => {
    const req = denseContactFixture(true, 110)
    const exact = runBottomLeftNest(req, { nfpFidelity: 'exact' })
    const fallbackIds: string[] = []
    const fallback = runBottomLeftNest(req, {
      nfpFidelity: 'simplified',
      exactFallback: true,
      onExactFallback: (partId) => fallbackIds.push(partId),
    })

    expect(exact.status).toBe('ok')
    expect(fallback.status).toBe('ok')
    if (exact.status !== 'ok' || fallback.status !== 'ok') return
    expect(exact.statistics.unplacedCount).toBe(0)
    expect(fallback.statistics.unplacedCount).toBe(0)
    expect(fallback.placements).toEqual(exact.placements)
    expect(fallbackIds).toContain('tiny')
  })

  it('does not retry a successful simplified placement', () => {
    const fallbackIds: string[] = []
    const result = runBottomLeftNest(
      request([rectPart('fits', 0, 0, 0, 2, 2)]),
      {
        nfpFidelity: 'simplified',
        exactFallback: true,
        onExactFallback: (partId) => fallbackIds.push(partId),
      },
    )

    expect(result.status).toBe('ok')
    expect(fallbackIds).toEqual([])
  })

  it('does not exact-retry an aborted simplified placement', () => {
    const controller = new AbortController()
    const fallbackIds: string[] = []
    const result = runBottomLeftNest(denseContactFixture(true, 110), {
      nfpFidelity: 'simplified',
      exactFallback: true,
      onAttempt: ({ partId }) => {
        if (partId === 'tiny') controller.abort()
      },
      onExactFallback: (partId) => fallbackIds.push(partId),
      signal: controller.signal,
    })

    expect(result.status).toBe('cancelled')
    expect(fallbackIds).toEqual([])
  })

  it('does not exact-retry exact fidelity', () => {
    const fallbackIds: string[] = []
    runBottomLeftNest(denseContactFixture(true, 110), {
      nfpFidelity: 'exact',
      exactFallback: true,
      onExactFallback: (partId) => fallbackIds.push(partId),
    })

    expect(fallbackIds).toEqual([])
  })
})
