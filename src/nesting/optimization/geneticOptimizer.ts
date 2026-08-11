import { prepareParts, resolveRotations } from '../core/prepare'
import {
  placeWithOrder,
  placeWithPlan,
  runBottomLeftNest,
} from '../placement/blf'
import { usesFreeAngleCascade } from './rotations'
import {
  isBetterPackedBounds,
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
import { buildOrderCandidates } from './orderSearch'
import { createInitialPopulation, multiStartSeeds } from './population'
import { presetForLevel } from './presets'
import { createRng } from './rng'
import { elitistSurvive, tournamentSelect, type RankedIndividual } from './selection'

/** How many order-search winners get expensive free-angle polish. */
const ORDER_POLISH_TOP_K = 2
/** Distinct placement orders to try in the cheap phase. */
const ORDER_SEARCH_LIMIT = 12

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
  /** Optional diagnostics after cheap multi-order search. */
  onOrderSearch?: (info: {
    tried: number
    bestName: string
    names: string[]
  }) => void
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

  const freeMode = usesFreeAngleCascade(request.settings)

  const prepared = prepareParts(request.parts, request.settings, {
    sortByArea: false,
  })
  if (prepared.length === 0) {
    const empty = runBottomLeftNest(request, { signal: options.signal })
    if (empty.status !== 'ok') return empty
    return { ...empty, calculationTimeMs: performance.now() - t0 }
  }

  // Stage 1 baseline: area_desc + full free cascade (15° → top-3@5° → 1°).
  // Free mode must never drop this quality floor; Stage 2 is additive only.
  const baselineRaw = runBottomLeftNest(request, {
    signal: options.signal,
    ...(freeMode ? { freeAngleDepth: 'full' as const } : {}),
    onProgress: (p) => {
      emit({
        ...progressBase(),
        ...p,
        ratio: 0.02 + (p.ratio ?? 0) * 0.08,
        optimizationLevel: level,
        message:
          p.message ??
          (freeMode ? `Stage1 full cascade · ${level}` : `BLF · ${level}`),
      })
    },
  })

  if (baselineRaw.status === 'cancelled') return baselineRaw
  if (baselineRaw.status !== 'ok') return baselineRaw

  const baselineCandidate: NestingSuccess = {
    ...baselineRaw,
    engineId: 'blf-nfp-v1',
    calculationTimeMs: performance.now() - t0,
  }
  // Same path as Stage 1 (area_desc + full); explicit finalist name.
  const areaDescFullCandidate = baselineCandidate
  let baseline = baselineCandidate
  let stage2Champion: NestingSuccess | null = null
  let stage2ChampionName = 'stage2'

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

  // Cheap multi-order search: 8–16 heuristics, coarse angles only.
  type OrderTrial = {
    name: string
    gene: Individual
    result: NestingSuccess
    score: ScoreBreakdown
  }
  const orderTrials: OrderTrial[] = []
  const orderCandidates = buildOrderCandidates(
    prepared,
    rng,
    ORDER_SEARCH_LIMIT,
  )
  emit(
    {
      ...progressBase(),
      ratio: 0.12,
      phase: 'seed',
      message: `Order search · ${orderCandidates.length} sequences`,
      bestSoFar: baseline,
    },
    true,
  )
  for (let oi = 0; oi < orderCandidates.length; oi++) {
    // Order search is the cheap quality lever — do not abort it on wall-clock.
    if (abortable.aborted) break
    const cand = orderCandidates[oi]!
    // Rank orders with a single rotation (0°) — rotation polish runs on top-K only.
    const placed = placeWithPlan(
      request,
      {
        order: cand.order,
        rotations: cand.order.map(() => allowed[0] ?? 0),
      },
      {
        signal: options.signal,
        engineId: 'blf-order-v1',
      },
    )
    if (placed.status === 'cancelled') break
    const ok = asSuccess(placed)
    if (!ok) continue
    const score = scoreNestingResult(ok)
    const order = [
      ...ok.placements.map((p) => p.partId),
      ...cand.order.filter(
        (id) => !ok.placements.some((p) => p.partId === id),
      ),
    ]
    const gene: Individual = {
      order,
      rotations: order.map(() => allowed[0] ?? 0),
    }
    orderTrials.push({ name: cand.name, gene, result: ok, score })
    cache.set(individualKey(gene, sKey), { result: ok, score })
    emit({
      ...progressBase(),
      ratio: 0.12 + (0.08 * (oi + 1)) / Math.max(1, orderCandidates.length),
      phase: 'seed',
      message: `Order · ${cand.name} · ${oi + 1}/${orderCandidates.length}`,
      sheetCount: ok.statistics.sheetCountUsed,
      placedCount: ok.statistics.placedCount,
      bestSoFar: ok,
    })
  }
  orderTrials.sort((a, b) => a.score.total - b.score.total)

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
  for (const trial of orderTrials) {
    consider(trial.result, trial.score, trial.gene)
  }
  const bestOrderName =
    orderTrials.find((t) => t.gene === bestGene)?.name ??
    orderTrials[0]?.name ??
    'area_desc'
  options.onOrderSearch?.({
    tried: orderTrials.length,
    bestName: bestOrderName,
    names: orderTrials.map((t) => t.name),
  })
  emit(
    {
      ...progressBase(),
      ratio: 0.2,
      phase: 'optimize',
      placedCount: bestResult.statistics.placedCount,
      partCount: partTotal,
      unplacedCount: bestResult.statistics.unplacedCount,
      sheetCount: bestResult.statistics.sheetCountUsed,
      bestScore: bestScore.total,
      bestUtilization: bestResult.utilization,
      bestSoFar: bestResult,
      message: `Order search done · best ${bestOrderName} · ${orderTrials.length} tried`,
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
  if (!bestGene) bestGene = baselineGene

  // Track GA/order winners for final polish (cheap genes → expensive angle refine).
  const polishPool: Individual[] = []
  const pushPolish = (ind: Individual | null) => {
    if (!ind) return
    const key = individualKey(ind, sKey)
    if (polishPool.some((p) => individualKey(p, sKey) === key)) return
    polishPool.push(ind)
  }
  for (const trial of orderTrials.slice(0, ORDER_POLISH_TOP_K)) {
    pushPolish(trial.gene)
  }
  pushPolish(bestGene)

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
    bestResult,
    starts,
    rng,
  )
  // Prefer order-search winners as multi-start seeds.
  const orderStartGenes = orderTrials.slice(0, starts).map((t) => t.gene)
  const mergedStarts = [...orderStartGenes, ...startGenes].slice(0, starts)

  for (let s = 0; s < starts; s++) {
    if (abortable.aborted) break
    if (timedOut()) break

    const startDeadline = deterministic
      ? Number.POSITIVE_INFINITY
      : t0 + Math.min(timeLimit * 0.85, (s + 1) * perStartMs + 50)
    const startGene = mergedStarts[s] ?? startGenes[0]!
    const startRng = createRng(seed + (s + 1) * 9973)

    let populationInds = createInitialPopulation(
      prepared,
      allowed,
      bestResult,
      populationSize,
      startRng,
    )
    // Bias population with order winners + this start's seed
    populationInds = [
      startGene,
      ...orderTrials.slice(0, 4).map((t) => t.gene),
      ...populationInds,
    ].slice(0, populationSize)

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
    const kept =
      freeMode && isBetterPackedBounds(baselineCandidate, bestResult)
        ? baselineCandidate
        : bestResult
    const improved = freeMode
      ? isBetterPackedBounds(kept, baselineCandidate)
      : isBetterScore(scoreNestingResult(kept), baselineScore)
    return {
      status: 'cancelled',
      message: 'Stopped — returning best so far',
      bestSoFar: {
        ...kept,
        calculationTimeMs: performance.now() - t0,
        engineId: improved ? 'evolutionary-blf-v1' : 'blf-nfp-v1',
      },
    }
  }

  let improved = isBetterScore(bestScore, baselineScore)
  if (!improved) {
    bestResult = baseline
    bestScore = baselineScore
    bestGene = baselineGene
  }
  pushPolish(bestGene)

  // Stage 2 shortlist: Top-K (0°) + mandatory area_desc → full cascade each.
  // Medium/coarse never drop area_desc; final pick is packed bounds vs Stage 1.
  if (freeMode && !abortable.aborted) {
    type Short = { name: string; gene: Individual }
    const shortlist: Short[] = []
    const seenOrder = new Set<string>()
    const pushShort = (name: string, gene: Individual) => {
      const k = gene.order.join(',')
      if (seenOrder.has(k)) return
      seenOrder.add(k)
      shortlist.push({ name, gene })
    }
    for (const trial of orderTrials.slice(0, ORDER_POLISH_TOP_K)) {
      pushShort(trial.name, trial.gene)
    }
    const areaTrial = orderTrials.find((t) => t.name === 'area_desc')
    if (areaTrial) pushShort(areaTrial.name, areaTrial.gene)

    type FullTrial = {
      name: string
      gene: Individual
      result: NestingSuccess
    }
    const fullTrials: FullTrial[] = []
    for (let pi = 0; pi < shortlist.length; pi++) {
      if (abortable.aborted) break
      const item = shortlist[pi]!
      emit(
        {
          ...progressBase(),
          ratio: 0.88 + (0.1 * (pi + 1)) / Math.max(1, shortlist.length),
          phase: 'finalize',
          message: `Stage2 full cascade · ${item.name} · ${pi + 1}/${shortlist.length}`,
          bestSoFar: bestResult,
        },
        true,
      )
      // area_desc full already computed as Stage 1 baseline — reuse, don't double-pay.
      if (item.name === 'area_desc') {
        fullTrials.push({
          name: item.name,
          gene: baselineGene,
          result: baselineCandidate,
        })
        continue
      }
      const placed = placeWithOrder(request, item.gene.order, {
        signal: options.signal,
        freeAngleDepth: 'full',
        engineId: 'blf-order-full-v1',
      })
      const ok = asSuccess(placed)
      if (!ok) continue
      const rotById = new Map(ok.placements.map((p) => [p.partId, p.rotation]))
      const order = [
        ...ok.placements.map((p) => p.partId),
        ...item.gene.order.filter((id) => !rotById.has(id)),
      ]
      const gene: Individual = {
        order,
        rotations: order.map((id) => rotById.get(id) ?? 0),
      }
      fullTrials.push({ name: item.name, gene, result: ok })
    }

    let champ: FullTrial | null = null
    for (const t of fullTrials) {
      if (!champ || isBetterPackedBounds(t.result, champ.result)) champ = t
    }
    if (champ) {
      stage2Champion = champ.result
      stage2ChampionName = champ.name
      bestGene = champ.gene
    }
  }

  // Free mode: packed-bounds pick; Stage 1 floor never lost.
  if (freeMode) {
    type Finalist = { name: string; result: NestingSuccess }
    const finalists: Finalist[] = [
      { name: 'stage1_full', result: baselineCandidate },
      { name: 'area_desc_full', result: areaDescFullCandidate },
    ]
    if (stage2Champion) {
      finalists.push({
        name: `stage2:${stage2ChampionName}`,
        result: stage2Champion,
      })
    }
    let winner = finalists[0]!
    for (const c of finalists.slice(1)) {
      if (isBetterPackedBounds(c.result, winner.result)) winner = c
    }
    // Regression guard: never finish worse than Stage 1 baseline.
    if (isBetterPackedBounds(baselineCandidate, winner.result)) {
      winner = { name: 'stage1_full', result: baselineCandidate }
    }
    bestResult = winner.result
    bestScore = scoreNestingResult(bestResult)
    improved = isBetterPackedBounds(bestResult, baselineCandidate)
    if (!improved) bestGene = baselineGene
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
