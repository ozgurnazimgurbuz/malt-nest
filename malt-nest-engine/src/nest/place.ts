import { isValidShape, translateShape } from '../geometry'
import type { Point, Shape } from '../geometry/types'
import type { GeometryTolerance } from '../geometry/tolerance'
import {
  computeInnerNfp,
  computeOuterNfp,
  type NfpResult,
} from '../nfp'
import {
  createPlacement,
  validatePlacement,
  type Placement,
  type PlacementConfig,
  type Sheet,
} from '../placement'
import { validateKnownValidPlacement } from '../placement/validate'
import {
  anglesForPolicy,
  canonicalizeAngle,
  isBetterAngleEval,
  resolveFreeConfig,
  searchFreeAngle,
  unionPackedBoundsMm2,
  type AngleEval,
  type FreeAngleConfig,
  type RotationPolicy,
} from '../rotation'
import { DEFAULT_ANGLE_PRECISION } from '../rotation/types'
import { createNfpCache, makeNfpCacheKey, type NfpCache } from './cache'
import {
  collectCandidatesFromRegions,
  computeFreeRegions,
  sheetAabbFitCandidates,
  sheetContainerShape,
} from './freeRegion'
import type { NestPartDiag, UnplacedReason } from './types'

export type PlaceCounters = {
  nfpComputeCount: number
  validationCount: number
  candidateCount: number
  rejectedCandidates: number
  anglesEvaluated: number
}

export type PlaceAttempt =
  | {
      readonly ok: true
      readonly placement: Placement
      readonly rotationDeg: number
      readonly candidateCount: number
      readonly rejectedCandidates: number
      readonly rejectionReasons: Record<string, number>
      readonly anglesEvaluated: number
    }
  | {
      readonly ok: false
      readonly reason: UnplacedReason
      readonly detail?: string
      readonly candidateCount: number
      readonly rejectedCandidates: number
      readonly rejectionReasons: Record<string, number>
      readonly anglesEvaluated: number
    }

export type PlaceContext = {
  readonly sheet: Sheet
  readonly placed: readonly Placement[]
  readonly gap: number
  readonly tolerance: GeometryTolerance
  readonly counters: PlaceCounters
  readonly nfpCache: NfpCache<NfpResult>
  readonly sheetContainer: Shape
}

export function createPlaceCounters(): PlaceCounters {
  return {
    nfpComputeCount: 0,
    validationCount: 0,
    candidateCount: 0,
    rejectedCandidates: 0,
    anglesEvaluated: 0,
  }
}

/** Evaluate a single angle with NFP candidates + validatePlacement. */
export function evaluateAngleOnSheet(
  part: Shape,
  ctx: PlaceContext,
  rotRaw: number,
  precision = DEFAULT_ANGLE_PRECISION,
): {
  eval: AngleEval
  placement: Placement | null
  candidateCount: number
  rejected: number
  reasons: Record<string, number>
} {
  const rot = canonicalizeAngle(rotRaw, precision)
  const config: PlacementConfig = {
    gap: ctx.gap,
    tolerance: ctx.tolerance,
  }
  const reasons: Record<string, number> = {}
  let rejected = 0

  ctx.counters.anglesEvaluated++
  const orbiting = createPlacement(
    part,
    { x: 0, y: 0 },
    rot,
    ctx.tolerance,
  ).geometry
  if (!isValidShape(orbiting, ctx.tolerance)) {
    return {
      eval: { angleDeg: rot, ok: false },
      placement: null,
      candidateCount: 0,
      rejected: 0,
      reasons: { 'invalid-geometry': 1 },
    }
  }
  const ifp = getInnerNfp(ctx, orbiting, rot, precision)
  const forbidden: NfpResult[] = []
  for (const p of ctx.placed) {
    forbidden.push(getOuterNfp(ctx, p, orbiting, rot, precision))
  }

  const candidates =
    ifp.regions.length > 0
      ? collectCandidatesFromRegions(
          computeFreeRegions(ifp, forbidden, ctx.tolerance),
        )
      : []
  appendUniqueCandidates(
    candidates,
    sheetAabbFitCandidates(orbiting, ctx.sheet, ctx.tolerance),
  )
  appendUniqueCandidates(candidates, ifp.contactPoints ?? [])
  for (const nfp of forbidden) {
    appendUniqueCandidates(candidates, nfp.contactPoints ?? [])
  }
  candidates.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x))

  const candidateCount = candidates.length
  ctx.counters.candidateCount += candidates.length

  for (const pos of candidates) {
    const placement = createPlacement(part, pos, rot, ctx.tolerance)
    ctx.counters.validationCount++
    const v = validateKnownValidPlacement(
      placement,
      ctx.sheet,
      ctx.placed,
      config,
    )
    if (!v.valid) {
      rejected++
      ctx.counters.rejectedCandidates++
      reasons[v.reason] = (reasons[v.reason] ?? 0) + 1
      continue
    }
    return {
      eval: {
        angleDeg: rot,
        ok: true,
        position: placement.position,
        bounds: placement.bounds,
        packedBoundsMm2: unionPackedBoundsMm2(
          ctx.placed.map((p) => p.bounds),
          placement.bounds,
        ),
      },
      placement,
      candidateCount,
      rejected,
      reasons,
    }
  }

  return {
    eval: { angleDeg: rot, ok: false },
    placement: null,
    candidateCount,
    rejected,
    reasons,
  }
}

