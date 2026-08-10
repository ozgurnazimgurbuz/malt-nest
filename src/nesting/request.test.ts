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

  it('still maps production params from UI', () => {
    const req = toNestingRequest([part], { widthMm: 1600, heightMm: 1000 }, {
      ...DEFAULT_NEST,
      gapMm: 3,
      marginMm: 8,
      optimizationLevel: 'fast',
    })
    expect(req.sheets[0]).toMatchObject({
      widthMm: 1600,
      heightMm: 1000,
      marginMm: 8,
    })
    expect(req.settings.spacingMm).toBe(3)
    expect(req.settings.optimizationLevel).toBe('fast')
  })
})
