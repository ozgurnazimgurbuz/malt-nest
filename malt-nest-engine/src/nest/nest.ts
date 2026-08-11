import { isValidShape } from '../geometry'
import type { Shape } from '../geometry/types'
import {
  DEFAULT_TOLERANCE,
  type GeometryTolerance,
} from '../geometry/tolerance'
import { DEFAULT_ORDERING, sortParts } from '../ordering'
import { createSheet, type Placement, type Sheet } from '../placement'
import {
  anglesForPolicy,
  DEFAULT_ROTATION,
  resolveFreeConfig,
  type RotationPolicy,
} from '../rotation'
import type { NfpResult } from '../nfp'
import {
  createNfpCache,
  createPlaceCounters,
  partDiagFromAttempt,
  placePartOnSheet,
  sheetContainerShape,
  type PlaceContext,
} from './place'
import { computeNestMetrics } from './metrics'
import type {
  NestConfig,
  NestDiagnostics,
  NestPartDiag,
  NestPlacement,
  NestResult,
  NestSheetResult,
  UnplacedPart,
} from './types'

/**
 * Deterministic nesting (BLF + NFP). Free-angle via RotationSearch when policy=free.
 * Optional baseline floor: keep orthogonal if free is worse.
 */
export function nest(
  parts: readonly Shape[],
  sheet: Sheet,
  config: NestConfig,
): NestResult {
  const rotation = config.rotation ?? DEFAULT_ROTATION
  validateNestInput(parts, sheet, config, rotation)

  if (rotation.kind === 'free') {
    const freeCfg = resolveFreeConfig(rotation.free)
    if (freeCfg.baselineFloor) {
      const freeResult = nestOnce(parts, sheet, {
        ...config,
        rotation: {
          kind: 'free',
          free: { ...rotation.free, baselineFloor: false },
        },
      })
      const orthoResult = nestOnce(parts, sheet, {
        ...config,
        rotation: { kind: 'orthogonal' },
      })
      return preferBaselineFloor(freeResult, orthoResult, rotation)
    }
  }

  return nestOnce(parts, sheet, config)
}