/**
 * Place one part: discrete angle list OR free-angle cascade via RotationSearch.
 */
export function placePartOnSheet(
  part: Shape,
  ctx: PlaceContext,
  rotation: RotationPolicy,
): PlaceAttempt {
  if (rotation.kind === 'free') {
    return placeWithFreeSearch(part, ctx, rotation.free)
  }
  return placeWithDiscreteAngles(part, ctx, anglesForPolicy(rotation))
}

function placeWithDiscreteAngles(
  part: Shape,
  ctx: PlaceContext,
  angles: readonly number[],
): PlaceAttempt {
  let bestPlacement: Placement | null = null
  let bestEval: AngleEval | null = null
  let totalCand = 0
  let totalRej = 0
  const rejectionReasons: Record<string, number> = {}
  let anglesTried = 0

  for (const rot of angles) {
    const r = evaluateAngleOnSheet(part, ctx, rot)
    anglesTried++
    totalCand += r.candidateCount
    totalRej += r.rejected
    for (const [k, v] of Object.entries(r.reasons)) {
      rejectionReasons[k] = (rejectionReasons[k] ?? 0) + v
    }
    if (r.eval.ok && r.placement) {
      if (!bestEval || isBetterAngleEval(r.eval, bestEval)) {
        bestEval = r.eval
        bestPlacement = r.placement
      }
    }
  }

  if (bestPlacement && bestEval) {
    return {
      ok: true,
      placement: bestPlacement,
      rotationDeg: bestEval.angleDeg,
      candidateCount: totalCand,
      rejectedCandidates: totalRej,
      rejectionReasons,
      anglesEvaluated: anglesTried,
    }
  }

  if (totalCand === 0) {
    return {
      ok: false,
      reason: ctx.placed.length === 0 ? 'too-large' : 'no-valid-placement',
      detail:
        ctx.placed.length === 0
          ? 'no inner-fit for any rotation'
          : 'no free candidates with existing placements',
      candidateCount: totalCand,
      rejectedCandidates: totalRej,
      rejectionReasons,
      anglesEvaluated: anglesTried,
    }
  }

  return {
    ok: false,
    reason: 'no-valid-placement',
    detail: 'candidates rejected or empty free region',
    candidateCount: totalCand,
    rejectedCandidates: totalRej,
    rejectionReasons,
    anglesEvaluated: anglesTried,
  }
}

function placeWithFreeSearch(
  part: Shape,
  ctx: PlaceContext,
  free?: FreeAngleConfig,
): PlaceAttempt {
  const resolved = resolveFreeConfig(free)
  let totalCand = 0
  let totalRej = 0
  const rejectionReasons: Record<string, number> = {}

  const searched = searchFreeAngle((angleDeg) => {
    const r = evaluateAngleOnSheet(part, ctx, angleDeg, resolved.precision)
    totalCand += r.candidateCount
    totalRej += r.rejected
    for (const [k, v] of Object.entries(r.reasons)) {
      rejectionReasons[k] = (rejectionReasons[k] ?? 0) + v
    }
    return r.eval
  }, resolved)

  const best = searched.best
  if (best?.ok) {
    const placement = createPlacement(
      part,
      best.position!,
      best.angleDeg,
      ctx.tolerance,
    )
    ctx.counters.validationCount++
    const validation = validatePlacement(placement, ctx.sheet, ctx.placed, {
      gap: ctx.gap,
      tolerance: ctx.tolerance,
    })
    if (validation.valid) {
      return {
        ok: true,
        placement,
        rotationDeg: best.angleDeg,
        candidateCount: totalCand,
        rejectedCandidates: totalRej,
        rejectionReasons,
        anglesEvaluated: searched.evalCount,
      }
    }
    totalRej++
    ctx.counters.rejectedCandidates++
    rejectionReasons[validation.reason] =
      (rejectionReasons[validation.reason] ?? 0) + 1
  }

  if (totalCand === 0) {
    return {
      ok: false,
      reason: ctx.placed.length === 0 ? 'too-large' : 'no-valid-placement',
      detail:
        ctx.placed.length === 0
          ? 'no inner-fit for any free-angle sample'
          : 'no free candidates with existing placements',
      candidateCount: totalCand,
      rejectedCandidates: totalRej,
      rejectionReasons,
      anglesEvaluated: searched.evalCount,
    }
  }

  return {
    ok: false,
    reason: 'no-valid-placement',
    detail: 'free-angle candidates rejected',
    candidateCount: totalCand,
    rejectedCandidates: totalRej,
    rejectionReasons,
    anglesEvaluated: searched.evalCount,
  }
}

