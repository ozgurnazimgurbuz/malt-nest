import { describe, expect, it } from 'vitest'
import type { GeometryPart } from '../../geometry'
import {
  boundingBox,
  partRotationOrigin,
  rotatePoints,
  solidFromRings,
  solidsCollide,
  solidsOverlap,
} from '../../geometry'
import { runBottomLeftNest } from './blf'
import type { NestingRequest, NestingSettings, Placement } from '../types'

const baseSettings: NestingSettings = {
  spacingMm: 0,
  allowedRotations: [0],
  rotationStepDeg: null,
  allowArbitraryRotation: false,
  optimizationLevel: 'fast',
  timeLimitMs: 5000,
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

describe('runBottomLeftNest', () => {
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
      centroid: { x: 15, y: 15 },
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
      { x: 35, y: 15 },
      { x: 35, y: 35 },
      { x: 15, y: 35 },
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
})
