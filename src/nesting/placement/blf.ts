import {
  beginNestingGeometrySession,
  findPartInPartPlacement,
  solidInsideRect,
  solidsCollide,
  type Solid,
} from '../../geometry'

/** Call once per nesting request (BLF or evolutionary) — not per gene. */
export function beginPlacementSession(): void {
  beginNestingGeometrySession()
}
import {
  findVariant,
  getOrCreateVariant,
  ifpBounds,
  prepareParts,
  variantWorldSolid,
  type PreparedPart,
  type PreparedVariant,
} from '../core/prepare'
import {
  BALANCED_ANGLES,
  freeAngleCascadeStages,
  usesFreeAngleCascade,
} from '../optimization/rotations'
import {
  beginBlfProfiling,
  blfProfileBeginPart,
  blfProfileBeginRotation,
  blfProfileEndPart,
  blfProfileEndRotation,
  endBlfProfiling,
  formatBlfProfileReport,
  isBlfProfiling,
} from '../../geometry/debug/blfProfiler'
import { collectPlacementCandidates } from '../nfp/candidates'
import type {
  NestingRequest,
  NestingResult,
  NestingSuccess,
  NestProgress,
  Placement,
  SheetResult,
} from '../types'
import {
  compareByPackBias,
  resolvePackBias,
  type PackBias,
} from './packBias'

export type FreeAngleDepth = 'quick' | 'coarse' | 'medium' | 'full' | 'seed'

export type BlfOptions = {
  onProgress?: (p: NestProgress) => void
  signal?: AbortSignal
  /** Override result.engineId */
  engineId?: string
  /** Stage 10B: enable BLF profiler (console report). */
  profile?: boolean
  /**
   * Free-angle search depth when rotationMode=free:
   * - quick: 45° grid (order ranking)
   * - coarse: 15° grid
   * - medium: coarse → top-3 refine @5° (no 1° final; profiling / cheap proxy)
   * - full: coarse → refine 5° → final 1°
   * - seed: refine around a gene angle (final polish)
   * Default for free mode: coarse (avoid 1° on every eval).
   * Production Stage 1 uses 'full'; Stage 2 uses 'coarse'/'seed'. 'medium' is opt-in.
   */
  freeAngleDepth?: FreeAngleDepth
  /**
   * Alias for freeAngleDepth='seed' on plan placements.
   * Off during GA evaluations; enable for final polish of top candidates.
   */
  polishFreeAngles?: boolean
}

/** Gene plan: placement order + per-part rotation (aligned with order). */
export type PlacementPlan = {
  order: string[]
  rotations: number[]
}

type SheetState = {
  index: number
  widthMm: number
  heightMm: number
  marginMm: number
  placed: Array<{ placement: Placement; solid: Solid; area: number }>
}

function expandSheetQueue(request: NestingRequest): Array<{
  widthMm: number
  heightMm: number
  marginMm: number
}> {
  const queue: Array<{ widthMm: number; heightMm: number; marginMm: number }> =
    []
  for (const def of request.sheets) {
    const q = Math.max(0, Math.floor(def.quantity))
    for (let i = 0; i < q; i++) {
      queue.push({
        widthMm: def.widthMm,
        heightMm: def.heightMm,
        marginMm: def.marginMm,
      })
    }
  }
  return queue
}

function isValidPlacement(
  solid: Solid,
  sheet: SheetState,
  spacingMm: number,
): boolean {
  const m = sheet.marginMm
  if (!solidInsideRect(solid, m, m, sheet.widthMm - m, sheet.heightMm - m)) {
    return false
  }
  for (const other of sheet.placed) {
    if (solidsCollide(solid, other.solid, spacingMm)) return false
  }
  return true
}

