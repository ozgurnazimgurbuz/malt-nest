import type { BoundingBox, Point } from '../geometry/types'
import { bboxArea } from '../geometry'
import type { AnglePrecision, FreeAngleConfig } from './types'
import { DEFAULT_FREE_ANGLE } from './types'
import { canonicalizeAngle } from './angle'

/** Result of evaluating one angle through real placement (NFP + validate). */
export type AngleEval = {
  readonly angleDeg: number
  readonly ok: boolean
  readonly position?: Point
  readonly bounds?: BoundingBox
  /** Union packed AABB area with already-placed parts on the sheet (mm²). */
  readonly packedBoundsMm2?: number
}

export type FreeAngleSearchResult = {
  readonly best: AngleEval | null
  readonly anglesEvaluated: readonly number[]
  readonly evalCount: number
}

export function resolveFreeConfig(
  partial?: FreeAngleConfig,
): typeof DEFAULT_FREE_ANGLE {
  return {
    coarseStepDeg: partial?.coarseStepDeg ?? DEFAULT_FREE_ANGLE.coarseStepDeg,
    refineStepDeg: partial?.refineStepDeg ?? DEFAULT_FREE_ANGLE.refineStepDeg,
    finalStepDeg: partial?.finalStepDeg ?? DEFAULT_FREE_ANGLE.finalStepDeg,
    coarseTopK: partial?.coarseTopK ?? DEFAULT_FREE_ANGLE.coarseTopK,
    baselineAnglesDeg:
      partial?.baselineAnglesDeg ?? DEFAULT_FREE_ANGLE.baselineAnglesDeg,
    diversityCount: partial?.diversityCount ?? DEFAULT_FREE_ANGLE.diversityCount,
    baselineFloor: partial?.baselineFloor ?? DEFAULT_FREE_ANGLE.baselineFloor,
    precision: partial?.precision ?? DEFAULT_FREE_ANGLE.precision,
  }
}

/**
 * Compare placement quality at two angles.
 * 1 valid  2 min Y  3 min X  4 min packedBounds  5 min angle
 */
export function isBetterAngleEval(a: AngleEval, b: AngleEval): boolean {
  if (a.ok !== b.ok) return a.ok
  if (!a.ok) return false
  const ay = a.position!.y
  const by = b.position!.y
  if (ay !== by) return ay < by
  const ax = a.position!.x
  const bx = b.position!.x
  if (ax !== bx) return ax < bx
  const ap = a.packedBoundsMm2 ?? Infinity
  const bp = b.packedBoundsMm2 ?? Infinity
  if (ap !== bp) return ap < bp
  return a.angleDeg < b.angleDeg
}

