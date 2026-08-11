/**
 * EXPERIMENT ONLY — order × free-angle depth correlation on Demo.svg.
 * Does not change production selection. Opt-in:
 *
 *   RUN_ORDER_DEPTH_PROFILE=1 npx vitest run \
 *     src/nesting/optimization/freeAngle.orderDepth.profile.test.ts
 *
 * Phases: all 12 × (0°, coarse, medium); full only on representatives
 * (area_desc, bbox_area_desc, complexity_desc) + any extra top medium not in that set.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSvgGeometry } from '../../svg/parseGeometry'
import { prepareParts } from '../core/prepare'
import {
  beginPlacementSession,
  placeWithOrder,
  placeWithPlan,
  type FreeAngleDepth,
} from '../placement/blf'
import { packedBoundsMm2 } from '../scoring/fitness'
import { buildOrderCandidates } from './orderSearch'
import { createRng } from './rng'
import { coarseFreeAngles } from './rotations'
import type { NestingRequest, NestingSettings, NestingSuccess } from '../types'

const DEMO = '/Users/ozgurnazimgurbuz/Desktop/Demo.svg'
const OUT = '/tmp/malt-nest-order-depth-profile.json'

const ORDER_SEARCH_LIMIT = 12
const FULL_REQUIRED = [
  'area_desc',
  'bbox_area_desc',
  'complexity_desc',
] as const

type DepthKey = 'deg0' | 'coarse' | 'medium' | 'full'

type Row = {
  name: string
  order: string[]
  deg0: number | null
  coarse: number | null
  medium: number | null
  full: number | null
  ms0: number
  msCoarse: number
  msMedium: number
  msFull: number
  /** Placement order + rotations from coarse run (for cheap Top-K polish). */
  coarsePlan: { order: string[]; rotations: number[] } | null
}

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
    timeLimitMs: 600_000,
    seed: 42,
    deterministic: false,
    allowPartInPart: false,
    dayamaX: true,
    dayamaY: true,
  }
}

function ranksBy(
  rows: Row[],
  key: 'deg0' | 'coarse' | 'medium' | 'full',
): Map<string, number> {
  const scored = rows
    .filter((r) => r[key] != null)
    .slice()
    .sort((a, b) => (a[key]! - b[key]!) || a.name.localeCompare(b.name))
  const map = new Map<string, number>()
  scored.forEach((r, i) => map.set(r.name, i + 1))
  return map
}

/** Spearman ρ on pairs that have both metrics. */
function spearman(
  rows: Row[],
  a: DepthKey,
  b: DepthKey,
): { rho: number | null; n: number } {
  const pairs = rows.filter((r) => r[a] != null && r[b] != null)
  const n = pairs.length
  if (n < 2) return { rho: null, n }
  const ra = ranksBy(
    pairs.map((p) => ({ ...p })),
    a === 'deg0' ? 'deg0' : a,
  )
  // rebuild ranks only on subset
  const rankA = new Map<string, number>()
  const rankB = new Map<string, number>()
  const byA = pairs.slice().sort((x, y) => x[a]! - y[a]!)
  const byB = pairs.slice().sort((x, y) => x[b]! - y[b]!)
  byA.forEach((r, i) => rankA.set(r.name, i + 1))
  byB.forEach((r, i) => rankB.set(r.name, i + 1))
  let sumD2 = 0
  for (const r of pairs) {
    const d = rankA.get(r.name)! - rankB.get(r.name)!
    sumD2 += d * d
  }
  void ra
  const rho = 1 - (6 * sumD2) / (n * (n * n - 1))
  return { rho: Number(rho.toFixed(4)), n }
}

function save(report: unknown) {
  writeFileSync(OUT, JSON.stringify(report, null, 2))
}