function tryPlaceOnSheet(
  variant: PreparedVariant,
  sheet: SheetState,
  spacingMm: number,
  allowPartInPart: boolean,
  signal?: AbortSignal,
  packBias?: PackBias,
): { x: number; y: number } | null {
  if (signal?.aborted) return null

  const profiling = isBlfProfiling()
  if (profiling) blfProfileBeginRotation(variant.rotation)
  const tRot = performance.now()

  const ifp = ifpBounds(variant, sheet.widthMm, sheet.heightMm, sheet.marginMm)
  if (!ifp) {
    if (profiling) {
      blfProfileEndRotation({
        candidates: 0,
        candidateGenMs: 0,
        accepted: false,
        totalMs: performance.now() - tRot,
      })
    }
    return null
  }

  const placedSolids = sheet.placed.map((p) => p.solid)
  const placedMeta = sheet.placed.map((p) => ({
    partId: p.placement.partId,
    rotation: p.placement.rotation,
  }))
  const tCand = performance.now()
  const candidates = collectPlacementCandidates(
    variant,
    placedSolids,
    ifp,
    spacingMm,
    placedMeta,
    signal,
    packBias,
  )
  const candidateGenMs = performance.now() - tCand

  let accepted: { x: number; y: number } | null = null
  for (let ci = 0; ci < candidates.length; ci++) {
    if (ci % 32 === 0 && signal?.aborted) break
    const t = candidates[ci]!
    const world = variantWorldSolid(variant, t.x, t.y)
    if (isValidPlacement(world, sheet, spacingMm)) {
      accepted = { x: t.x, y: t.y }
      break
    }
  }

  // Optional part-in-part: try fitting into holes of already-placed parts
  if (!accepted && allowPartInPart) {
    for (const other of sheet.placed) {
      if (signal?.aborted) break
      const fit = findPartInPartPlacement(
        other.solid,
        variant.solid,
        spacingMm,
      )
      if (!fit?.translation) continue
      const world = variantWorldSolid(
        variant,
        fit.translation.x,
        fit.translation.y,
      )
      if (isValidPlacement(world, sheet, spacingMm)) {
        accepted = { x: fit.translation.x, y: fit.translation.y }
        break
      }
    }
  }

  if (profiling) {
    blfProfileEndRotation({
      candidates: candidates.length,
      candidateGenMs,
      accepted: !!accepted,
      totalMs: performance.now() - tRot,
    })
  }
  return accepted
}

type PlaceCand = { variant: PreparedVariant; x: number; y: number }

/**
 * Rank successful placements: pack bias (compact top-left), then real rotated
 * solid AABB area (not unrotated axis-box), then span, then angle.
 */
function comparePlaceCand(a: PlaceCand, b: PlaceCand, bias: PackBias): number {
  const c = compareByPackBias(a, b, bias)
  if (c !== 0) return c
  const aArea = a.variant.width * a.variant.height
  const bArea = b.variant.width * b.variant.height
  if (aArea !== bArea) return aArea - bArea
  const aSpan = Math.max(a.variant.width, a.variant.height)
  const bSpan = Math.max(b.variant.width, b.variant.height)
  if (aSpan !== bSpan) return aSpan - bSpan
  return a.variant.rotation - b.variant.rotation
}

function evaluateAngles(
  part: PreparedPart,
  angles: readonly number[],
  sheet: SheetState,
  spacingMm: number,
  allowPartInPart: boolean,
  signal: AbortSignal | undefined,
  bias: PackBias,
): PlaceCand[] {
  const ok: PlaceCand[] = []
  const seen = new Set<number>()
  for (const ang of angles) {
    if (signal?.aborted) break
    const key = Math.round((((ang % 360) + 360) % 360) * 1000) / 1000
    if (seen.has(key)) continue
    seen.add(key)
    const v = getOrCreateVariant(part, ang)
    const pos = tryPlaceOnSheet(
      v,
      sheet,
      spacingMm,
      allowPartInPart,
      signal,
      bias,
    )
    if (pos) ok.push({ variant: v, ...pos })
  }
  ok.sort((a, b) => comparePlaceCand(a, b, bias))
  return ok
}