export function sampleCircle(
  stepDeg: number,
  precision: AnglePrecision = DEFAULT_FREE_ANGLE.precision,
): number[] {
  const step = Math.max(1e-6, stepDeg)
  const out: number[] = []
  const seen = new Set<number>()
  for (let a = 0; a < 360 - 1e-9; a += step) {
    const c = canonicalizeAngle(a, precision)
    if (seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}

export function expandAround(
  centers: readonly number[],
  radiusDeg: number,
  stepDeg: number,
  precision: AnglePrecision = DEFAULT_FREE_ANGLE.precision,
): number[] {
  const step = Math.max(1e-6, stepDeg)
  const seen = new Set<number>()
  const out: number[] = []
  const push = (a: number) => {
    const c = canonicalizeAngle(a, precision)
    if (seen.has(c)) return
    seen.add(c)
    out.push(c)
  }
  for (const center of centers) {
    for (let d = -radiusDeg; d <= radiusDeg + 1e-12; d += step) {
      push(center + d)
    }
  }
  out.sort((a, b) => a - b)
  return out
}

/**
 * Coarse survivors: top-K by real placement score + baselines + diversity.
 * Baselines are always seeds even if that exact angle failed (refine may rescue).
 */
export function selectCoarseSeeds(
  evals: readonly AngleEval[],
  cfg: ReturnType<typeof resolveFreeConfig>,
): number[] {
  const prec = cfg.precision
  const seeds = new Set<number>()

  for (const b of cfg.baselineAnglesDeg) {
    seeds.add(canonicalizeAngle(b, prec))
  }

  const valid = evals.filter((e) => e.ok).sort((a, b) => {
    if (isBetterAngleEval(a, b)) return -1
    if (isBetterAngleEval(b, a)) return 1
    return 0
  })
  for (const e of valid.slice(0, cfg.coarseTopK)) {
    seeds.add(canonicalizeAngle(e.angleDeg, prec))
  }

  // Diversity: farthest valid angles from current seeds
  const remaining = valid
    .map((e) => canonicalizeAngle(e.angleDeg, prec))
    .filter((a) => !seeds.has(a))
  for (let i = 0; i < cfg.diversityCount && remaining.length; i++) {
    let bestIdx = 0
    let bestDist = -1
    for (let j = 0; j < remaining.length; j++) {
      const a = remaining[j]!
      let minD = Infinity
      for (const s of seeds) {
        const d = circularDistance(a, s)
        if (d < minD) minD = d
      }
      if (minD > bestDist) {
        bestDist = minD
        bestIdx = j
      }
    }
    seeds.add(remaining[bestIdx]!)
    remaining.splice(bestIdx, 1)
  }

  return [...seeds].sort((a, b) => a - b)
}

function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

/**
 * Deterministic free-angle cascade: coarse → refine → final.
 * `evaluate` must run real NFP + placement validation (not AABB-only).
 */
export function searchFreeAngle(
  evaluate: (angleDeg: number) => AngleEval,
  free?: FreeAngleConfig,
): FreeAngleSearchResult {
  const cfg = resolveFreeConfig(free)
  const evaluated = new Map<number, AngleEval>()
  const order: number[] = []

  const run = (angles: readonly number[]) => {
    for (const raw of angles) {
      const a = canonicalizeAngle(raw, cfg.precision)
      if (evaluated.has(a)) continue
      const ev = evaluate(a)
      const stored = { ...ev, angleDeg: a }
      evaluated.set(a, stored)
      order.push(a)
    }
  }

  // Stage A — coarse
  const coarse = sampleCircle(cfg.coarseStepDeg, cfg.precision)
  for (const b of cfg.baselineAnglesDeg) {
    const c = canonicalizeAngle(b, cfg.precision)
    if (!coarse.includes(c)) coarse.push(c)
  }
  coarse.sort((a, b) => a - b)
  run(coarse)

  const coarseEvals = coarse.map((a) => evaluated.get(a)!)
  const seeds = selectCoarseSeeds(coarseEvals, cfg)

  // Stage B — refine (±coarseStep @ refineStep)
  const refineAngles = expandAround(
    seeds,
    cfg.coarseStepDeg,
    cfg.refineStepDeg,
    cfg.precision,
  )
  run(refineAngles)

  // Final centers: refine grid + seeds + current best
  // (so ±1° around 5° reaches 7° when baseline seed is 0)
  let best: AngleEval | null = null
  for (const ev of evaluated.values()) {
    if (!best || isBetterAngleEval(ev, best)) best = ev
  }
  const finalCenters = new Set<number>([...seeds, ...refineAngles])
  if (best?.ok) finalCenters.add(best.angleDeg)

  // Stage C — final (±refineStep @ finalStep) around refine grid
  run(
    expandAround(
      [...finalCenters],
      cfg.refineStepDeg,
      cfg.finalStepDeg,
      cfg.precision,
    ),
  )

  best = null
  for (const ev of evaluated.values()) {
    if (!ev.ok) continue
    if (!best || isBetterAngleEval(ev, best)) best = ev
  }

  return {
    best,
    anglesEvaluated: order,
    evalCount: order.length,
  }
}

/** Packed AABB area of existing placements ∪ candidate bounds. */
export function unionPackedBoundsMm2(
  existing: readonly BoundingBox[],
  next: BoundingBox,
): number {
  let minX = next.minX
  let minY = next.minY
  let maxX = next.maxX
  let maxY = next.maxY
  for (const b of existing) {
    if (b.minX < minX) minX = b.minX
    if (b.minY < minY) minY = b.minY
    if (b.maxX > maxX) maxX = b.maxX
    if (b.maxY > maxY) maxY = b.maxY
  }
  return bboxArea({ minX, minY, maxX, maxY })
}
