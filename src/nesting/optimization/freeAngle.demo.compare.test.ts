/**
 * Compare orthogonal vs free-angle cascade on Demo.svg via BLF baseline
 * (same placer the evolutionary engine uses for `variant: 'best'`).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSvgGeometry } from '../../svg/parseGeometry'
import { runBottomLeftNest } from '../placement/blf'
import { ORTHOGONAL_ANGLES } from './rotations'
import type { NestingRequest, NestingSettings, NestingSuccess } from '../types'

const DEMO = '/Users/ozgurnazimgurbuz/Desktop/Demo.svg'

function baseSettings(over: Partial<NestingSettings>): NestingSettings {
  return {
    spacingMm: 5,
    allowedRotations: [...ORTHOGONAL_ANGLES],
    allowedRotationsExplicit: null,
    rotationStepDeg: null,
    allowArbitraryRotation: false,
    rotationMode: 'orthogonal',
    allowRotation: true,
    optimizationLevel: 'fast',
    timeLimitMs: 60_000,
    seed: 42,
    deterministic: false,
    allowPartInPart: false,
    dayamaX: true,
    dayamaY: true,
    ...over,
  }
}

function summarize(label: string, result: NestingSuccess, ms: number) {
  const angles = result.placements.map((p) => p.rotation)
  const unique = [...new Set(angles.map((a) => Math.round(a * 10) / 10))].sort(
    (a, b) => a - b,
  )
  const sheetArea =
    result.sheets.reduce((s, sh) => {
      const usable =
        Math.max(0, sh.widthMm - 2 * 10) * Math.max(0, sh.heightMm - 2 * 10)
      return s + usable
    }, 0) || 1
  const wastePct = (result.wasteMm2 / sheetArea) * 100
  let packedBoundsMm2 = 0
  for (const sh of result.sheets) {
    if (!sh.usedBounds) continue
    packedBoundsMm2 +=
      Math.max(0, sh.usedBounds.maxX - sh.usedBounds.minX) *
      Math.max(0, sh.usedBounds.maxY - sh.usedBounds.minY)
  }
  return {
    label,
    sheets: result.statistics.sheetCountUsed,
    placed: result.statistics.placedCount,
    unplaced: result.statistics.unplacedCount,
    wasteMm2: Math.round(result.wasteMm2),
    wastePct: Number(wastePct.toFixed(2)),
    usedAreaMm2: Math.round(result.statistics.totalPartAreaMm2),
    utilizationPct: Number((result.utilization * 100).toFixed(2)),
    packedBoundsMm2: Math.round(packedBoundsMm2),
    sampleAngles: unique.slice(0, 20),
    angleCount: unique.length,
    ms: Math.round(ms),
  }
}

function runMode(label: string, settings: NestingSettings) {
  const raw = readFileSync(DEMO, 'utf8')
  const geo = parseSvgGeometry(raw)
  const req: NestingRequest = {
    parts: geo.parts,
    sheets: [{ widthMm: 1600, heightMm: 1000, marginMm: 10, quantity: 100 }],
    settings,
  }
  const t0 = performance.now()
  const result = runBottomLeftNest(req, {})
  const ms = performance.now() - t0
  expect(result.status).toBe('ok')
  if (result.status !== 'ok') throw new Error('nest failed')
  return { geo, summary: summarize(label, result, ms) }
}

// Heavy Demo.svg timing compare — run with: RUN_DEMO_COMPARE=1 npm test -- freeAngle.demo
describe.skipIf(process.env.RUN_DEMO_COMPARE !== '1')(
  'Demo.svg free-angle vs orthogonal',
  () => {
  it(
    'BLF baseline: 1600×1000 gap5 margin10, 16 parts',
    () => {
      const ortho = runMode(
        'orthogonal',
        baseSettings({
          rotationMode: 'orthogonal',
          allowArbitraryRotation: false,
          allowedRotations: [...ORTHOGONAL_ANGLES],
          allowedRotationsExplicit: [...ORTHOGONAL_ANGLES],
        }),
      )
      const free = runMode(
        'free-cascade',
        baseSettings({
          rotationMode: 'free',
          allowArbitraryRotation: true,
          allowedRotations: [],
          allowedRotationsExplicit: null,
        }),
      )

      expect(ortho.geo.partCount).toBe(16)
      expect(free.geo.partCount).toBe(16)

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            partCount: 16,
            sheet: '1600x1000',
            gapMm: 5,
            marginMm: 10,
            ortho: ortho.summary,
            free: free.summary,
          },
          null,
          2,
        ),
      )

      expect(free.summary.placed).toBeGreaterThan(0)
      expect(ortho.summary.placed).toBeGreaterThan(0)
    },
    300_000,
  )
  },
)