/**
 * Pick rotation + translation for a part.
 * Free cascade depths: coarse (15°) / full (→5°→1°) / seed (refine around gene).
 */
function pickBestVariant(
  part: PreparedPart,
  sheet: SheetState,
  spacingMm: number,
  allowPartInPart: boolean,
  signal: AbortSignal | undefined,
  packBias: PackBias | undefined,
  opts: {
    freeCascade: boolean
    depth: FreeAngleDepth
    seedRotation?: number
  },
): PlaceCand | null {
  const bias = resolvePackBias(packBias)

  if (!opts.freeCascade) {
    const angles = part.variants.map((v) => v.rotation)
    const ok = evaluateAngles(
      part,
      angles,
      sheet,
      spacingMm,
      allowPartInPart,
      signal,
      bias,
    )
    return ok[0] ?? null
  }

  const stages = freeAngleCascadeStages(
    opts.seedRotation != null ? [opts.seedRotation] : undefined,
  )
  const topK = 3

  let ok: PlaceCand[]
  if (opts.depth === 'seed' && opts.seedRotation != null) {
    ok = evaluateAngles(
      part,
      stages.refine([opts.seedRotation]),
      sheet,
      spacingMm,
      allowPartInPart,
      signal,
      bias,
    )
    if (!ok.length) {
      ok = evaluateAngles(
        part,
        [opts.seedRotation],
        sheet,
        spacingMm,
        allowPartInPart,
        signal,
        bias,
      )
    }
    if (!ok.length) {
      ok = evaluateAngles(
        part,
        stages.coarse.length > 1
          ? stages.coarse
          : freeAngleCascadeStages().coarse,
        sheet,
        spacingMm,
        allowPartInPart,
        signal,
        bias,
      )
    }
  } else {
    const grid =
      opts.depth === 'quick' ? [...BALANCED_ANGLES] : stages.coarse
    ok = evaluateAngles(
      part,
      grid,
      sheet,
      spacingMm,
      allowPartInPart,
      signal,
      bias,
    )
    if (
      (opts.depth === 'full' || opts.depth === 'medium') &&
      ok.length
    ) {
      const centers = ok.slice(0, topK).map((c) => c.variant.rotation)
      const refined = evaluateAngles(
        part,
        stages.refine(centers),
        sheet,
        spacingMm,
        allowPartInPart,
        signal,
        bias,
      )
      if (refined.length) ok = refined
    }
  }

  if (!ok.length) return null

  // medium stops after 5° refine — experiment proxy for full without 1° cost.
  if (
    opts.depth === 'coarse' ||
    opts.depth === 'quick' ||
    opts.depth === 'medium'
  ) {
    return ok[0]!
  }

  const finals = evaluateAngles(
    part,
    stages.final([ok[0]!.variant.rotation]),
    sheet,
    spacingMm,
    allowPartInPart,
    signal,
    bias,
  )
  if (finals.length) ok = finals
  return ok[0] ?? null
}

function commit(
  sheet: SheetState,
  partId: string,
  area: number,
  best: { variant: PreparedVariant; x: number; y: number },
): void {
  const world = variantWorldSolid(best.variant, best.x, best.y)
  sheet.placed.push({
    placement: {
      partId,
      sheetIndex: sheet.index,
      x: best.x,
      y: best.y,
      rotation: best.variant.rotation,
    },
    solid: world,
    area,
  })
}

