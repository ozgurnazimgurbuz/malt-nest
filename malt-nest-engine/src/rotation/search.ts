import type { BoundingBox, Point } from '../geometry/types'
import { bboxArea } from '../geometry'
import type { AnglePrecision, FreeAngleConfig } from './types'
import { DEFAULT_FREE_ANGLE } from './types'
import { canonicalizeAngle, validateAnglePrecision } from './angle'

/** Per-stage resource bound; the three-stage cascade retains at most 3× this. */
const MAX_RECORDED_ANGLE_SAMPLES = 100_000

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
  const config = {
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
  validateAnglePrecision(config.precision)
  validateCircleStep('coarseStepDeg', config.coarseStepDeg, config.precision)
  validatePositiveStep('refineStepDeg', config.refineStepDeg, config.precision)
  validateCircleStep('finalStepDeg', config.finalStepDeg, config.precision)
  validateNonnegativeInteger('coarseTopK', config.coarseTopK)
  validateNonnegativeInteger('diversityCount', config.diversityCount)
  if (
    !Array.isArray(config.baselineAnglesDeg) ||
    config.baselineAnglesDeg.some((angle) => !Number.isFinite(angle))
  ) {
    throw new Error('free rotation baselineAnglesDeg must contain finite angles')
  }
  if (config.baselineAnglesDeg.length > MAX_RECORDED_ANGLE_SAMPLES) {
    throw new Error('free rotation baselineAnglesDeg creates too many samples')
  }
  const coarseCount = Math.ceil(360 / config.coarseStepDeg)
  const maxSelectedSeeds = Math.min(
    coarseCount + config.baselineAnglesDeg.length,
    config.baselineAnglesDeg.length + config.coarseTopK + config.diversityCount,
  )
  const refineOffsets =
    Math.floor((2 * config.coarseStepDeg) / config.refineStepDeg) + 2
  const maxRefineSamples = maxSelectedSeeds * refineOffsets
  if (
    !Number.isSafeInteger(maxRefineSamples) ||
    maxRefineSamples > MAX_RECORDED_ANGLE_SAMPLES
  ) {
    throw new Error('free rotation refinement creates too many angle samples')
  }
  return config
}

function validatePositiveStep(
  name: string,
  stepDeg: number,
  precision: AnglePrecision,
): void {
  if (!Number.isFinite(stepDeg) || stepDeg <= 0) {
    throw new Error(`free rotation ${name} must be finite and positive`)
  }
  const canonicalUnit = 10 ** -precision.decimals
  if (stepDeg < canonicalUnit) {
    throw new Error(
      `free rotation ${name} must be at least the ${canonicalUnit}° canonical precision`,
    )
  }
}

function validateCircleStep(
  name: string,
  stepDeg: number,
  precision: AnglePrecision,
): void {
  validatePositiveStep(name, stepDeg, precision)
  const sampleCount = Math.ceil(360 / stepDeg)
  if (
    !Number.isSafeInteger(sampleCount) ||
    sampleCount > MAX_RECORDED_ANGLE_SAMPLES
  ) {
    throw new Error(`free rotation ${name} creates too many angle samples`)
  }
}

function validateNonnegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`free rotation ${name} must be a nonnegative safe integer`)
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
  validateAnglePrecision(precision)
  validateCircleStep('stepDeg', stepDeg, precision)
  const out: number[] = []
  const seen = new Set<number>()
  const count = Math.ceil(360 / stepDeg)
  for (let index = 0; index < count; index++) {
    const a = index * stepDeg
    if (a >= 360) break
    const c = canonicalizeAngle(a, precision)
    if (seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}

function* streamCircle(
  stepDeg: number,
  precision: AnglePrecision,
): Generator<number> {
  validateAnglePrecision(precision)
  validateCircleStep('stepDeg', stepDeg, precision)
  const count = Math.ceil(360 / stepDeg)
  for (let index = 0; index < count; index++) {
    const angle = index * stepDeg
    if (angle >= 360) break
    yield canonicalizeAngle(angle, precision)
  }
}

export function expandAround(
  centers: readonly number[],
  radiusDeg: number,
  stepDeg: number,
  precision: AnglePrecision = DEFAULT_FREE_ANGLE.precision,
): number[] {
  validateAnglePrecision(precision)
  validatePositiveStep('stepDeg', stepDeg, precision)
  if (!Number.isFinite(radiusDeg) || radiusDeg < 0) {
    throw new Error('free rotation radiusDeg must be finite and nonnegative')
  }
  if (centers.some((center) => !Number.isFinite(center))) {
    throw new Error('free rotation centers must contain finite angles')
  }
  const offsetCount = Math.floor((2 * radiusDeg) / stepDeg) + 1
  const sampleCount = centers.length * (offsetCount + 1)
  if (
    !Number.isSafeInteger(offsetCount) ||
    !Number.isSafeInteger(sampleCount) ||
    sampleCount > MAX_RECORDED_ANGLE_SAMPLES
  ) {
    throw new Error('free rotation refinement creates too many angle samples')
  }
  const seen = new Set<number>()
  const out: number[] = []
  const push = (a: number) => {
    const c = canonicalizeAngle(a, precision)
    if (seen.has(c)) return
    seen.add(c)
    out.push(c)
  }
  for (const center of centers) {
    push(center)
    for (let index = 0; index < offsetCount; index++) {
      const d = -radiusDeg + index * stepDeg
      if (d > radiusDeg) break
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
  const evaluated = new Set<number>()
  const order: number[] = []
  let best: AngleEval | null = null

  const run = (angles: Iterable<number>, collect = false): AngleEval[] => {
    const collected: AngleEval[] = []
    for (const raw of angles) {
      const a = canonicalizeAngle(raw, cfg.precision)
      if (evaluated.has(a)) continue
      const ev = evaluate(a)
      const stored = { ...ev, angleDeg: a }
      evaluated.add(a)
      order.push(a)
      if (stored.ok && (!best || isBetterAngleEval(stored, best))) {
        best = stored
      }
      if (collect) collected.push(stored)
    }
    return collected
  }

  // Stage A — coarse
  const coarse = sampleCircle(cfg.coarseStepDeg, cfg.precision)
  for (const b of cfg.baselineAnglesDeg) {
    const c = canonicalizeAngle(b, cfg.precision)
    if (!coarse.includes(c)) coarse.push(c)
  }
  coarse.sort((a, b) => a - b)
  const coarseEvals = run(coarse, true)
  const seeds = selectCoarseSeeds(coarseEvals, cfg)

  // Stage B — refine (±coarseStep @ refineStep)
  const refineAngles = expandAround(
    seeds,
    cfg.coarseStepDeg,
    cfg.refineStepDeg,
    cfg.precision,
  )
  run(refineAngles)

  // Stage C — exhaustive final grid. This prevents narrow feasible intervals
  // outside coarse/refine survivors from being pruned before real placement.
  run(streamCircle(cfg.finalStepDeg, cfg.precision))

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
