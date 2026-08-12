import { describe, expect, it } from 'vitest'
import { boundingBox, solidFromRings, type GeometryPart } from '../../geometry'
import { prepareParts } from '../core/prepare'
import { collectPlacementCandidates } from '../nfp/candidates'
import {
  compareByPackBias,
  DEFAULT_PACK_BIAS,
  resolvePackBias,
} from './packBias'

describe('packBias / dayama preference', () => {
  it('resolvePackBias defaults both axes on', () => {
    expect(resolvePackBias(undefined)).toEqual(DEFAULT_PACK_BIAS)
    expect(resolvePackBias({})).toEqual(DEFAULT_PACK_BIAS)
    expect(resolvePackBias({ dayamaX: false })).toEqual({
      dayamaX: false,
      dayamaY: true,
    })
  })

  it('true/true sorts Y then X (backward-compatible BLF order)', () => {
    const pts = [
      { x: 30, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: 5, y: 20 },
    ]
    const sorted = [...pts].sort((a, b) =>
      compareByPackBias(a, b, DEFAULT_PACK_BIAS),
    )
    expect(sorted.map((p) => `${p.x},${p.y}`)).toEqual([
      '10,10',
      '30,10',
      '5,20',
      '10,20',
    ])
  })

  it('dayamaX (Dikey Dayama) prefers smaller x — vertical edges', () => {
    const pts = [
      { x: 30, y: 10 },
      { x: 10, y: 50 },
      { x: 20, y: 0 },
    ]
    const bias = { dayamaX: true, dayamaY: false }
    const sorted = [...pts].sort((a, b) => compareByPackBias(a, b, bias))
    expect(sorted.map((p) => p.x)).toEqual([10, 20, 30])
  })

  it('dayamaY (Yatay Dayama) prefers smaller y — horizontal edges', () => {
    const pts = [
      { x: 50, y: 30 },
      { x: 10, y: 10 },
      { x: 90, y: 20 },
    ]
    const bias = { dayamaX: false, dayamaY: true }
    const sorted = [...pts].sort((a, b) => compareByPackBias(a, b, bias))
    expect(sorted.map((p) => p.y)).toEqual([10, 20, 30])
  })

  it('both off leaves relative order unchanged (comparator 0)', () => {
    const a = { x: 99, y: 99 }
    const b = { x: 0, y: 0 }
    expect(
      compareByPackBias(a, b, { dayamaX: false, dayamaY: false }),
    ).toBe(0)
  })

  it('same geometry: candidate order changes with dayama settings', () => {
    const part: GeometryPart = {
      id: 'sq',
      sourceElement: 'rect',
      originalIndex: 0,
      sourceId: 'sq',
      outer: {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      },
      holes: [],
      boundingBox: boundingBox([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
      area: 100,
      centroid: { x: 5, y: 5 },
      originalTransform: null,
    }
    const prepared = prepareParts([part], {
      spacingMm: 0,
      allowedRotations: [0],
      rotationStepDeg: null,
      allowArbitraryRotation: false,
    })
    const variant = prepared[0]!.variants[0]!
    const ifp = { minX: 0, minY: 0, maxX: 90, maxY: 90 }
    const placed = [
      solidFromRings(
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
        [],
      ),
    ]

    const def = collectPlacementCandidates(
      variant,
      placed,
      ifp,
      0,
      [{ partId: 'p0', rotation: 0 }],
      undefined,
      { dayamaX: true, dayamaY: true },
    )
    const xOnly = collectPlacementCandidates(
      variant,
      placed,
      ifp,
      0,
      [{ partId: 'p0', rotation: 0 }],
      undefined,
      { dayamaX: true, dayamaY: false },
    )
    const yOnly = collectPlacementCandidates(
      variant,
      placed,
      ifp,
      0,
      [{ partId: 'p0', rotation: 0 }],
      undefined,
      { dayamaX: false, dayamaY: true },
    )
    const off = collectPlacementCandidates(
      variant,
      placed,
      ifp,
      0,
      [{ partId: 'p0', rotation: 0 }],
      undefined,
      { dayamaX: false, dayamaY: false },
    )

    expect(def.length).toBeGreaterThan(3)
    expect(def.length).toBe(xOnly.length)
    expect(def.length).toBe(yOnly.length)
    expect(def.length).toBe(off.length)

    const key = (t: { x: number; y: number }) =>
      `${t.x.toFixed(3)},${t.y.toFixed(3)}`
    const defKeys = def.map(key)
    const xKeys = xOnly.map(key)
    const yKeys = yOnly.map(key)
    const offKeys = off.map(key)

    expect([...defKeys].sort()).toEqual([...xKeys].sort())
    expect([...defKeys].sort()).toEqual([...offKeys].sort())
    expect(defKeys).not.toEqual(xKeys)
    expect(yKeys[0]).toBe(defKeys[0])
    expect(offKeys).not.toEqual(defKeys)

    // First accepted preference: X-only leads with smaller x than Y-only when they diverge.
    expect(xOnly[0]!.x).toBeLessThanOrEqual(yOnly[0]!.x + 1e-9)
    expect(yOnly[0]!.y).toBeLessThanOrEqual(xOnly[0]!.y + 1e-9)
  })
})