function placeSequence(
  request: NestingRequest,
  sequence: Array<{ part: PreparedPart; variant: PreparedVariant | 'best' }>,
  options: BlfOptions,
  t0: number,
): NestingResult {
  const spacing = Math.max(0, request.settings.spacingMm)
  const allowPartInPart = request.settings.allowPartInPart === true
  const packBias = resolvePackBias({
    dayamaX: request.settings.dayamaX,
    dayamaY: request.settings.dayamaY,
  })
  const freeCascade = usesFreeAngleCascade(request.settings)
  const freeDepth: FreeAngleDepth = !freeCascade
    ? 'coarse'
    : options.polishFreeAngles
      ? 'seed'
      : (options.freeAngleDepth ?? 'coarse')
  const signal = options.signal
  const level = request.settings.optimizationLevel
  const partCount = sequence.length

  const snapshot = (
    sheets: SheetState[],
    unplacedIds: string[],
  ): NestingSuccess => {
    const placements = sheets.flatMap((s) => s.placed.map((p) => p.placement))
    return buildSuccess(
      request,
      sheets,
      placements,
      unplacedIds,
      t0,
      options.engineId ?? 'blf-nfp-v1',
    )
  }

  if (signal?.aborted) {
    return {
      status: 'cancelled',
      message: 'Cancelled',
      bestSoFar: null,
    }
  }

  const sheetQueue = expandSheetQueue(request)
  if (sheetQueue.length === 0) {
    return buildSuccess(
      request,
      [],
      [],
      sequence.map((s) => s.part.partId),
      t0,
      options.engineId ?? 'blf-nfp-v1',
    )
  }

  const sheets: SheetState[] = []
  const unplaced: string[] = []
  const total = sequence.length || 1

  for (let i = 0; i < sequence.length; i++) {
    if (signal?.aborted) {
      const remaining = sequence.slice(i).map((s) => s.part.partId)
      const bestSoFar = snapshot(sheets, [...unplaced, ...remaining])
      return {
        status: 'cancelled',
        message: 'Cancelled',
        bestSoFar,
      }
    }

    const { part, variant } = sequence[i]!
    let placed = false
    let sheetsTried = 0
    const tPart = performance.now()
    if (isBlfProfiling()) {
      const v0 = part.variants[0]!
      blfProfileBeginPart({
        index: i,
        partId: part.partId,
        vertexCount: v0.solid.outer.points.length,
        holeCount: v0.solid.holes.length,
        bbox: { w: v0.width, h: v0.height },
      })
    }

    const tryOn = (
      sheet: SheetState,
    ): { variant: PreparedVariant; x: number; y: number } | null => {
      sheetsTried += 1
      if (variant === 'best') {
        const depthForBest =
          freeDepth === 'seed' ? 'coarse' : freeDepth
        return pickBestVariant(
          part,
          sheet,
          spacing,
          allowPartInPart,
          signal,
          packBias,
          { freeCascade, depth: depthForBest },
        )
      }
      if (freeCascade && freeDepth === 'seed') {
        return pickBestVariant(
          part,
          sheet,
          spacing,
          allowPartInPart,
          signal,
          packBias,
          {
            freeCascade: true,
            depth: 'seed',
            seedRotation: variant.rotation,
          },
        )
      }
      const pos = tryPlaceOnSheet(
        variant,
        sheet,
        spacing,
        allowPartInPart,
        signal,
        packBias,
      )
      return pos ? { variant, ...pos } : null
    }

    for (const sheet of sheets) {
      if (signal?.aborted) break
      const best = tryOn(sheet)
      if (!best) continue
      commit(sheet, part.partId, part.area, best)
      placed = true
      break
    }

    if (!placed && !signal?.aborted && sheets.length < sheetQueue.length) {
      const def = sheetQueue[sheets.length]!
      const trial: SheetState = {
        index: sheets.length,
        widthMm: def.widthMm,
        heightMm: def.heightMm,
        marginMm: def.marginMm,
        placed: [],
      }
      const best = tryOn(trial)
      if (best) {
        commit(trial, part.partId, part.area, best)
        sheets.push(trial)
        placed = true
      }
    }

    if (isBlfProfiling()) {
      blfProfileEndPart({
        placed,
        placementMs: performance.now() - tPart,
        sheetsTried,
      })
    }

    if (signal?.aborted) {
      const remaining = sequence.slice(i).map((s) => s.part.partId)
      // Current part not committed → remaining includes it
      const bestSoFar = snapshot(sheets, [...unplaced, ...remaining])
      return {
        status: 'cancelled',
        message: 'Cancelled',
        bestSoFar,
      }
    }

    if (!placed) unplaced.push(part.partId)

    const placedCount = sheets.reduce((n, s) => n + s.placed.length, 0)
    const partial = snapshot(sheets, [
      ...unplaced,
      ...sequence.slice(i + 1).map((s) => s.part.partId),
    ])
    options.onProgress?.({
      ratio: 0.08 + (0.85 * (i + 1)) / total,
      phase: 'seed',
      placedCount,
      partCount,
      unplacedCount: unplaced.length + (partCount - (i + 1)),
      sheetCount: sheets.length,
      optimizationLevel: level,
      elapsedMs: performance.now() - t0,
      message: `BLF · ${placedCount} / ${partCount} parça · sheet ${sheets.length || 1}`,
      bestSoFar: partial,
    })
  }

  const placements = sheets.flatMap((s) => s.placed.map((p) => p.placement))
  return buildSuccess(
    request,
    sheets,
    placements,
    unplaced,
    t0,
    options.engineId ?? 'blf-nfp-v1',
  )
}