function nestOnce(
  parts: readonly Shape[],
  sheet: Sheet,
  config: NestConfig,
): NestResult {
  const t0 = performance.now()
  const ordering = config.ordering ?? DEFAULT_ORDERING
  const rotation = config.rotation ?? DEFAULT_ROTATION
  const gap = config.gap
  const tol = config.tolerance ?? DEFAULT_TOLERANCE
  const maxSheets = config.maxSheets ?? Math.max(1, parts.length)
  const debug = config.debug === true

  const ordered = sortParts(parts, ordering)
  const counters = createPlaceCounters()
  const nfpCache = createNfpCache<NfpResult>()
  const container = sheetContainerShape(sheet)

  const sheetStates: { sheet: Sheet; placements: NestPlacement[] }[] =
    parts.length > 0 ? [{ sheet, placements: [] }] : []
  const unplaced: UnplacedPart[] = []
  const partDiags: NestPartDiag[] = []

  for (const part of ordered) {
    if (!isValidShape(part, tol)) {
      unplaced.push({ shapeId: part.id, reason: 'invalid-geometry' })
      if (debug) {
        partDiags.push({
          shapeId: part.id,
          sheetIndex: null,
          rotationDeg: null,
          position: null,
          candidateCount: 0,
          rejectedCandidates: 0,
          rejectionReasons: { 'invalid-geometry': 1 },
        })
      }
      continue
    }

    let placedOk = false
    let lastFail: ReturnType<typeof placePartOnSheet> | null = null

    for (let si = 0; si < sheetStates.length; si++) {
      const state = sheetStates[si]!
      const ctx = makeCtx(
        state.sheet,
        state.placements,
        gap,
        tol,
        counters,
        nfpCache,
        container,
      )
      const attempt = placePartOnSheet(part, ctx, rotation)
      if (attempt.ok) {
        state.placements.push({ ...attempt.placement, sheetIndex: si })
        placedOk = true
        if (debug) {
          partDiags.push(
            partDiagFromAttempt(
              part.id,
              si,
              attempt,
              attempt.placement.position,
              attempt.rotationDeg,
            ),
          )
        }
        break
      }
      lastFail = attempt
    }

    if (placedOk) continue

    const tooLargeAlone =
      lastFail?.ok === false && lastFail.reason === 'too-large'

    if (!tooLargeAlone && sheetStates.length < maxSheets) {
      sheetStates.push({ sheet, placements: [] })
      const si = sheetStates.length - 1
      const state = sheetStates[si]!
      const ctx = makeCtx(
        state.sheet,
        state.placements,
        gap,
        tol,
        counters,
        nfpCache,
        container,
      )
      const attempt = placePartOnSheet(part, ctx, rotation)
      if (attempt.ok) {
        state.placements.push({ ...attempt.placement, sheetIndex: si })
        if (debug) {
          partDiags.push(
            partDiagFromAttempt(
              part.id,
              si,
              attempt,
              attempt.placement.position,
              attempt.rotationDeg,
            ),
          )
        }
        continue
      }
      lastFail = attempt
      if (state.placements.length === 0) sheetStates.pop()
    }

    const reason =
      lastFail && !lastFail.ok ? lastFail.reason : 'no-valid-placement'
    unplaced.push({
      shapeId: part.id,
      reason,
      detail: lastFail && !lastFail.ok ? lastFail.detail : undefined,
    })
    if (debug && lastFail) {
      partDiags.push(partDiagFromAttempt(part.id, null, lastFail, null, null))
    }
  }

  while (
    sheetStates.length > 0 &&
    sheetStates[sheetStates.length - 1]!.placements.length === 0
  ) {
    sheetStates.pop()
  }

  const sheets: NestSheetResult[] = sheetStates.map((s, i) => ({
    sheet: s.sheet,
    sheetIndex: i,
    placements: s.placements,
  }))
  const placements = sheets.flatMap((s) => s.placements)
  const metrics = computeNestMetrics(sheets, placements, unplaced.length)
  const cacheStats = nfpCache.stats
  const diagnostics: NestDiagnostics = {
    nfpComputeCount: counters.nfpComputeCount,
    validationCount: counters.validationCount,
    candidateCount: counters.candidateCount,
    rejectedCandidates: counters.rejectedCandidates,
    anglesEvaluated: counters.anglesEvaluated,
    cacheHits: cacheStats.hits,
    cacheMisses: cacheStats.misses,
    ...(debug ? { parts: partDiags } : {}),
  }

  return {
    sheets,
    placements,
    unplaced,
    metrics,
    runtimeMs: performance.now() - t0,
    diagnostics,
    config: { gap, ordering, rotation },
  }
}

/**
 * Prefer free if not worse than orthogonal.
 * Order: placed↓, sheets↑, packedBounds↑. Tie → free (requested policy).
 */
function preferBaselineFloor(
  free: NestResult,
  ortho: NestResult,
  requestedRotation: RotationPolicy,
): NestResult {
  const cmp = compareNestQuality(free, ortho)
  if (cmp < 0) {
    // free worse → keep orthogonal, annotate
    return {
      ...ortho,
      diagnostics: {
        ...ortho.diagnostics,
        ...sumAttemptCounters(free, ortho),
        baselineFloorApplied: true,
        baselineFloorKept: 'orthogonal',
        freeAngleAttempt: summarize(free),
      },
      runtimeMs: free.runtimeMs + ortho.runtimeMs,
      config: { ...ortho.config, rotation: requestedRotation },
    }
  }
  return {
    ...free,
    diagnostics: {
      ...free.diagnostics,
      ...sumAttemptCounters(free, ortho),
      baselineFloorApplied: true,
      baselineFloorKept: 'free',
      orthogonalAttempt: summarize(ortho),
    },
    runtimeMs: free.runtimeMs + ortho.runtimeMs,
    config: { ...free.config, rotation: requestedRotation },
  }
}

