/**
 * Stage-1 + Stage-2 shortlist fix Demo.svg benchmark.
 *
 * Stage 2: 0° Top-K + mandatory area_desc → full cascade each → packed-bounds pick.
 *
 * Run: RUN_DEMO_COMPARE=1 npx vitest run src/nesting/optimization/freeAngle.demo.compare.test.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSvgGeometry } from '../../svg/parseGeometry'
import { prepareParts } from '../core/prepare'
import {
  beginPlacementSession,
  placeWithOrder,
  placeWithPlan,
  runBottomLeftNest,
} from '../placement/blf'
import {
  isBetterPackedBounds,
  packedBoundsMm2,
  scoreNestingResult,
} from '../scoring/fitness'
import { buildOrderCandidates } from './orderSearch'
import { createRng } from './rng'
import { coarseFreeAngles } from './rotations'
import type { NestingRequest, NestingSettings, NestingSuccess } from '../types'

const DEMO = '/Users/ozgurnazimgurbuz/Desktop/Demo.svg'
const OUT = '/tmp/malt-nest-stage2-shortlist-bench.json'

/** Stage 1 published free-cascade BLF baseline (regression guard). */
const STAGE1_TARGET_BOUNDS = 780_097
const STAGE1_BOUNDS_TOL_MM2 = 50

const ORDER_SEARCH_LIMIT = 12
const ORDER_POLISH_TOP_K = 2

function settings(): NestingSettings {
  return {
    spacingMm: 5,
    allowedRotations: coarseFreeAngles(),
    allowedRotationsExplicit: null,
    rotationStepDeg: null,
    allowArbitraryRotation: true,
    rotationMode: 'free',
    allowRotation: true,
    optimizationLevel: 'balanced',
    timeLimitMs: 120_000,
    seed: 42,
    deterministic: false,
    allowPartInPart: false,
    dayamaX: true,
    dayamaY: true,
  }
}

