import { prepareParts, resolveRotations } from '../core/prepare'
import { placeWithPlan, runBottomLeftNest } from '../placement/blf'
import {
  isBetterScore,
  scoreNestingResult,
  type ScoreBreakdown,
} from '../scoring/fitness'
import type {
  NestingRequest,
  NestingResult,
  NestingSuccess,
  NestProgress,
} from '../types'
import { orderCrossover } from './crossover'
import { destroyRepairImprove } from './destroyRepair'
import {
  individualKey,
  settingsCacheKey,
  type Individual,
} from './individual'
import { localSearchImprove } from './localSearch'
import { mutateIndividual } from './mutation'
import { createInitialPopulation, multiStartSeeds } from './population'
import { presetForLevel } from './presets'
import { createRng } from './rng'
import { elitistSurvive, tournamentSelect, type RankedIndividual } from './selection'

export type EvolutionaryOptions = {
  onProgress?: (p: NestProgress) => void
  signal?: AbortSignal
  seed?: number
  timeLimitMs?: number
  maxGenerations?: number
  /**
   * When true: ignore wall-clock truncation (generation/op limits only).
   * For reproducible tests / developer deterministic mode.
   */
  deterministic?: boolean
}

type CacheEntry = {
  result: NestingSuccess
  score: ScoreBreakdown
}

function asSuccess(result: NestingResult): NestingSuccess | null {
  return result.status === 'ok' ? result : null
}

function throttleProgress(
  onProgress: ((p: NestProgress) => void) | undefined,
  minIntervalMs: number,
) {
  let last = 0
  return (p: NestProgress, force = false) => {
    if (!onProgress) return
    const now = performance.now()
    if (!force && now - last < minIntervalMs) return
    last = now
    onProgress(p)
  }
}

/**
 * Evolutionary optimizer over the Stage 4 BLF/NFP placer.
 * Multi-start + local search + optional destroy/repair within time budget.
 * Always returns a result at least as good as the BLF baseline.
 */