/** Stage 4 baseline: area-sorted order, best rotation per part. */
export function runBottomLeftNest(
  request: NestingRequest,
  options: BlfOptions = {},
): NestingResult {
  const t0 = performance.now()
  const shouldProfile =
    options.profile === true || request.settings.profileBlf === true
  if (shouldProfile) beginBlfProfiling()
  beginPlacementSession()
  options.onProgress?.({
    ratio: 0.02,
    phase: 'prepare',
    message: 'Preparing parts',
  })
  const prepared = prepareParts(request.parts, request.settings, {
    sortByArea: true,
  })
  options.onProgress?.({ ratio: 0.08, phase: 'seed', message: 'Placing parts' })
  const result = placeSequence(
    request,
    prepared.map((part) => ({ part, variant: 'best' as const })),
    options,
    t0,
  )
  if (result.status === 'ok') {
    options.onProgress?.({
      ratio: 0.96,
      phase: 'finalize',
      message: 'Finalizing',
    })
  }
  if (shouldProfile) {
    // eslint-disable-next-line no-console
    console.log(formatBlfProfileReport(9))
    endBlfProfiling()
  }
  return result
}

/**
 * Place parts in a fixed order, picking the best rotation per part (cheap/full/seed
 * via options.freeAngleDepth). Used for multi-order search.
 */
export function placeWithOrder(
  request: NestingRequest,
  order: string[],
  options: BlfOptions = {},
): NestingResult {
  const t0 = performance.now()
  const prepared = prepareParts(request.parts, request.settings, {
    sortByArea: false,
  })
  const byId = new Map(prepared.map((p) => [p.partId, p]))
  const sequence: Array<{ part: PreparedPart; variant: 'best' }> = []
  const seen = new Set<string>()
  for (const id of order) {
    const part = byId.get(id)
    if (!part || seen.has(id)) continue
    seen.add(id)
    sequence.push({ part, variant: 'best' })
  }
  for (const part of prepared) {
    if (seen.has(part.partId)) continue
    sequence.push({ part, variant: 'best' })
  }
  return placeSequence(
    request,
    sequence,
    { ...options, engineId: options.engineId ?? 'blf-order-v1' },
    t0,
  )
}

/**
 * Place parts using a fixed order + rotation gene (for evolutionary evaluation).
 * Uses the same geometry-aware BLF/NFP placer — not a second engine.
 */
