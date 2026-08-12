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
  createVariant,
  findVariant,
  ifpBounds,
  prepareParts,
  rotationDimensions,
  variantWorldSolid,
  type PreparedPart,
  type PreparedVariant,
} from '../core/prepare'
import {
  BALANCED_ANGLES,
  coarseFreeAngles,
  freeAngleCascadeStages,
  usesFreeAngleCascade,
} from '../optimization/rotations'
import { validateNestingRequest } from '../core/validate'
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
  NestAttempt,
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
  onAttempt?: (attempt: NestAttempt) => void
  onAttemptFlush?: () => void
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
   * - full: exhaustive 0°..359° at 1°, with exact NFP geometry
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
  /** Exact for canonical discrete/full placement; simplified only for cheap ranking. */
  nfpFidelity?: 'simplified' | 'exact'
  exactFallback?: boolean
  /** Diagnostic observer used by tests/profiling. */
  onExactFallback?: (partId: string) => void
  /** Internal optimizer reuse; must correspond to this request. */
  preparedParts?: readonly PreparedPart[]
}

/** Gene plan: placement order + per-part rotation (aligned with order). */
export type PlacementPlan = {
  order: string[]
  rotations: number[]
}

function validatePlacementPlan(plan: PlacementPlan): void {
  const seen = new Set<string>()
  for (const id of plan.order) {
    if (seen.has(id)) throw new TypeError(`Plan contains duplicate part ID ${id}`)
    seen.add(id)
  }
  if (plan.rotations.some((rotation) => !Number.isFinite(rotation))) {
    throw new RangeError('Plan rotation values must be finite')
  }
}

type SheetState = {
  index: number
  widthMm: number
  heightMm: number
  marginMm: number
  placed: Array<{ placement: Placement; solid: Solid; area: number }>
}

type SheetStock = {
  widthMm: number
  heightMm: number
  marginMm: number
  remaining: number
}

function buildSheetStock(request: NestingRequest): SheetStock[] {
  const merged = new Map<string, SheetStock>()
  for (const def of request.sheets) {
    const key = `${def.widthMm},${def.heightMm},${def.marginMm}`
    const existing = merged.get(key)
    if (existing) {
      existing.remaining = Math.min(
        request.parts.length,
        existing.remaining + def.quantity,
      )
      continue
    }
    merged.set(key, {
      widthMm: def.widthMm,
      heightMm: def.heightMm,
      marginMm: def.marginMm,
      remaining: Math.min(def.quantity, request.parts.length),
    })
  }
  return [...merged.values()]
}

type SequenceEntry = {
  part: PreparedPart
  variant: PreparedVariant | 'best'
}

type FitDimensions = { width: number; height: number }

function freeAngleDimensions(part: PreparedPart): FitDimensions[] {
  return coarseFreeAngles(1).map((angle) => rotationDimensions(part, angle))
}

function entryFitsEmptyStock(
  entry: SequenceEntry,
  stock: SheetStock,
  freeDimensions?: FitDimensions[],
): boolean {
  const width = stock.widthMm - stock.marginMm * 2
  const height = stock.heightMm - stock.marginMm * 2
  if (freeDimensions) {
    return freeDimensions.some(
      (variant) =>
        variant.width <= width + 1e-9 && variant.height <= height + 1e-9,
    )
  }
  if (entry.variant !== 'best') {
    return (
      entry.variant.width <= width + 1e-9 &&
      entry.variant.height <= height + 1e-9
    )
  }
  return entry.part.rotations.some((rotation) => {
    const dimensions = rotationDimensions(entry.part, rotation)
    return (
      dimensions.width <= width + 1e-9 &&
      dimensions.height <= height + 1e-9
    )
  })
}

/**
 * Capacity-aware maximum matching over stock types (never per-sheet slots).
 * Current is augmented first, so later reroutes preserve a maximum assignment
 * that includes the part we must place now.
 */
