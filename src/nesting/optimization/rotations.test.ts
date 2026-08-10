import { describe, expect, it } from 'vitest'
import {
  anglesAround,
  coarseFreeAngles,
  freeAngleCascadeStages,
  resolveAllowedAngles,
  usesFreeAngleCascade,
} from './rotations'
import type { NestingSettings } from '../types'

describe('free-angle cascade helpers', () => {
  it('coarse grid is 0..345 step 15 (24 angles)', () => {
    const a = coarseFreeAngles()
    expect(a).toHaveLength(24)
    expect(a[0]).toBe(0)
    expect(a).toContain(45)
    expect(a).toContain(345)
    expect(a).not.toContain(1)
  })

  it('anglesAround builds refine / final windows', () => {
    expect(anglesAround([45], 15, 5)).toEqual([
      30, 35, 40, 45, 50, 55, 60,
    ])
    expect(anglesAround([47], 5, 1)).toEqual([
      42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52,
    ])
  })

  it('cascade stages wire coarse → refine → final', () => {
    const s = freeAngleCascadeStages()
    expect(s.coarse).toHaveLength(24)
    const mid = s.refine([45])
    expect(mid).toContain(30)
    expect(mid).toContain(60)
    const fin = s.final([47])
    expect(fin).toContain(42)
    expect(fin).toContain(52)
  })

  it('resolveAllowedAngles free mode returns coarse set', () => {
    const settings: NestingSettings = {
      spacingMm: 5,
      allowedRotations: [0],
      allowedRotationsExplicit: null,
      rotationStepDeg: null,
      allowArbitraryRotation: true,
      rotationMode: 'free',
      allowRotation: true,
      optimizationLevel: 'fast',
      timeLimitMs: 500,
    }
    expect(resolveAllowedAngles(settings, [])).toEqual(coarseFreeAngles())
    expect(usesFreeAngleCascade(settings)).toBe(true)
  })
})