export function runEvolutionaryNest(
  request: NestingRequest,
  options: EvolutionaryOptions = {},
): NestingResult {
  const t0 = performance.now()
  const preset = presetForLevel(request.settings.optimizationLevel)
  const timeLimit =
    options.timeLimitMs ?? request.settings.timeLimitMs ?? preset.timeLimitMs
  const maxGen = options.maxGenerations ?? preset.maxGenerations
  const seed = options.seed ?? request.settings.seed ?? 1
  const rng = createRng(seed)
  const allowed = resolveRotations(request.settings, request.parts)
  const emit = throttleProgress(options.onProgress, 80)
  const deterministic = options.deterministic === true
  const timedOut = () =>
    !deterministic && performance.now() - t0 >= timeLimit

  const abortable = {
    get aborted() {
      return !!options.signal?.aborted
    },
  }

  const level = request.settings.optimizationLevel
  const partTotal = request.parts.length

  const progressBase = (): Partial<NestProgress> => ({
    optimizationLevel: level,
    partCount: partTotal,
    elapsedMs: performance.now() - t0,
  })

  emit(
    {
      ...progressBase(),
      ratio: 0.02,
      phase: 'prepare',
      placedCount: 0,
      message: `Prepare · ${level} · 0 / ${partTotal} parça`,
    },
    true,
  )

  const baselineRaw = runBottomLeftNest(request, {
    signal: options.signal,
    onProgress: (p) => {
      emit({
        ...progressBase(),
        ...p,
        ratio: 0.02 + (p.ratio ?? 0) * 0.12,
        optimizationLevel: level,
        message: p.message ?? `BLF · ${level}`,
      })
    },
  })

  if (baselineRaw.status === 'cancelled') return baselineRaw
  if (baselineRaw.status !== 'ok') return baselineRaw

  let baseline = {
    ...baselineRaw,
    engineId: 'blf-nfp-v1',
    calculationTimeMs: performance.now() - t0,
  }

  const sheet0 = request.sheets[0]
  const sKey = settingsCacheKey({
    spacingMm: request.settings.spacingMm,
    marginMm: sheet0?.marginMm ?? 0,
    sheetW: sheet0?.widthMm ?? 0,
    sheetH: sheet0?.heightMm ?? 0,
    quantity: sheet0?.quantity ?? 1,
    allowedRotations: allowed,
  })

  const cache = new Map<string, CacheEntry>()
  const evaluate = (ind: Individual): CacheEntry => {
    const key = individualKey(ind, sKey)
    const hit = cache.get(key)
    if (hit) return hit
    const placed = placeWithPlan(
      request,
      { order: ind.order, rotations: ind.rotations },
      { engineId: 'evolutionary-blf-v1', signal: options.signal },
    )
    if (placed.status === 'cancelled') {
      // Abort mid-eval — keep searching with baseline until outer loop exits
      const entry = { result: baseline, score: scoreNestingResult(baseline) }
      return entry
    }
    const success = asSuccess(placed)
    if (!success) {
      const score = scoreNestingResult(baseline)
      score.unplacedPenalty += 1_000
      score.total += 1_000 * 10_000_000
      const entry = { result: baseline, score }
      cache.set(key, entry)
      return entry
    }
    const score = scoreNestingResult(success)
    const entry = { result: success, score }
    cache.set(key, entry)
    return entry
  }

  const prepared = prepareParts(request.parts, request.settings, {
    sortByArea: false,
  })
  if (prepared.length === 0) {
    return { ...baseline, calculationTimeMs: performance.now() - t0 }
  }

  const baselineScore = scoreNestingResult(baseline)
  let bestResult = baseline
  let bestScore = baselineScore
  let bestGene: Individual | null = null
  let generationGlobal = 0

  const consider = (
    result: NestingSuccess,
    score: ScoreBreakdown,
    gene?: Individual,
  ) => {
    if (isBetterScore(score, bestScore)) {
      bestScore = score
      bestResult = result
      if (gene) bestGene = gene
      emit(
        {
          ...progressBase(),
          ratio: 0.2,
          phase: 'optimize',
          generation: generationGlobal,
          bestScore: bestScore.total,
          bestUtilization: bestResult.utilization,
          sheetCount: bestResult.statistics.sheetCountUsed,
          placedCount: bestResult.statistics.placedCount,
          partCount: partTotal,
          unplacedCount: bestResult.statistics.unplacedCount,
          bestSoFar: bestResult,
          message: `Best · ${level} · ${bestResult.statistics.placedCount} / ${partTotal} · sheets ${bestResult.statistics.sheetCountUsed}`,
        },
        true,
      )
    }
  }
  consider(baseline, baselineScore)
  emit(
    {
      ...progressBase(),
      ratio: 0.14,
      phase: 'optimize',
      placedCount: baseline.statistics.placedCount,
      partCount: partTotal,
      unplacedCount: baseline.statistics.unplacedCount,
      sheetCount: baseline.statistics.sheetCountUsed,
      bestScore: baselineScore.total,
      bestUtilization: baseline.utilization,
      bestSoFar: baseline,
      message: `Optimize · ${level} · BLF baseline · ${baseline.statistics.placedCount} / ${partTotal}`,
    },
    true,
  )

  // Reconstruct baseline gene for local search fallback
  const baselineGene: Individual = (() => {
    const order = baseline.placements.map((p) => p.partId)
    const rest = prepared.map((p) => p.partId).filter((id) => !order.includes(id))
    const full = [...order, ...rest]
    const rotById = new Map(baseline.placements.map((p) => [p.partId, p.rotation]))
    return {
      order: full,
      rotations: full.map((id) => rotById.get(id) ?? allowed[0] ?? 0),
    }
  })()
  bestGene = baselineGene

  const populationSize = Math.max(4, preset.populationSize)
  const eliteCount = Math.max(
    1,
    Math.round(populationSize * preset.eliteFraction),
  )
  const starts = Math.max(1, preset.multiStarts)
  const optimizeBudget = timeLimit * (1 - preset.localSearchFraction - preset.destroyRepairFraction)
  const perStartMs = optimizeBudget / starts

  const startGenes = multiStartSeeds(
    prepared,
    allowed,
    baseline,
    starts,
    rng,
  )

  for (let s = 0; s < starts; s++) {
    if (abortable.aborted) break
    if (timedOut()) break

    const startDeadline = deterministic
      ? Number.POSITIVE_INFINITY
      : t0 + Math.min(timeLimit * 0.85, (s + 1) * perStartMs + 50)
    const startGene = startGenes[s] ?? startGenes[0]!
    const startRng = createRng(seed + (s + 1) * 9973)

    let populationInds = createInitialPopulation(
      prepared,
      allowed,
      baseline,
      populationSize,
      startRng,
    )
    // Bias population with this start's trajectory seed
    populationInds = [startGene, ...populationInds].slice(0, populationSize)

    let ranked: RankedIndividual[] = populationInds.map((ind) => {
      const ev = evaluate(ind)
      consider(ev.result, ev.score, ind)
      return {
        individual: ind,
        score: ev.score,
        resultKey: individualKey(ind, sKey),
      }
    })

    let generation = 0
    const genCap = Math.max(4, Math.floor(maxGen / starts))

    while (generation < genCap) {
      if (abortable.aborted) break
      if (timedOut()) break
      if (performance.now() >= startDeadline) break

      generation += 1
      generationGlobal += 1
      const elites = elitistSurvive(ranked, eliteCount)
      const next: RankedIndividual[] = elites.slice()

      while (next.length < populationSize) {
        if (abortable.aborted || timedOut()) break
        if (performance.now() >= startDeadline) break
        const p1 = tournamentSelect(ranked, startRng, preset.tournamentSize)
        const p2 = tournamentSelect(ranked, startRng, preset.tournamentSize)
        let child = orderCrossover(p1, p2, startRng)
        child = mutateIndividual(child, startRng, allowed, preset.mutationRate)
        const ev = evaluate(child)
        consider(ev.result, ev.score, child)
        next.push({
          individual: child,
          score: ev.score,
          resultKey: individualKey(child, sKey),
        })
      }

      ranked = next
      const elapsed = performance.now() - t0
      emit({
        ...progressBase(),
        ratio: Math.min(0.82, 0.14 + (0.68 * (s + generation / genCap)) / starts),
        phase: 'optimize',
        generation: generationGlobal,
        bestScore: bestScore.total,
        bestUtilization: bestResult.utilization,
        sheetCount: bestResult.statistics.sheetCountUsed,
        placedCount: bestResult.statistics.placedCount,
        partCount: partTotal,
        unplacedCount: bestResult.statistics.unplacedCount,
        bestSoFar: bestResult,
        elapsedMs: elapsed,
        message: `Optimize · ${level} · start ${s + 1}/${starts} · gen ${generation} · ${bestResult.statistics.placedCount} / ${partTotal} · sheets ${bestResult.statistics.sheetCountUsed} · ${(elapsed / 1000).toFixed(1)}s`,
        multiStartIndex: s + 1,
        multiStartCount: starts,
      })
    }
  }

  // Local search phase
  if (
    preset.enableLocalSearch &&
    bestGene &&
    !abortable.aborted &&
    (deterministic || performance.now() - t0 < timeLimit)
  ) {
    const lsDeadline = deterministic
      ? Number.POSITIVE_INFINITY
      : Math.min(
          t0 + timeLimit,
          performance.now() + Math.max(20, timeLimit * preset.localSearchFraction),
        )
    const improvedGene = localSearchImprove(
      bestGene,
      allowed,
      rng,
      evaluate,
      lsDeadline,
    )
    const ev = evaluate(improvedGene)
    consider(ev.result, ev.score, improvedGene)
    emit(
      {
        ...progressBase(),
        ratio: 0.9,
        phase: 'optimize',
        generation: generationGlobal,
        bestScore: bestScore.total,
        bestUtilization: bestResult.utilization,
        sheetCount: bestResult.statistics.sheetCountUsed,
        placedCount: bestResult.statistics.placedCount,
        partCount: partTotal,
        unplacedCount: bestResult.statistics.unplacedCount,
        bestSoFar: bestResult,
        elapsedMs: performance.now() - t0,
        message: `Local search · ${level} · ${bestResult.statistics.placedCount} / ${partTotal}`,
      },
      true,
    )
  }

  // Destroy / repair phase
  if (
    preset.enableDestroyRepair &&
    bestGene &&
    !abortable.aborted &&
    (deterministic || performance.now() - t0 < timeLimit)
  ) {
    const drDeadline = deterministic
      ? Number.POSITIVE_INFINITY
      : Math.min(
          t0 + timeLimit,
          performance.now() + Math.max(20, timeLimit * preset.destroyRepairFraction),
        )
    const gene = bestGene
    const improvedGene = destroyRepairImprove(
      gene,
      allowed,
      rng,
      evaluate,
      drDeadline,
    )
    const ev = evaluate(improvedGene)
    consider(ev.result, ev.score, improvedGene)
    emit(
      {
        ...progressBase(),
        ratio: 0.95,
        phase: 'optimize',
        generation: generationGlobal,
        bestScore: bestScore.total,
        bestUtilization: bestResult.utilization,
        sheetCount: bestResult.statistics.sheetCountUsed,
        placedCount: bestResult.statistics.placedCount,
        partCount: partTotal,
        unplacedCount: bestResult.statistics.unplacedCount,
        bestSoFar: bestResult,
        elapsedMs: performance.now() - t0,
        message: `Repair · ${level} · ${bestResult.statistics.placedCount} / ${partTotal}`,
      },
      true,
    )
  }

  if (abortable.aborted) {
    const improved = isBetterScore(bestScore, baselineScore)
    return {
      status: 'cancelled',
      message: 'Stopped — returning best so far',
      bestSoFar: {
        ...bestResult,
        calculationTimeMs: performance.now() - t0,
        engineId: improved ? 'evolutionary-blf-v1' : 'blf-nfp-v1',
      },
    }
  }

  const improved = isBetterScore(bestScore, baselineScore)
  if (!improved) {
    bestResult = baseline
    bestScore = baselineScore
  }

  emit(
    {
      ...progressBase(),
      ratio: 1,
      phase: 'finalize',
      generation: generationGlobal,
      bestScore: bestScore.total,
      bestUtilization: bestResult.utilization,
      sheetCount: bestResult.statistics.sheetCountUsed,
      placedCount: bestResult.statistics.placedCount,
      partCount: partTotal,
      unplacedCount: bestResult.statistics.unplacedCount,
      bestSoFar: bestResult,
      elapsedMs: performance.now() - t0,
      message: `Completed · ${bestResult.statistics.placedCount} / ${partTotal}`,
    },
    true,
  )

  return {
    ...bestResult,
    calculationTimeMs: performance.now() - t0,
    engineId: improved ? 'evolutionary-blf-v1' : 'blf-nfp-v1',
  }
}