describe.skipIf(process.env.RUN_ORDER_DEPTH_PROFILE !== '1')(
  'Demo.svg order × depth correlation profile',
  () => {
    it(
      '0° / coarse / medium on 12 orders; full on representatives',
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

        beginPlacementSession()
        const prepared = prepareParts(geo.parts, nestSettings, {
          sortByArea: false,
        })
        const candidates = buildOrderCandidates(
          prepared,
          createRng(42),
          ORDER_SEARCH_LIMIT,
        )
        expect(candidates.length).toBe(12)
        for (const name of FULL_REQUIRED) {
          expect(candidates.some((c) => c.name === name)).toBe(true)
        }

        const rows: Row[] = candidates.map((c) => ({
          name: c.name,
          order: c.order,
          deg0: null,
          coarse: null,
          medium: null,
          full: null,
          ms0: 0,
          msCoarse: 0,
          msMedium: 0,
          msFull: 0,
          coarsePlan: null,
        }))
        const byName = new Map(rows.map((r) => [r.name, r]))

        const runDepth = (
          name: string,
          order: string[],
          depth: FreeAngleDepth | 'deg0',
        ): { bounds: number; ms: number; result: NestingSuccess } => {
          const t0 = performance.now()
          const placed =
            depth === 'deg0'
              ? placeWithPlan(
                  req,
                  { order, rotations: order.map(() => 0) },
                  { engineId: `prof-0-${name}` },
                )
              : placeWithOrder(req, order, {
                  freeAngleDepth: depth,
                  engineId: `prof-${depth}-${name}`,
                })
          const ms = performance.now() - t0
          if (placed.status !== 'ok') {
            throw new Error(`${name} @ ${depth} failed: ${placed.status}`)
          }
          return { bounds: packedBoundsMm2(placed), ms, result: placed }
        }

        // —— Phase A: 0° ——
        let ms0Total = 0
        for (const cand of candidates) {
          const r = byName.get(cand.name)!
          const out = runDepth(cand.name, cand.order, 'deg0')
          r.deg0 = out.bounds
          r.ms0 = out.ms
          ms0Total += out.ms
          // eslint-disable-next-line no-console
          console.log(
            `0° ${cand.name}: ${Math.round(out.bounds)} (${Math.round(out.ms)}ms)`,
          )
        }
        save({ phase: 'deg0_done', ms0Total: Math.round(ms0Total), rows })

        // —— Phase B: coarse ——
        let msCoarseTotal = 0
        for (const cand of candidates) {
          const r = byName.get(cand.name)!
          const out = runDepth(cand.name, cand.order, 'coarse')
          r.coarse = out.bounds
          r.msCoarse = out.ms
          msCoarseTotal += out.ms
          {
            const rotById = new Map(
              out.result.placements.map((p) => [p.partId, p.rotation]),
            )
            const order = [
              ...out.result.placements.map((p) => p.partId),
              ...cand.order.filter((id) => !rotById.has(id)),
            ]
            r.coarsePlan = {
              order,
              rotations: order.map((id) => rotById.get(id) ?? 0),
            }
          }
          // eslint-disable-next-line no-console
          console.log(
            `coarse ${cand.name}: ${Math.round(out.bounds)} (${Math.round(out.ms)}ms)`,
          )
          save({
            phase: 'coarse_progress',
            msCoarseTotal: Math.round(msCoarseTotal),
            rows,
          })
        }

        // —— Phase C: medium (15° → top-3@5°, no 1°) ——
        let msMediumTotal = 0
        for (const cand of candidates) {
          const r = byName.get(cand.name)!
          const out = runDepth(cand.name, cand.order, 'medium')
          r.medium = out.bounds
          r.msMedium = out.ms
          msMediumTotal += out.ms
          // eslint-disable-next-line no-console
          console.log(
            `medium ${cand.name}: ${Math.round(out.bounds)} (${Math.round(out.ms)}ms)`,
          )
          save({
            phase: 'medium_progress',
            msMediumTotal: Math.round(msMediumTotal),
            rows,
          })
        }

        // —— Phase D: full on required + medium top-3 extras ——
        const mediumRanked = rows
          .slice()
          .sort(
            (a, b) =>
              (a.medium ?? Infinity) - (b.medium ?? Infinity) ||
              a.name.localeCompare(b.name),
          )
        const fullNames = new Set<string>(FULL_REQUIRED)
        for (const r of mediumRanked.slice(0, 3)) fullNames.add(r.name)

        let msFullTotal = 0
        const fullResults = new Map<string, NestingSuccess>()
        for (const name of fullNames) {
          const r = byName.get(name)!
          const out = runDepth(name, r.order, 'full')
          r.full = out.bounds
          r.msFull = out.ms
          msFullTotal += out.ms
          fullResults.set(name, out.result)
          // eslint-disable-next-line no-console
          console.log(
            `full ${name}: ${Math.round(out.bounds)} (${Math.round(out.ms)}ms)`,
          )
          save({
            phase: 'full_progress',
            msFullTotal: Math.round(msFullTotal),
            rows,
          })
        }

        // —— Top-K seed polish only (Top-2 by 0°, reuse Phase-B coarse plans) ——
        const by0 = rows
          .slice()
          .sort(
            (a, b) =>
              (a.deg0 ?? Infinity) - (b.deg0 ?? Infinity) ||
              a.name.localeCompare(b.name),
          )
        const topK = by0.slice(0, 2)
        const tPol0 = performance.now()
        let bestPolishBounds = Infinity
        let bestPolishName = ''
        for (const trial of topK) {
          const plan = trial.coarsePlan
          if (!plan) continue
          const polished = placeWithPlan(
            req,
            plan,
            {
              polishFreeAngles: true,
              engineId: `prof-topk-polish-${trial.name}`,
            },
          )
          if (polished.status !== 'ok') continue
          const b = packedBoundsMm2(polished)
          if (b < bestPolishBounds) {
            bestPolishBounds = b
            bestPolishName = trial.name
          }
        }
        const msTopKPolish = performance.now() - tPol0

        const rank0 = ranksBy(rows, 'deg0')
        const rankC = ranksBy(rows, 'coarse')
        const rankM = ranksBy(rows, 'medium')
        const rankF = ranksBy(rows, 'full')

        const best = (key: 'deg0' | 'coarse' | 'medium' | 'full') => {
          const ranked = rows
            .filter((r) => r[key] != null)
            .sort((a, b) => a[key]! - b[key]!)
          return ranked[0]
            ? { name: ranked[0].name, bounds: Math.round(ranked[0][key]!) }
            : null
        }

        const report = {
          ok: true,
          note: 'Experiment only. medium = 15°→top-3@5° (no 1°). full only on required + medium top-3.',
          partCount: geo.partCount,
          sheet: '1600x1000',
          rows: rows.map((r) => ({
            name: r.name,
            deg0: r.deg0 != null ? Math.round(r.deg0) : null,
            coarse: r.coarse != null ? Math.round(r.coarse) : null,
            medium: r.medium != null ? Math.round(r.medium) : null,
            full: r.full != null ? Math.round(r.full) : null,
            ms0: Math.round(r.ms0),
            msCoarse: Math.round(r.msCoarse),
            msMedium: Math.round(r.msMedium),
            msFull: Math.round(r.msFull),
            rank0: rank0.get(r.name) ?? null,
            rankCoarse: rankC.get(r.name) ?? null,
            rankMedium: rankM.get(r.name) ?? null,
            rankFull: rankF.get(r.name) ?? null,
          })),
          area_desc_ranks: {
            deg0: rank0.get('area_desc') ?? null,
            coarse: rankC.get('area_desc') ?? null,
            medium: rankM.get('area_desc') ?? null,
            full: rankF.get('area_desc') ?? null,
          },
          correlation: {
            deg0_to_full: spearman(rows, 'deg0', 'full'),
            coarse_to_full: spearman(rows, 'coarse', 'full'),
            medium_to_full: spearman(rows, 'medium', 'full'),
            deg0_to_coarse: spearman(rows, 'deg0', 'coarse'),
            coarse_to_medium: spearman(rows, 'coarse', 'medium'),
            medium_to_full_all_medium_paired: spearman(rows, 'medium', 'full'),
          },
          ranking_winners: {
            full: best('full'),
            deg0: best('deg0'),
            coarse: best('coarse'),
            medium: best('medium'),
          },
          performance: {
            deg0_ms: Math.round(ms0Total),
            coarse_ms: Math.round(msCoarseTotal),
            medium_ms: Math.round(msMediumTotal),
            full_ms: Math.round(msFullTotal),
            full_orders: [...fullNames],
            topK_coarse_polish_ms: Math.round(msTopKPolish),
            topK_polish_best: {
              name: bestPolishName,
              bounds: Number.isFinite(bestPolishBounds)
                ? Math.round(bestPolishBounds)
                : null,
            },
            avg_ms: {
              deg0: Math.round(ms0Total / rows.length),
              coarse: Math.round(msCoarseTotal / rows.length),
              medium: Math.round(msMediumTotal / rows.length),
              full:
                fullNames.size > 0
                  ? Math.round(msFullTotal / fullNames.size)
                  : null,
            },
          },
        }

        save(report)
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(report, null, 2))

        expect(rows.every((r) => r.deg0 != null && r.coarse != null)).toBe(
          true,
        )
        expect(rankF.get('area_desc')).toBeTruthy()
      },
      3_600_000,
    )
  },
)