function compareNestQuality(a: NestResult, b: NestResult): number {
  // negative ⇒ a worse than b
  if (a.metrics.placedCount !== b.metrics.placedCount) {
    return a.metrics.placedCount < b.metrics.placedCount ? -1 : 1
  }
  if (a.metrics.sheetCount !== b.metrics.sheetCount) {
    return a.metrics.sheetCount > b.metrics.sheetCount ? -1 : 1
  }
  if (a.metrics.packedBoundsMm2 !== b.metrics.packedBoundsMm2) {
    return a.metrics.packedBoundsMm2 > b.metrics.packedBoundsMm2 ? -1 : 1
  }
  return 0
}

function summarize(r: NestResult) {
  return {
    placed: r.metrics.placedCount,
    sheets: r.metrics.sheetCount,
    packedBoundsMm2: r.metrics.packedBoundsMm2,
    runtimeMs: r.runtimeMs,
  }
}

function sumAttemptCounters(
  free: NestResult,
  ortho: NestResult,
): Pick<
  NestDiagnostics,
  | 'nfpComputeCount'
  | 'validationCount'
  | 'candidateCount'
  | 'rejectedCandidates'
  | 'anglesEvaluated'
  | 'cacheHits'
  | 'cacheMisses'
> {
  return {
    nfpComputeCount:
      free.diagnostics.nfpComputeCount + ortho.diagnostics.nfpComputeCount,
    validationCount:
      free.diagnostics.validationCount + ortho.diagnostics.validationCount,
    candidateCount:
      free.diagnostics.candidateCount + ortho.diagnostics.candidateCount,
    rejectedCandidates:
      free.diagnostics.rejectedCandidates +
      ortho.diagnostics.rejectedCandidates,
    anglesEvaluated:
      (free.diagnostics.anglesEvaluated ?? 0) +
      (ortho.diagnostics.anglesEvaluated ?? 0),
    cacheHits:
      (free.diagnostics.cacheHits ?? 0) + (ortho.diagnostics.cacheHits ?? 0),
    cacheMisses:
      (free.diagnostics.cacheMisses ?? 0) +
      (ortho.diagnostics.cacheMisses ?? 0),
  }
}

function makeCtx(
  sheet: Sheet,
  placed: readonly Placement[],
  gap: number,
  tolerance: GeometryTolerance,
  counters: ReturnType<typeof createPlaceCounters>,
  nfpCache: ReturnType<typeof createNfpCache<NfpResult>>,
  sheetContainer: Shape,
): PlaceContext {
  return {
    sheet,
    placed,
    gap,
    tolerance,
    counters,
    nfpCache,
    sheetContainer,
  }
}

function validateNestInput(
  parts: readonly Shape[],
  sheet: Sheet,
  config: NestConfig,
  rotation: RotationPolicy,
): void {
  createSheet(sheet.width, sheet.height, sheet.margin)
  if (!Number.isFinite(config.gap) || config.gap < 0) {
    throw new Error('NestConfig gap must be finite and nonnegative')
  }
  if (
    config.maxSheets !== undefined &&
    (!Number.isSafeInteger(config.maxSheets) || config.maxSheets <= 0)
  ) {
    throw new Error('NestConfig maxSheets must be a positive safe integer')
  }

  const ids = new Set<string>()
  for (const part of parts) {
    const id = part.id.trim()
    if (!id) throw new Error('Shape id must not be empty')
    if (ids.has(id)) throw new Error(`Duplicate shape id: "${part.id}"`)
    ids.add(id)
  }

  validateTolerance(config.tolerance ?? DEFAULT_TOLERANCE)
  if (rotation.kind === 'free') resolveFreeConfig(rotation.free)
  else anglesForPolicy(rotation)
}

function validateTolerance(tolerance: GeometryTolerance): void {
  const nonnegative = [
    tolerance.abs,
    tolerance.rel,
    tolerance.edgeMinLen2,
  ]
  if (nonnegative.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('NestConfig tolerance values must be finite and nonnegative')
  }
  if (
    !Number.isFinite(tolerance.curveTolerance) ||
    tolerance.curveTolerance <= 0 ||
    !Number.isFinite(tolerance.clipperScale) ||
    tolerance.clipperScale < 1e-8 ||
    tolerance.clipperScale > 1e8
  ) {
    throw new Error(
      'NestConfig tolerance curveTolerance must be positive and clipperScale must be within Clipper2 range [1e-8, 1e8]',
    )
  }
}

export type { RotationPolicy }