function chooseStockByFutureMatching(
  sequence: SequenceEntry[],
  start: number,
  stock: SheetStock[],
  compatibility: boolean[][],
  currentPreference: number[],
  signal?: AbortSignal,
): number | null {
  if (currentPreference.length === 0) return null
  const assignedStock = new Int32Array(sequence.length)
  assignedStock.fill(-1)
  const assignedParts = stock.map(() => new Set<number>())

  const augment = (root: number): boolean => {
    const queue = [root]
    const seenParts = new Uint8Array(sequence.length)
    const seenStocks = new Uint8Array(stock.length)
    const parentPart = new Int32Array(stock.length)
    parentPart.fill(-1)
    seenParts[root] = 1

    for (let head = 0; head < queue.length; head++) {
      if (signal?.aborted) return false
      const partIndex = queue[head]!
      const choices =
        partIndex === start
          ? currentPreference
          : stock
              .map((_item, stockIndex) => stockIndex)
              .filter((stockIndex) => compatibility[partIndex]![stockIndex])
      for (const stockIndex of choices) {
        if (signal?.aborted) return false
        if (
          seenStocks[stockIndex] ||
          stock[stockIndex]!.remaining <= 0 ||
          !compatibility[partIndex]![stockIndex]
        ) {
          continue
        }
        seenStocks[stockIndex] = 1
        parentPart[stockIndex] = partIndex
        if (assignedParts[stockIndex]!.size < stock[stockIndex]!.remaining) {
          let destination = stockIndex
          while (destination >= 0) {
            const movingPart = parentPart[destination]!
            const previous = assignedStock[movingPart]!
            if (previous >= 0) assignedParts[previous]!.delete(movingPart)
            assignedParts[destination]!.add(movingPart)
            assignedStock[movingPart] = destination
            destination = previous
          }
          return true
        }
        for (const matchedPart of assignedParts[stockIndex]!) {
          if (seenParts[matchedPart]) continue
          seenParts[matchedPart] = 1
          queue.push(matchedPart)
        }
      }
    }
    return false
  }

  for (let partIndex = start; partIndex < sequence.length; partIndex++) {
    if (signal?.aborted) break
    augment(partIndex)
  }
  const chosen = assignedStock[start]!
  return chosen >= 0 ? chosen : null
}

