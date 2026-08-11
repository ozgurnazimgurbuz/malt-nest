import {
  BASE_ORDERING_STRATEGIES,
  orderIds,
  type OrderingStrategy,
} from '../ordering'
import { nest, type NestResult } from '../nest'
import type { Shape } from '../geometry/types'
import type { Sheet } from '../placement'
import type { RotationPolicy } from '../rotation'
import {
  compareOrderingEvals,
  isBetterOrEqualEval,
  rankEvals,
} from './compare'
import type {
  EvaluationMode,
  MultiStartConfig,
  MultiStartResult,
  OrderingEval,
  RankingRow,
} from './types'

const BASELINE: OrderingStrategy = 'area_desc'

const DEFAULT_FAST_ROTATION: RotationPolicy = { kind: 'orthogonal' }

/** Free cascade without nest-level ortho floor (multi-start already has FAST). */
const DEFAULT_FULL_ROTATION: RotationPolicy = {
  kind: 'free',
  free: { baselineFloor: false },
}

/**
 * Deterministic multi-start over ordering strategies.
 * No GA / random / pruning of base FAST set.
 */
export function optimizeMultiStart(
  parts: readonly Shape[],
  sheet: Sheet,
  config: MultiStartConfig,
): MultiStartResult {
  const strategies = dedupeStrategies(
    config.strategies ?? BASE_ORDERING_STRATEGIES,
  )
  if (!strategies.includes(BASELINE)) {
    strategies.unshift(BASELINE)
  }

  const fastRotation = config.fastRotation ?? DEFAULT_FAST_ROTATION
  const fullRotation = config.fullRotation ?? DEFAULT_FULL_ROTATION

  // —— FAST: every base strategy, no pruning ——
  const fastCandidates: OrderingEval[] = []
  for (const strategy of strategies) {
    fastCandidates.push(
      runEval(parts, sheet, config, strategy, 'fast', fastRotation),
    )
  }

  const fastRanks = rankEvals(fastCandidates)
  // —— FULL: every configured strategy (unique, area_desc retained) ——
  const shortlist = buildFullShortlist(strategies)
  const fullCandidates: OrderingEval[] = []
  for (const strategy of shortlist) {
    fullCandidates.push(
      runEval(parts, sheet, config, strategy, 'full', fullRotation),
    )
  }

  const fullRanks = rankEvals(fullCandidates)
  const baseline = fullCandidates.find((e) => e.strategy === BASELINE)!
  // FULL is a richer search, but it can still make a locally worse choice.
  // Keep FAST candidates eligible so the reported best never regresses.
  const best = [...fastCandidates, ...fullCandidates].sort(
    compareOrderingEvals,
  )[0]!

  // Invariant: best ≥ baseline (area_desc always in FULL)
  const baselinePreserved = isBetterOrEqualEval(best, baseline)

  const ranking: RankingRow[] = strategies.map((strategy) => ({
    strategy,
    fastRank: fastRanks.get(strategy) ?? null,
    fullRank: fullRanks.get(strategy) ?? null,
  }))

  let totalNfp = 0
  let totalCandidates = 0
  let totalCacheHits = 0
  let totalCacheMisses = 0
  let fastTotalRuntimeMs = 0
  let fullTotalRuntimeMs = 0
  for (const e of fastCandidates) {
    fastTotalRuntimeMs += e.runtimeMs
    totalNfp += e.nfpCount
    totalCandidates += e.candidateCount
    totalCacheHits += e.cacheHits
    totalCacheMisses += e.cacheMisses
  }
  for (const e of fullCandidates) {
    fullTotalRuntimeMs += e.runtimeMs
    totalNfp += e.nfpCount
    totalCandidates += e.candidateCount
    totalCacheHits += e.cacheHits
    totalCacheMisses += e.cacheMisses
  }

  return {
    baseline,
    fastCandidates,
    fullCandidates,
    best,
    diagnostics: {
      fastTotalRuntimeMs,
      fullTotalRuntimeMs,
      totalNfp,
      totalCandidates,
      totalCacheHits,
      totalCacheMisses,
      ranking,
      baselinePreserved,
      fullShortlist: shortlist,
    },
  }
}

/**
 * FULL set: all configured strategies, with area_desc retained as baseline.
 * A single strategy remains accepted for backward-compatible direct callers.
 */
export function buildFullShortlist(
  configured: OrderingStrategy | readonly OrderingStrategy[],
): OrderingStrategy[] {
  const strategies = typeof configured === 'string' ? [configured] : configured
  return dedupeStrategies([BASELINE, ...strategies])
}

export function dedupeStrategies(
  list: readonly OrderingStrategy[],
): OrderingStrategy[] {
  const seen = new Set<OrderingStrategy>()
  const out: OrderingStrategy[] = []
  for (const s of list) {
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

function runEval(
  parts: readonly Shape[],
  sheet: Sheet,
  config: MultiStartConfig,
  strategy: OrderingStrategy,
  mode: EvaluationMode,
  rotation: RotationPolicy,
): OrderingEval {
  const result = nest(parts, sheet, {
    gap: config.gap,
    ordering: strategy,
    rotation,
    maxSheets: config.maxSheets,
  })
  return toEval(strategy, mode, result, orderIds(parts, strategy))
}

export function toEval(
  strategy: OrderingStrategy,
  rotationMode: EvaluationMode,
  nest: NestResult,
  order: readonly string[],
): OrderingEval {
  return {
    strategy,
    order,
    rotationMode,
    placed: nest.metrics.placedCount,
    unplaced: nest.metrics.unplacedCount,
    sheets: nest.metrics.sheetCount,
    utilization: nest.metrics.utilization,
    waste: nest.metrics.waste,
    packedBoundsMm2: nest.metrics.packedBoundsMm2,
    runtimeMs: nest.runtimeMs,
    nfpCount: nest.diagnostics.nfpComputeCount,
    candidateCount: nest.diagnostics.candidateCount,
    cacheHits: nest.diagnostics.cacheHits ?? 0,
    cacheMisses: nest.diagnostics.cacheMisses ?? 0,
    nest,
  }
}