describe.skipIf(process.env.RUN_DEMO_COMPARE !== '1')(
  'Demo.svg Stage-2 shortlist + full cascade',
  () => {
    it(
      'Top-K + mandatory area_desc get full cascade; Stage1 floor kept',
      () => {
        const raw = readFileSync(DEMO, 'utf8')
        const geo = parseSvgGeometry(raw)
        expect(geo.partCount).toBe(16)

        const nestSettings = settings()
        const req: NestingRequest = {
          parts: geo.parts,
          sheets: [
            { widthMm: 1600, heightMm: 1000, marginMm: 10, quantity: 100 },
          ],
          settings: nestSettings,
        }

        // —— STAGE 1 BASELINE ——
        beginPlacementSession()
        const tBase0 = performance.now()
        const baselineRaw = runBottomLeftNest(req, {
          freeAngleDepth: 'full',
          engineId: 'bench-stage1-full',
        })
        const msBaseline = performance.now() - tBase0
        expect(baselineRaw.status).toBe('ok')
        if (baselineRaw.status !== 'ok') throw new Error('baseline failed')
        const baselineCandidate = baselineRaw
        const baselineBounds = packedBoundsMm2(baselineCandidate)

        // —— STAGE 2: 0° rank → shortlist (Top-K + area_desc) → full each ——
        beginPlacementSession()
        const prepared = prepareParts(geo.parts, nestSettings, {
          sortByArea: false,
        })
        const candidates = buildOrderCandidates(
          prepared,
          createRng(42),
          ORDER_SEARCH_LIMIT,
        )

        const tS20 = performance.now()
        type Cheap = {
          name: string
          order: string[]
          scoreTotal: number
          bounds: number
        }
        const cheapTrials: Cheap[] = []
        for (const cand of candidates) {
          const placed = placeWithPlan(
            req,
            {
              order: cand.order,
              rotations: cand.order.map(() => 0),
            },
            { engineId: 'bench-order-0' },
          )
          expect(placed.status).toBe('ok')
          if (placed.status !== 'ok') continue
          cheapTrials.push({
            name: cand.name,
            order: cand.order,
            scoreTotal: scoreNestingResult(placed).total,
            bounds: packedBoundsMm2(placed),
          })
        }
        cheapTrials.sort((a, b) => a.scoreTotal - b.scoreTotal)

        type Short = { name: string; order: string[] }
        const shortlist: Short[] = []
        const seen = new Set<string>()
        const pushShort = (name: string, order: string[]) => {
          const key = order.join(',')
          if (seen.has(key)) return
          seen.add(key)
          shortlist.push({ name, order })
        }
        for (const t of cheapTrials.slice(0, ORDER_POLISH_TOP_K)) {
          pushShort(t.name, t.order)
        }
        const areaCheap = cheapTrials.find((t) => t.name === 'area_desc')
        expect(areaCheap).toBeTruthy()
        if (areaCheap) pushShort(areaCheap.name, areaCheap.order)

        type FullRow = {
          name: string
          bounds: number
          ms: number
          result: NestingSuccess
          reusedBaseline: boolean
        }
        const fullRows: FullRow[] = []
        for (const item of shortlist) {
          if (item.name === 'area_desc') {
            fullRows.push({
              name: item.name,
              bounds: baselineBounds,
              ms: 0,
              result: baselineCandidate,
              reusedBaseline: true,
            })
            continue
          }
          const t0 = performance.now()
          const placed = placeWithOrder(req, item.order, {
            freeAngleDepth: 'full',
            engineId: `bench-full-${item.name}`,
          })
          const ms = performance.now() - t0
          expect(placed.status).toBe('ok')
          if (placed.status !== 'ok') continue
          fullRows.push({
            name: item.name,
            bounds: packedBoundsMm2(placed),
            ms,
            result: placed,
            reusedBaseline: false,
          })
        }
        expect(fullRows.length).toBeGreaterThanOrEqual(2)
        expect(fullRows.some((r) => r.name === 'area_desc')).toBe(true)

        let stage2Champ = fullRows[0]!
        for (const r of fullRows.slice(1)) {
          if (isBetterPackedBounds(r.result, stage2Champ.result)) stage2Champ = r
        }
        const msStage2 = performance.now() - tS20
        const stage2Bounds = stage2Champ.bounds
        const areaDescFullRow = fullRows.find((r) => r.name === 'area_desc')!

        // —— FINAL: packed bounds; never worse than Stage 1 ——
        type Finalist = { name: string; result: NestingSuccess }
        const finalists: Finalist[] = [
          { name: 'stage1_full', result: baselineCandidate },
          {
            name: `stage2:${stage2Champ.name}`,
            result: stage2Champ.result,
          },
        ]
        let winner = finalists[0]!
        for (const c of finalists.slice(1)) {
          if (isBetterPackedBounds(c.result, winner.result)) winner = c
        }
        // Explicit regression guard: Stage 2 may not degrade below Stage 1.
        if (isBetterPackedBounds(baselineCandidate, winner.result)) {
          winner = { name: 'stage1_full', result: baselineCandidate }
        }

        const finalBounds = packedBoundsMm2(winner.result)
        const msTotal = msBaseline + msStage2
        const vsBaselinePct =
          ((stage2Bounds - baselineBounds) / baselineBounds) * 100
        const nearTarget =
          Math.abs(baselineBounds - STAGE1_TARGET_BOUNDS) <=
          STAGE1_BOUNDS_TOL_MM2
        const noRegression =
          nearTarget &&
          finalBounds <= STAGE1_TARGET_BOUNDS + STAGE1_BOUNDS_TOL_MM2

        const report = {
          ok: noRegression,
          partCount: geo.partCount,
          sheet: '1600x1000',
          gapMm: 5,
          marginMm: 10,
          baseline: {
            order: 'area_desc',
            bounds: Math.round(baselineBounds),
            ms: Math.round(msBaseline),
          },
          stage2: {
            ordersTried: cheapTrials.length,
            shortlist: shortlist.map((s) => s.name),
            shortlistCount: shortlist.length,
            fullEvaluated: fullRows.map((r) => ({
              name: r.name,
              bounds: Math.round(r.bounds),
              ms: Math.round(r.ms),
              reusedBaseline: r.reusedBaseline,
            })),
            winnerOrder: stage2Champ.name,
            bounds: Math.round(stage2Bounds),
            ms: Math.round(msStage2),
            deltaVsBaselinePct: Number(vsBaselinePct.toFixed(2)),
          },
          areaDescFull: {
            bounds: Math.round(areaDescFullRow.bounds),
            note: areaDescFullRow.reusedBaseline
              ? 'reused Stage1 baseline full cascade'
              : 'separate full run',
          },
          final: {
            winner: winner.name,
            bounds: Math.round(finalBounds),
            msTotal: Math.round(msTotal),
          },
          regression: {
            stage1Target: STAGE1_TARGET_BOUNDS,
            baselineNear780097: nearTarget ? 'YES' : 'NO',
            baselineRegression: noRegression ? 'NO' : 'YES',
            stage1QualityKept: noRegression ? 'YES' : 'NO',
          },
          decision: noRegression
            ? 'Stage 2 artık Stage 1\'in kalitesini koruyor; shortlist area_desc + full.'
            : 'Baseline regression var, düzeltmeden devam edilmemeli.',
        }

        writeFileSync(OUT, JSON.stringify(report, null, 2))
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(report, null, 2))

        expect(nearTarget).toBe(true)
        expect(noRegression).toBe(true)
        expect(shortlist.some((s) => s.name === 'area_desc')).toBe(true)
        expect(finalBounds).toBeLessThanOrEqual(
          STAGE1_TARGET_BOUNDS + STAGE1_BOUNDS_TOL_MM2,
        )
      },
      1_200_000,
    )
  },
)
