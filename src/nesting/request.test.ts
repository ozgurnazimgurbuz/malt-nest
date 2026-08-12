import { describe, expect, it } from 'vitest'
import { toNestingRequest } from './request'
import { DEFAULT_NEST, DEFAULT_SHEET } from '../state/defaults'
import type { GeometryPart } from '../geometry'
import { boundingBox } from '../geometry'
import { coarseFreeAngles } from './optimization/rotations'

describe('toNestingRequest free-angle rotation', () => {
  const part: GeometryPart = {
    id: 'a',
    sourceElement: 'rect',
    originalIndex: 0,
    sourceId: 'a',
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

  it('enables free cascade (not locked to 0/90/180/270)', () => {
    const req = toNestingRequest([part], DEFAULT_SHEET, DEFAULT_NEST)
    expect(req.settings.allowRotation).toBe(true)
    expect(req.settings.rotationMode).toBe('free')
    expect(req.settings.allowArbitraryRotation).toBe(true)
    expect(req.settings.allowedRotationsExplicit).toBeNull()
    expect(req.settings.allowedRotations).toEqual(coarseFreeAngles())
    expect(req.settings.allowedRotations).toContain(15)
    expect(req.settings.allowedRotations).toContain(45)
    expect(req.settings.allowedRotations).not.toEqual([0, 90, 180, 270])
  })

  it('uses classic BLF pack bias (no user dayama toggle)', () => {
    const req = toNestingRequest([part], DEFAULT_SHEET, DEFAULT_NEST)
    expect(req.settings.dayamaX).toBe(true)
    expect(req.settings.dayamaY).toBe(true)
  })

  it('maps production params while keeping the legacy optimizer settings internal', () => {
    const req = toNestingRequest([part], { widthMm: 1600, heightMm: 1000 }, {
      ...DEFAULT_NEST,
      gapMm: 3,
      marginMm: 8,
    })
    expect(req.sheets[0]).toMatchObject({
      widthMm: 1600,
      heightMm: 1000,
      marginMm: 8,
    })
    expect(req.settings.spacingMm).toBe(3)
    expect(req.settings.optimizationLevel).toBe('fast')
    expect(req.settings.timeLimitMs).toBe(5_000)
  })

  it('derives identical-sheet inventory from the number of parts', () => {
    const req = toNestingRequest(
      Array.from({ length: 101 }, (_, index) => ({
        ...part,
        id: `part-${index}`,
        originalIndex: index,
      })),
      DEFAULT_SHEET,
      DEFAULT_NEST,
    )

    expect(req.sheets[0]?.quantity).toBe(101)
  })

  it('keeps one empty sheet definition for an empty request', () => {
    const req = toNestingRequest([], DEFAULT_SHEET, DEFAULT_NEST)
    expect(req.sheets[0]?.quantity).toBe(1)
    expect(req.settings.timeLimitMs).toBeGreaterThan(0)
    expect(Number.isFinite(req.settings.timeLimitMs)).toBe(true)
  })

  it.each([
    [{ widthMm: 0, heightMm: 100 }, DEFAULT_NEST, 'width'],
    [{ widthMm: Number.NaN, heightMm: 100 }, DEFAULT_NEST, 'width'],
    [DEFAULT_SHEET, { ...DEFAULT_NEST, gapMm: -1 }, 'spacing'],
    [DEFAULT_SHEET, { ...DEFAULT_NEST, marginMm: -1 }, 'margin'],
    [DEFAULT_SHEET, { ...DEFAULT_NEST, seed: Number.POSITIVE_INFINITY }, 'seed'],
    [
      { widthMm: 20, heightMm: 100 },
      { ...DEFAULT_NEST, marginMm: 10 },
      'margin',
    ],
  ])('rejects invalid nesting input at the request boundary', (sheet, nest, message) => {
    expect(() => toNestingRequest([part], sheet, nest)).toThrow(message)
  })

  it('rejects empty and duplicate part IDs before Map-based placement', () => {
    expect(() =>
      toNestingRequest([{ ...part, id: '   ' }], DEFAULT_SHEET, DEFAULT_NEST),
    ).toThrow('non-empty')
    expect(() =>
      toNestingRequest(
        [part, { ...part, originalIndex: 1 }],
        DEFAULT_SHEET,
        DEFAULT_NEST,
      ),
    ).toThrow('unique')
  })
})