function getInnerNfp(
  ctx: PlaceContext,
  orbiting: Shape,
  rot: number,
  precision = DEFAULT_ANGLE_PRECISION,
): NfpResult {
  const key = makeNfpCacheKey({
    kind: 'inner',
    stationaryId: ctx.sheetContainer.id,
    orbitingId: orbiting.id,
    rotationStationaryDeg: 0,
    rotationOrbitingDeg: rot,
    gap: 0,
    precision,
    stationaryGeometry: ctx.sheetContainer,
    orbitingGeometry: orbiting,
    tolerance: ctx.tolerance,
  })
  const hit = ctx.nfpCache.get(key)
  if (hit) return hit
  ctx.counters.nfpComputeCount++
  const nfp = computeInnerNfp(ctx.sheetContainer, orbiting, {
    gap: 0,
    tolerance: ctx.tolerance,
  })
  ctx.nfpCache.set(key, nfp)
  return nfp
}

function getOuterNfp(
  ctx: PlaceContext,
  placed: Placement,
  orbiting: Shape,
  rot: number,
  precision = DEFAULT_ANGLE_PRECISION,
): NfpResult {
  const localStationary = translateShape(
    placed.geometry,
    -placed.position.x,
    -placed.position.y,
  )
  const key = makeNfpCacheKey({
    kind: 'outer',
    stationaryId: placed.shapeId,
    orbitingId: orbiting.id,
    rotationStationaryDeg: placed.rotationDeg,
    rotationOrbitingDeg: rot,
    gap: ctx.gap,
    precision,
    stationaryGeometry: localStationary,
    orbitingGeometry: orbiting,
    tolerance: ctx.tolerance,
  })
  const hit = ctx.nfpCache.get(key)
  if (hit) {
    return translateNfp(hit, placed.position, placed.shapeId)
  }
  ctx.counters.nfpComputeCount++
  const nfp = computeOuterNfp(localStationary, orbiting, {
    gap: ctx.gap,
    tolerance: ctx.tolerance,
  })
  ctx.nfpCache.set(key, nfp)
  return translateNfp(nfp, placed.position, placed.shapeId)
}

function translateNfp(
  nfp: NfpResult,
  offset: Point,
  stationaryId: string,
): NfpResult {
  const moveRing = (ring: readonly Point[]) =>
    ring.map((point) => ({
      x: point.x + offset.x,
      y: point.y + offset.y,
    }))
  return {
    ...nfp,
    stationaryId,
    regions: nfp.regions.map((region) => ({
      outer: moveRing(region.outer),
      holes: region.holes.map(moveRing),
    })),
    contactPoints: nfp.contactPoints?.map((point) => ({
      x: point.x + offset.x,
      y: point.y + offset.y,
    })),
    bounds: nfp.bounds
      ? {
          minX: nfp.bounds.minX + offset.x,
          minY: nfp.bounds.minY + offset.y,
          maxX: nfp.bounds.maxX + offset.x,
          maxY: nfp.bounds.maxY + offset.y,
        }
      : null,
  }
}

export function partDiagFromAttempt(
  shapeId: string,
  sheetIndex: number | null,
  attempt: PlaceAttempt,
  position: Point | null,
  rotationDeg: number | null,
): NestPartDiag {
  return {
    shapeId,
    sheetIndex,
    rotationDeg,
    position,
    candidateCount: attempt.candidateCount,
    rejectedCandidates: attempt.rejectedCandidates,
    rejectionReasons: attempt.rejectionReasons,
  }
}

function appendUniqueCandidates(target: Point[], extra: readonly Point[]): void {
  const seen = new Set(
    target.map((point) => `${point.x},${point.y}`),
  )
  for (const point of extra) {
    const key = `${point.x},${point.y}`
    if (seen.has(key)) continue
    seen.add(key)
    target.push(point)
  }
}

export { createNfpCache, sheetContainerShape }
