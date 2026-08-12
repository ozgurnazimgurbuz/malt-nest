/**
 * Opt-in Demo.svg automatic free-angle benchmark.
 *
 * Run: DEMO_SVG=/path/to/Demo.svg npm test -- --run src/nesting/optimization/freeAngle.demo.compare.test.ts
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSvgGeometry } from '../../svg/parseGeometry'
import {
  compareNestingResults,
  packedBoundsMm2,
} from '../scoring/fitness'
import type { NestingRequest, NestingSuccess } from '../types'
import { runAutomaticNest } from './automaticOptimizer'
import { coarseFreeAngles } from './rotations'

const DEMO = process.env.DEMO_SVG ?? ''
const OUT = '/tmp/malt-nest-automatic-demo-bench.json'
const hasDemo = (() => {
  if (!DEMO || !existsSync(DEMO)) return false
  try {
    return statSync(DEMO).isFile()
  } catch {
    return false
  }
})()

describe.skipIf(!hasDemo)(
  'Demo.svg automatic search (DEMO_SVG=/path npm test -- --run freeAngle.demo.compare.test.ts)',
  () => {
    it('keeps its published exact seed while searching', () => {
      const geometry = parseSvgGeometry(readFileSync(DEMO, 'utf8'))
      expect(geometry.partCount).toBe(16)
      const request: NestingRequest = {
        parts: geometry.parts,
        sheets: [
          { widthMm: 1600, heightMm: 1000, marginMm: 10, quantity: 100 },
        ],
        settings: {
          spacingMm: 5,
          allowedRotations: coarseFreeAngles(),
          allowedRotationsExplicit: null,
          rotationStepDeg: null,
          allowArbitraryRotation: true,
          rotationMode: 'free',
          allowRotation: true,
          seed: 42,
          deterministic: true,
          allowPartInPart: false,
          dayamaX: true,
          dayamaY: true,
        },
      }

      const startedAt = performance.now()
      let firstChampionMs: number | null = null
      let exactSeed: NestingSuccess | null = null
      const result = runAutomaticNest(request, {
        seed: 42,
        deterministic: true,
        onProgress: ({ bestSoFar }) => {
          if (exactSeed || !bestSoFar) return
          exactSeed = bestSoFar
          firstChampionMs = performance.now() - startedAt
        },
      })
      const finalMs = performance.now() - startedAt

      expect(result.status).toBe('ok')
      expect(exactSeed).not.toBeNull()
      if (result.status !== 'ok' || exactSeed == null) return
      expect(compareNestingResults(result, exactSeed)).toBeLessThanOrEqual(0)

      const report = {
        fixture: 'Demo.svg',
        partCount: geometry.partCount,
        firstChampionMs,
        finalMs,
        exactSeedPackedBoundsMm2: packedBoundsMm2(exactSeed),
        finalPackedBoundsMm2: packedBoundsMm2(result),
      }
      writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
      console.log(JSON.stringify(report, null, 2))
    }, 1_200_000)
  },
)