export function placeWithPlan(
  request: NestingRequest,
  plan: PlacementPlan,
  options: BlfOptions = {},
): NestingResult {
  const t0 = performance.now()
  // Reuse shared NFP cache across gene evaluations (session opened by BLF baseline)
  const prepared = prepareParts(request.parts, request.settings, {
    sortByArea: false,
  })
  const byId = new Map(prepared.map((p) => [p.partId, p]))

  const sequence: Array<{ part: PreparedPart; variant: PreparedVariant }> = []
  for (let i = 0; i < plan.order.length; i++) {
    const id = plan.order[i]!
    const part = byId.get(id)
    if (!part) continue
    const rot = plan.rotations[i] ?? part.variants[0]?.rotation ?? 0
    const variant = findVariant(part, rot)
    if (!variant) continue
    sequence.push({ part, variant })
  }

  // Any prepared parts missing from plan go last unplaced-attempted
  for (const part of prepared) {
    if (!plan.order.includes(part.partId)) {
      const variant = part.variants[0]
      if (variant) sequence.push({ part, variant })
    }
  }

  return placeSequence(
    request,
    sequence,
    { ...options, engineId: options.engineId ?? 'blf-plan-v1' },
    t0,
  )
}

export function buildSuccess(
  request: NestingRequest,
  sheets: SheetState[],
  placements: Placement[],
  unplaced: string[],
  t0: number,
  engineId: string,
): NestingSuccess {
  const sheetResults: SheetResult[] = sheets.map((s) => {
    const partArea = s.placed.reduce((a, p) => a + p.area, 0)
    const usable =
      Math.max(0, s.widthMm - 2 * s.marginMm) *
      Math.max(0, s.heightMm - 2 * s.marginMm)
    const utilization = usable > 0 ? partArea / usable : 0
    let usedBounds: SheetResult['usedBounds'] = null
    if (s.placed.length) {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const p of s.placed) {
        const b = p.solid.bounds
        minX = Math.min(minX, b.minX)
        minY = Math.min(minY, b.minY)
        maxX = Math.max(maxX, b.maxX)
        maxY = Math.max(maxY, b.maxY)
      }
      usedBounds = { minX, minY, maxX, maxY }
    }
    return {
      sheetIndex: s.index,
      widthMm: s.widthMm,
      heightMm: s.heightMm,
      placedCount: s.placed.length,
      utilization,
      wasteMm2: Math.max(0, usable - partArea),
      usedBounds,
    }
  })

  const totalPartArea = request.parts.reduce((a, p) => a + p.area, 0)
  const placedArea = placements.reduce((a, pl) => {
    const part = request.parts.find((p) => p.id === pl.partId)
    return a + (part?.area ?? 0)
  }, 0)
  const totalSheetArea = sheetResults.reduce(
    (a, s) => a + Math.max(0, s.widthMm) * Math.max(0, s.heightMm),
    0,
  )
  const usableTotal = sheetResults.reduce((a, s) => {
    const m =
      sheets.find((x) => x.index === s.sheetIndex)?.marginMm ??
      request.sheets[0]?.marginMm ??
      0
    return (
      a + Math.max(0, s.widthMm - 2 * m) * Math.max(0, s.heightMm - 2 * m)
    )
  }, 0)
  const utilization = usableTotal > 0 ? placedArea / usableTotal : 0
  const wasteMm2 = Math.max(0, usableTotal - placedArea)

  return {
    status: 'ok',
    placements,
    sheets: sheetResults,
    unplacedPartIds: unplaced,
    utilization,
    wasteMm2,
    calculationTimeMs: performance.now() - t0,
    statistics: {
      partCount: request.parts.length,
      placedCount: placements.length,
      unplacedCount: unplaced.length,
      sheetCountUsed: sheetResults.length,
      totalPartAreaMm2: totalPartArea,
      totalSheetAreaMm2: totalSheetArea,
      overallUtilization: utilization,
      overallWasteMm2: wasteMm2,
    },
    engineId,
  }
}