/** Matching is exact when area proves no sheet can hold two relevant parts. */
function mayShareFutureSheet(
  sequence: SequenceEntry[],
  start: number,
  stock: SheetStock[],
  compatibility: boolean[][],
  currentArea: number,
  candidateStocks: Set<number>,
): boolean {
  for (let stockIndex = 0; stockIndex < stock.length; stockIndex++) {
    if (stock[stockIndex]!.remaining <= 0) continue
    const usableArea =
      (stock[stockIndex]!.widthMm - stock[stockIndex]!.marginMm * 2) *
      (stock[stockIndex]!.heightMm - stock[stockIndex]!.marginMm * 2)
    let smallest = Infinity
    let second = Infinity
    for (let partIndex = start; partIndex < sequence.length; partIndex++) {
      if (!compatibility[partIndex]![stockIndex]) continue
      const area = sequence[partIndex]!.part.area
      if (area < smallest) {
        second = smallest
        smallest = area
      } else if (area < second) {
        second = area
      }
    }
    if (
      (candidateStocks.has(stockIndex) &&
        currentArea + smallest <= usableArea + 1e-9) ||
      smallest + second <= usableArea + 1e-9
    ) {
      return true
    }
  }
  return false
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
  exactNfp = false,
  onAttempt?: (attempt: Omit<NestAttempt, 'sequence'>) => void,
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
    exactNfp,
  )
  const candidateGenMs = performance.now() - tCand

  let accepted: { x: number; y: number } | null = null
  for (let ci = 0; ci < candidates.length; ci++) {
    if (ci % 32 === 0 && signal?.aborted) break
    const t = candidates[ci]!
    const world = variantWorldSolid(variant, t.x, t.y)
    const valid = isValidPlacement(world, sheet, spacingMm)
    onAttempt?.({
      partId: variant.partId,
      sheetIndex: sheet.index,
      x: t.x,
      y: t.y,
      rotation: variant.rotation,
      verdict: valid ? 'accepted' : 'rejected',
    })
    if (valid) {
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
        placedSolids,
        signal,
      )
      if (!fit?.translation) continue
      const world = variantWorldSolid(
        variant,
        fit.translation.x,
        fit.translation.y,
      )
      const valid = isValidPlacement(world, sheet, spacingMm)
      onAttempt?.({
        partId: variant.partId,
        sheetIndex: sheet.index,
        x: fit.translation.x,
        y: fit.translation.y,
        rotation: variant.rotation,
        verdict: valid ? 'accepted' : 'rejected',
      })
      if (valid) {
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
  exactNfp: boolean,
  onAttempt: ((attempt: Omit<NestAttempt, 'sequence'>) => void) | undefined,
  keep = 1,
): PlaceCand[] {
  const ok: PlaceCand[] = []
  const seen = new Set<number>()
  for (const ang of angles) {
    if (signal?.aborted) break
    const remainder = ang % 360
    const key = remainder < 0 ? remainder + 360 : remainder || 0
    if (seen.has(key)) continue
    seen.add(key)
    const v = createVariant(part, ang)
    const pos = tryPlaceOnSheet(
      v,
      sheet,
      spacingMm,
      allowPartInPart,
      signal,
      bias,
      exactNfp,
      onAttempt,
    )
    if (pos) {
      ok.push({ variant: v, ...pos })
      ok.sort((a, b) => comparePlaceCand(a, b, bias))
      if (ok.length > keep) ok.length = keep
    }
  }
  return ok
}

/**
 * Pick rotation + translation for a part.
 * Free depths: coarse (15°) / full (exhaustive 1°) / seed (refine around gene).
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
    exactNfp: boolean
    onAttempt?: (attempt: Omit<NestAttempt, 'sequence'>) => void
  },
): PlaceCand | null {
  const bias = resolvePackBias(packBias)
  const exactNfp = opts.exactNfp

  if (!opts.freeCascade) {
    const angles = part.rotations
    const ok = evaluateAngles(
      part,
      angles,
      sheet,
      spacingMm,
      allowPartInPart,
      signal,
      bias,
      exactNfp,
      opts.onAttempt,
    )
    return ok[0] ?? null
  }

  if (opts.depth === 'full') {
    const ok = evaluateAngles(
      part,
      coarseFreeAngles(1),
      sheet,
      spacingMm,
      allowPartInPart,
      signal,
      bias,
      exactNfp,
      opts.onAttempt,
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
      exactNfp,
      opts.onAttempt,
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
        exactNfp,
        opts.onAttempt,
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
        exactNfp,
        opts.onAttempt,
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
      exactNfp,
      opts.onAttempt,
      opts.depth === 'medium' ? topK : 1,
    )
    if (
      opts.depth === 'medium' && ok.length
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
        exactNfp,
        opts.onAttempt,
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
    exactNfp,
    opts.onAttempt,
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
  sequence: SequenceEntry[],
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
  const exactNfp =
    options.nfpFidelity === 'exact' ||
    (options.nfpFidelity == null && (freeDepth === 'full' || !freeCascade))
  const signal = options.signal
  const level = request.settings.optimizationLevel
  const partCount = sequence.length
  let attemptSequence = 0
  const emitAttempt = options.onAttempt
    ? (attempt: Omit<NestAttempt, 'sequence'>) => {
        try {
          options.onAttempt?.({ sequence: attemptSequence++, ...attempt })
        } catch {
          // Debug telemetry must never alter nesting.
        }
      }
    : undefined
  const flushAttempts = () => {
    try {
      options.onAttemptFlush?.()
    } catch {
      // Debug telemetry must never alter nesting.
    }
  }

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

  const sheetStock = buildSheetStock(request)
  if (sheetStock.length === 0) {
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
  const freeDimensionCache = new Map<PreparedPart, FitDimensions[]>()
  const fitsStock = (entry: SequenceEntry, stock: SheetStock): boolean => {
    let dimensions: FitDimensions[] | undefined
    if (freeCascade && entry.variant === 'best') {
      dimensions = freeDimensionCache.get(entry.part)
      if (!dimensions) {
        dimensions = freeAngleDimensions(entry.part)
        freeDimensionCache.set(entry.part, dimensions)
      }
    }
    return entryFitsEmptyStock(entry, stock, dimensions)
  }
  const stockCompatibility = sequence.map((entry) =>
    sheetStock.map((stock) => fitsStock(entry, stock)),
  )

  const findEntryPlacement = (
    entry: SequenceEntry,
    sheet: SheetState,
    onAttempt: ((attempt: Omit<NestAttempt, 'sequence'>) => void) | undefined,
  ): PlaceCand | null => {
    const { part, variant } = entry
    const find = (useExactNfp: boolean): PlaceCand | null => {
      if (variant === 'best') {
        const depthForBest = freeDepth === 'seed' ? 'coarse' : freeDepth
        return pickBestVariant(
          part,
          sheet,
          spacing,
          allowPartInPart,
          signal,
          packBias,
          {
            freeCascade,
            depth: depthForBest,
            exactNfp: useExactNfp,
            onAttempt,
          },
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
            exactNfp: useExactNfp,
            onAttempt,
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
        useExactNfp,
        onAttempt,
      )
      return pos ? { variant, ...pos } : null
    }

    const best = find(exactNfp)
    if (best || signal?.aborted || exactNfp || !options.exactFallback) {
      return best
    }
    try {
      options.onExactFallback?.(part.partId)
    } catch {
      // Diagnostic telemetry must never alter nesting.
    }
    return find(true)
  }

  const compareStockTrials = (
    a: { usableArea: number; maxSlack: number; trial: SheetState },
    b: { usableArea: number; maxSlack: number; trial: SheetState },
  ) =>
    a.usableArea - b.usableArea ||
    a.maxSlack - b.maxSlack ||
    a.trial.widthMm - b.trial.widthMm ||
    a.trial.heightMm - b.trial.heightMm

  const simulateFuturePlaced = (
    start: number,
    initialSheets: SheetState[],
    initialStock: SheetStock[],
  ): { placedCount: number; sheets: SheetState[]; stock: SheetStock[] } => {
    const simulatedSheets = initialSheets.map((sheet) => ({
      ...sheet,
      placed: sheet.placed.slice(),
    }))
    const simulatedStock = initialStock.map((stock) => ({ ...stock }))
    let placedCount = 0

    for (let partIndex = start; partIndex < sequence.length; partIndex++) {
      if (signal?.aborted) break
      const entry = sequence[partIndex]!
      let placed = false
      for (const sheet of simulatedSheets) {
        const best = findEntryPlacement(entry, sheet, undefined)
        if (!best) continue
        commit(sheet, entry.part.partId, entry.part.area, best)
        placed = true
        placedCount += 1
        break
      }
      if (placed || signal?.aborted) continue

      const candidates: Array<{
        stockIndex: number
        stock: SheetStock
        trial: SheetState
        best: PlaceCand
        usableArea: number
        maxSlack: number
      }> = []
      for (let stockIndex = 0; stockIndex < simulatedStock.length; stockIndex++) {
        const stock = simulatedStock[stockIndex]!
        if (stock.remaining <= 0) continue
        const trial: SheetState = {
          index: simulatedSheets.length,
          widthMm: stock.widthMm,
          heightMm: stock.heightMm,
          marginMm: stock.marginMm,
          placed: [],
        }
        const best = findEntryPlacement(entry, trial, undefined)
        if (!best) continue
        const usableWidth = stock.widthMm - stock.marginMm * 2
        const usableHeight = stock.heightMm - stock.marginMm * 2
        candidates.push({
          stockIndex,
          stock,
          trial,
          best,
          usableArea: usableWidth * usableHeight,
          maxSlack: Math.max(
            usableWidth - best.variant.width,
            usableHeight - best.variant.height,
          ),
        })
      }
      candidates.sort(compareStockTrials)
      const selectedIndex = chooseStockByFutureMatching(
        sequence,
        partIndex,
        simulatedStock,
        stockCompatibility,
        candidates.map((candidate) => candidate.stockIndex),
        signal,
      )
      const selected = candidates.find(
        (candidate) => candidate.stockIndex === selectedIndex,
      )
      if (!selected) continue
      commit(selected.trial, entry.part.partId, entry.part.area, selected.best)
      simulatedSheets.push(selected.trial)
      selected.stock.remaining -= 1
      placedCount += 1
    }
    return { placedCount, sheets: simulatedSheets, stock: simulatedStock }
  }

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

    const { part } = sequence[i]!
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

    const tryOn = (sheet: SheetState): PlaceCand | null => {
      sheetsTried += 1
      return findEntryPlacement(sequence[i]!, sheet, emitAttempt)
    }

    const existingCandidates: Array<{
      sheet: SheetState
      sheetPosition: number
      best: PlaceCand
    }> = []
    for (let sheetPosition = 0; sheetPosition < sheets.length; sheetPosition++) {
      if (signal?.aborted) break
      const sheet = sheets[sheetPosition]!
      const best = tryOn(sheet)
      if (signal?.aborted) break
      if (!best) continue
      existingCandidates.push({ sheet, sheetPosition, best })
    }

    if (existingCandidates.length > 0 && !signal?.aborted) {
      type ExistingOrOpening =
        | { kind: 'existing'; value: (typeof existingCandidates)[number] }
        | {
            kind: 'opening'
            stockIndex: number
            stock: SheetStock
            trial: SheetState
            best: PlaceCand
          }
      const choices: ExistingOrOpening[] = existingCandidates.map((value) => ({
        kind: 'existing',
        value,
      }))
      for (let stockIndex = 0; stockIndex < sheetStock.length; stockIndex++) {
        const stock = sheetStock[stockIndex]!
        if (
          stock.remaining <= 0 ||
          !stockCompatibility[i]![stockIndex]
        ) {
          continue
        }
        const trial: SheetState = {
          index: sheets.length,
          widthMm: stock.widthMm,
          heightMm: stock.heightMm,
          marginMm: stock.marginMm,
          placed: [],
        }
        const best = tryOn(trial)
        if (best) {
          choices.push({ kind: 'opening', stockIndex, stock, trial, best })
        }
      }

      let selected = choices[0]!
      let completedSuffix:
        | { placedCount: number; sheets: SheetState[]; stock: SheetStock[] }
        | undefined
      if (choices.length > 1 && i + 1 < sequence.length) {
        let bestFuture = -1
        for (const choice of choices) {
          if (signal?.aborted) break
          const futureSheets = sheets.map((sheet) => ({
            ...sheet,
            placed: sheet.placed.slice(),
          }))
          const futureStock = sheetStock.map((stock) => ({ ...stock }))
          if (choice.kind === 'existing') {
            commit(
              futureSheets[choice.value.sheetPosition]!,
              part.partId,
              part.area,
              choice.value.best,
            )
          } else {
            const opened = { ...choice.trial, placed: choice.trial.placed.slice() }
            commit(opened, part.partId, part.area, choice.best)
            futureSheets.push(opened)
            futureStock[choice.stockIndex]!.remaining -= 1
          }
          const simulation = simulateFuturePlaced(
            i + 1,
            futureSheets,
            futureStock,
          )
          if (simulation.placedCount > bestFuture) {
            bestFuture = simulation.placedCount
            selected = choice
          }
          if (
            !signal?.aborted &&
            simulation.placedCount === sequence.length - (i + 1)
          ) {
            selected = choice
            completedSuffix = simulation
            break
          }
        }
      }
      if (completedSuffix) {
        if (isBlfProfiling()) {
          blfProfileEndPart({
            placed: true,
            placementMs: performance.now() - tPart,
            sheetsTried,
          })
        }
        flushAttempts()
        return snapshot(completedSuffix.sheets, unplaced)
      }
      if (!signal?.aborted) {
        if (selected.kind === 'existing') {
          commit(selected.value.sheet, part.partId, part.area, selected.value.best)
        } else {
          commit(selected.trial, part.partId, part.area, selected.best)
          sheets.push(selected.trial)
          selected.stock.remaining -= 1
        }
        placed = true
      }
    }

    if (!placed && !signal?.aborted) {
      const candidates: Array<{
        stockIndex: number
        stock: SheetStock
        trial: SheetState
        best: PlaceCand
        usableArea: number
        maxSlack: number
      }> = []
      for (let stockIndex = 0; stockIndex < sheetStock.length; stockIndex++) {
        const stock = sheetStock[stockIndex]!
        if (stock.remaining <= 0) continue
        const trial: SheetState = {
          index: sheets.length,
          widthMm: stock.widthMm,
          heightMm: stock.heightMm,
          marginMm: stock.marginMm,
          placed: [],
        }
        const best = tryOn(trial)
        if (signal?.aborted) break
        if (!best) continue
        const usableWidth = stock.widthMm - stock.marginMm * 2
        const usableHeight = stock.heightMm - stock.marginMm * 2
        candidates.push({
          stockIndex,
          stock,
          trial,
          best,
          usableArea: usableWidth * usableHeight,
          maxSlack: Math.max(
            usableWidth - best.variant.width,
            usableHeight - best.variant.height,
          ),
        })
      }
      candidates.sort(compareStockTrials)
      const selectedIndex = chooseStockByFutureMatching(
        sequence,
        i,
        sheetStock,
        stockCompatibility,
        candidates.map((candidate) => candidate.stockIndex),
        signal,
      )
      let selected = candidates.find(
        (candidate) => candidate.stockIndex === selectedIndex,
      )
      if (
        candidates.length > 1 &&
        i + 1 < sequence.length &&
        mayShareFutureSheet(
          sequence,
          i + 1,
          sheetStock,
          stockCompatibility,
          part.area,
          new Set(candidates.map((candidate) => candidate.stockIndex)),
        )
      ) {
        const scored = candidates.map((candidate, preference) => {
          const futureSheets = sheets.map((sheet) => ({
            ...sheet,
            placed: sheet.placed.slice(),
          }))
          const opened = {
            ...candidate.trial,
            placed: candidate.trial.placed.slice(),
          }
          commit(opened, part.partId, part.area, candidate.best)
          futureSheets.push(opened)
          const futureStock = sheetStock.map((stock) => ({ ...stock }))
          futureStock[candidate.stockIndex]!.remaining -= 1
          return {
            candidate,
            preference,
            score: simulateFuturePlaced(i + 1, futureSheets, futureStock)
              .placedCount,
          }
        })
        scored.sort(
          (a, b) =>
            b.score - a.score ||
            Number(b.candidate.stockIndex === selectedIndex) -
              Number(a.candidate.stockIndex === selectedIndex) ||
            a.preference - b.preference,
        )
        selected = scored[0]?.candidate
      }
      if (selected && !signal?.aborted) {
        commit(selected.trial, part.partId, part.area, selected.best)
        sheets.push(selected.trial)
        selected.stock.remaining -= 1
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

    flushAttempts()

    if (signal?.aborted) {
      const remaining = sequence
        .slice(i + (placed ? 1 : 0))
        .map((s) => s.part.partId)
      const bestSoFar = snapshot(sheets, [...unplaced, ...remaining])
      return {
        status: 'cancelled',
        message: 'Cancelled',
        bestSoFar,
      }
    }

    if (!placed) unplaced.push(part.partId)

    if (options.onProgress) {
      const placedCount = sheets.reduce((n, s) => n + s.placed.length, 0)
      const partial = snapshot(sheets, [
        ...unplaced,
        ...sequence.slice(i + 1).map((s) => s.part.partId),
      ])
      options.onProgress({
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
  }

  const placements = sheets.flatMap((s) => s.placed.map((p) => p.placement))
  flushAttempts()
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
  validateNestingRequest(request)
  const shouldProfile =
    options.profile === true || request.settings.profileBlf === true
  if (shouldProfile) beginBlfProfiling()
  beginPlacementSession()
  options.onProgress?.({
    ratio: 0.02,
    phase: 'prepare',
    message: 'Preparing parts',
  })
  const prepared =
    options.preparedParts ??
    prepareParts(request.parts, request.settings, { sortByArea: true })
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
  validateNestingRequest(request)
  return placeWithOrderUnchecked(request, order, options)
}

/** Internal optimizer path; request must already have passed validation. */
export function placeWithOrderUnchecked(
  request: NestingRequest,
  order: string[],
  options: BlfOptions = {},
): NestingResult {
  const t0 = performance.now()
  const prepared =
    options.preparedParts ??
    prepareParts(request.parts, request.settings, { sortByArea: false })
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
  validateNestingRequest(request)
  validatePlacementPlan(plan)
  return placeWithPlanUnchecked(request, plan, options)
}

/** Internal optimizer path; request must already have passed validation. */
export function placeWithPlanUnchecked(
  request: NestingRequest,
  plan: PlacementPlan,
  options: BlfOptions = {},
): NestingResult {
  const t0 = performance.now()
  if (plan.rotations.some((rotation) => !Number.isFinite(rotation))) {
    throw new RangeError('Plan rotation values must be finite')
  }
  // Reuse shared NFP cache across gene evaluations (session opened by BLF baseline)
  const prepared =
    options.preparedParts ??
    prepareParts(request.parts, request.settings, { sortByArea: false })
  const byId = new Map(prepared.map((p) => [p.partId, p]))

  const sequence: Array<{ part: PreparedPart; variant: PreparedVariant }> = []
  const seen = new Set<string>()
  for (let i = 0; i < plan.order.length; i++) {
    const id = plan.order[i]!
    if (seen.has(id)) continue
    const part = byId.get(id)
    if (!part) continue
    seen.add(id)
    const rot = plan.rotations[i] ?? part.variants[0]?.rotation ?? 0
    const variant = findVariant(part, rot)
    if (!variant) continue
    sequence.push({ part, variant })
  }

  // Any prepared parts missing from plan go last unplaced-attempted
  for (const part of prepared) {
    if (!seen.has(part.partId)) {
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
  const partAreaById = new Map(request.parts.map((part) => [part.id, part.area]))
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
  const placedArea = placements.reduce(
    (area, placement) => area + (partAreaById.get(placement.partId) ?? 0),
    0,
  )
  const totalSheetArea = sheetResults.reduce(
    (a, s) => a + Math.max(0, s.widthMm) * Math.max(0, s.heightMm),
    0,
  )
  const usableTotal = sheets.reduce((a, sheet) => {
    const m = sheet.marginMm
    return (
      a +
      Math.max(0, sheet.widthMm - 2 * m) *
        Math.max(0, sheet.heightMm - 2 * m)
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
