import { prepareParts, resolveRotations, type PreparedPart } from '../core/prepare'
import { validateNestingRequest } from '../core/validate'
import {
  placeWithOrderUnchecked,
  placeWithPlanUnchecked,
  runBottomLeftNestUnchecked,
  type FreeAngleDepth,
} from '../placement/blf'
import {
  isBetterNestingResult,
  scoreNestingResult,
} from '../scoring/fitness'
import type {
  NestAttempt,
  NestProgress,
  NestingRequest,
  NestingResult,
  NestingSuccess,
} from '../types'
import { expandOrder, selectBeam, type RankedCandidate } from './beamSearch'
import {
  createConvergenceState,
  markRequiredOrdersComplete,
  recordChampion,
  recordEvaluation,
  recordFirstChampion,
  shouldStop,
} from './convergence'
import {
  createRepairState,
  proposeRepair,
  rewardRepairOperator,
} from './destroyRepair'
import { individualKey, type Individual } from './individual'
import { buildOrderCandidates } from './orderSearch'
import { BALANCED_ANGLES } from './rotations'
import { createRng } from './rng'
import {
  DEFAULT_NESTING_TIME_LIMIT_MS,
  NestingDeadline,
} from './deadline'

export type AutomaticOptions = {
  onProgress?: (progress: NestProgress) => void
  onAttempt?: (attempt: NestAttempt) => void
  onAttemptFlush?: () => void
  signal?: AbortSignal
  seed?: number
  deterministic?: boolean
  now?: () => number
  onEvaluation?: (info: {
    kind: 'rank' | 'exact'
    elapsedMs: number
    improved: boolean
  }) => void
}

type ExactStage = 'fixed' | 'coarse' | 'refine' | 'seed' | 'event'
type ExactDepth = Extract<FreeAngleDepth, 'refine' | 'seed' | 'event'>
type ProgressActivity = NonNullable<NestProgress['activity']>

const orderKey = (individual: Individual): string =>
  JSON.stringify(individual.order)

function individualFromResult(
  result: NestingSuccess,
  source: Individual,
  preparedParts: readonly PreparedPart[],
): Individual {
  const placedRotations = new Map(
    result.placements.map(({ partId, rotation }) => [partId, rotation]),
  )
  const sourceRotations = new Map(
    source.order.map((id, index) => [id, source.rotations[index]]),
  )
  const preparedById = new Map(preparedParts.map((part) => [part.partId, part]))
  const preparedOrder = preparedParts.map(({ partId }) => partId)
  const seen = new Set<string>()
  const order = [...source.order, ...preparedOrder].filter((id) => {
    if (!preparedById.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
  return {
    order,
    rotations: order.map(
      (id) =>
        placedRotations.get(id) ??
        sourceRotations.get(id) ??
        preparedById.get(id)!.rotations[0]!,
    ),
  }
}

export function runAutomaticNest(
  request: NestingRequest,
  options: AutomaticOptions = {},
): NestingResult {
  const now = options.now ?? (() => performance.now())
  const t0 = now()
  validateNestingRequest(request)
  const seed = options.seed ?? request.settings.seed ?? 1
  if (!Number.isFinite(seed)) throw new RangeError('seed must be finite')
  const cancelledWithoutChampion = (): NestingResult => ({
    status: 'cancelled',
    message: 'Stopped — returning best so far',
    bestSoFar: null,
  })
  if (options.signal?.aborted) return cancelledWithoutChampion()

  const deterministic =
    options.deterministic ?? request.settings.deterministic ?? false
  const deadline = deterministic
    ? null
    : new NestingDeadline(
        request.settings.timeLimitMs ?? DEFAULT_NESTING_TIME_LIMIT_MS,
        now,
        options.signal,
      )
  const rng = createRng(seed)
  const convergence = createConvergenceState({
    partCount: request.parts.length,
    deterministic,
    startedAtMs: t0,
    timeLimitMs:
      request.settings.timeLimitMs ?? DEFAULT_NESTING_TIME_LIMIT_MS,
  })
  let lastProgressRatio = 0
  const emit = (progress: NestProgress): void => {
    const ratio = Math.max(lastProgressRatio, progress.ratio)
    lastProgressRatio = ratio
    try {
      options.onProgress?.({
        ...progress,
        ratio,
        ...(progress.bestSoFar
          ? { bestSoFar: structuredClone(progress.bestSoFar) }
          : {}),
      })
    } catch {
      // Observers must never alter nesting.
    }
  }
  const notifyEvaluation = (
    kind: 'rank' | 'exact',
    elapsedMs: number,
    improved: boolean,
  ): void => {
    try {
      options.onEvaluation?.({ kind, elapsedMs, improved })
    } catch {
      // Diagnostics must never alter nesting.
    }
  }
  const timed = (result: NestingSuccess, engineId = result.engineId): NestingSuccess => ({
    ...result,
    calculationTimeMs: Math.max(0, now() - t0),
    engineId,
  })

  emit({
    ratio: 0.02,
    phase: 'prepare',
    activity: 'initial',
    message: 'Preparing parts',
  })
  if (options.signal?.aborted) return cancelledWithoutChampion()
  const preparedParts: readonly PreparedPart[] = prepareParts(
    request.parts,
    request.settings,
    { sortByArea: true },
  )
  const preparedIds = preparedParts.map(({ partId }) => partId)
  const preparedById = new Map(preparedParts.map((part) => [part.partId, part]))
  const allowedRotations = resolveRotations(request.settings, request.parts)
  const runKey = ''

  let champion: NestingSuccess | null = null
  let championGene: Individual | null = null
  let cheapThreshold: NestingSuccess | null = null

  const publish = (
    result: NestingSuccess,
    source: Individual,
    activity: ProgressActivity,
  ): boolean => {
    if (champion && !isBetterNestingResult(result, champion)) return false
    const first = champion === null
    const next = timed(
      result,
      first ? 'automatic-blf-v1' : 'automatic-anytime-v1',
    )
    champion = next
    championGene = individualFromResult(next, source, preparedParts)
    if (first) recordFirstChampion(convergence, now())
    else recordChampion(convergence, now())
    emit({
      ratio: first ? 0.1 : 0.65,
      phase: first ? 'seed' : 'optimize',
      activity: first ? 'initial' : activity,
      message: first ? 'Initial layout' : 'Improving layout',
      attemptPass: first ? 'canonical-blf' : undefined,
      bestSoFar: next,
      bestScore: scoreNestingResult(next).total,
      bestUtilization: next.utilization,
      placedCount: next.statistics.placedCount,
      partCount: request.parts.length,
      unplacedCount: next.statistics.unplacedCount,
      sheetCount: next.statistics.sheetCountUsed,
      elapsedMs: next.calculationTimeMs,
    })
    return true
  }

  const cancelled = (): NestingResult => {
    if (
      options.signal?.aborted !== true &&
      deadline?.expired() === true &&
      champion
    ) return finish()
    return {
      status: 'cancelled',
      message: 'Stopped — returning best so far',
      bestSoFar: champion ? timed(champion) : null,
    }
  }
  const finish = (): NestingResult => {
    if (!champion) return cancelled()
    emit({
      ratio: 0.9,
      phase: 'finalize',
      activity: 'verify',
      message: 'Verifying result',
    })
    emit({
      ratio: 1,
      phase: 'finalize',
      activity: 'verify',
      message: 'Verifying result',
    })
    return timed(champion)
  }
  const aborted = (): boolean =>
    options.signal?.aborted === true || deadline?.expired() === true
  const converged = (): boolean => shouldStop(convergence, now(), false)

  emit({
    ratio: 0.1,
    phase: 'seed',
    activity: 'initial',
    message: 'Initial layout',
    attemptPass: 'canonical-blf',
  })
  const initialSeedGene: Individual = {
    order: preparedIds.slice(),
    rotations: preparedParts.map((part) => part.rotations[0]!),
  }
  const seedResult = runBottomLeftNestUnchecked(request, {
    signal: options.signal,
    deadline: deadline ?? undefined,
    onAttempt: options.onAttempt,
    onAttemptFlush: options.onAttemptFlush,
    freeAngleDepth: 'orthogonal',
    nfpFidelity: 'simplified',
    exactFallback: true,
    completeOnDeadline: true,
    // ponytail: bounded seed scan; global order/rotation search retries alternatives.
    candidateScanLimit: 4096,
    preparedParts,
    engineId: 'automatic-blf-v1',
  })
  if (seedResult.status !== 'ok') {
    if (seedResult.status === 'cancelled' && seedResult.bestSoFar) {
      publish(seedResult.bestSoFar, initialSeedGene, 'initial')
    }
    return seedResult.status === 'cancelled' ? cancelled() : seedResult
  }
  if (deadline?.expired() === true) {
    publish(seedResult, initialSeedGene, 'initial')
    return options.signal?.aborted ? cancelled() : finish()
  }

  const seedGene = individualFromResult(
    seedResult,
    initialSeedGene,
    preparedParts,
  )
  if (preparedParts.length === 0) {
    publish(seedResult, seedGene, 'initial')
    return options.signal?.aborted ? cancelled() : finish()
  }

  const exactCache = new Map<string, NestingSuccess | null>()
  type ExactOutcome = {
    result: NestingSuccess | null
    gene: Individual | null
    improved: boolean
    cancelled: boolean
    partial: NestingSuccess | null
  }
  const evaluateExact = (
    individual: Individual,
    stage: ExactStage,
    activity: ProgressActivity,
    depth?: ExactDepth,
  ): ExactOutcome => {
    const key = stage === 'event'
      ? `event:${orderKey(individual)}`
      : `${stage}:${individualKey(individual, runKey)}`
    if (exactCache.has(key)) {
      const result = exactCache.get(key) ?? null
      return {
        result,
        gene: result
          ? individualFromResult(result, individual, preparedParts)
          : null,
        improved: false,
        cancelled: false,
        partial: null,
      }
    }

    const started = now()
    const replay = placeWithPlanUnchecked(request, individual, {
      signal: options.signal,
      deadline: deadline ?? undefined,
      nfpFidelity: 'exact',
      preparedParts,
      engineId: champion ? 'automatic-anytime-v1' : 'automatic-blf-v1',
      ...(depth ? { freeAngleDepth: depth } : {}),
    })
    const elapsedMs = Math.max(0, now() - started)
    if (replay.status === 'cancelled') {
      return {
        result: null,
        gene: null,
        improved: false,
        cancelled: true,
        partial: replay.bestSoFar ?? null,
      }
    }
    if (replay.status !== 'ok') {
      exactCache.set(key, null)
      notifyEvaluation('exact', elapsedMs, false)
      return {
        result: null,
        gene: null,
        improved: false,
        cancelled: false,
        partial: null,
      }
    }

    const candidate = timed(
      replay,
      champion ? 'automatic-anytime-v1' : 'automatic-blf-v1',
    )
    const improved = publish(candidate, individual, activity)
    exactCache.set(key, candidate)
    notifyEvaluation('exact', elapsedMs, improved)
    return {
      result: candidate,
      gene: individualFromResult(candidate, individual, preparedParts),
      improved,
      cancelled: false,
      partial: null,
    }
  }

  const seedReplay = evaluateExact(seedGene, 'fixed', 'initial')
  if (seedReplay.cancelled) {
    if (seedReplay.partial) publish(seedReplay.partial, seedGene, 'initial')
    return cancelled()
  }
  if (!champion || !championGene) return cancelled()
  if (aborted()) return cancelled()

  const cheapCache = new Map<string, RankedCandidate | null>()
  const cheapEvaluatedKeys = new Set<string>()
  type RankOutcome = {
    candidate: RankedCandidate | null
    cancelled: boolean
  }
  type RankDepth = Extract<FreeAngleDepth, 'quick' | 'coarse'>
  const rank = (
    individual: Individual,
    depth: RankDepth = 'quick',
    searchRotations = depth === 'coarse',
  ): RankOutcome => {
    const individualCacheKey = individualKey(individual, runKey)
    const semantics = searchRotations ? 'order' : 'plan'
    const key = `${depth}:${semantics}:${individualCacheKey}`
    if (cheapCache.has(key)) {
      return {
        candidate: cheapCache.get(key) ?? null,
        cancelled: false,
      }
    }

    const started = now()
    const rankOptions = {
      signal: options.signal,
      deadline: deadline ?? undefined,
      freeAngleDepth: depth,
      nfpFidelity: 'simplified' as const,
      preparedParts,
      engineId: 'automatic-anytime-v1',
    }
    const placed = searchRotations
      ? placeWithOrderUnchecked(request, individual.order, rankOptions)
      : placeWithPlanUnchecked(request, individual, rankOptions)
    const elapsedMs = Math.max(0, now() - started)
    if (placed.status === 'cancelled') {
      return { candidate: null, cancelled: true }
    }

    recordEvaluation(convergence)
    if (depth === 'quick' && !searchRotations) {
      cheapEvaluatedKeys.add(individualCacheKey)
    }
    if (placed.status !== 'ok') {
      cheapCache.set(key, null)
      notifyEvaluation('rank', elapsedMs, false)
      return { candidate: null, cancelled: false }
    }

    const result = timed(placed, 'automatic-anytime-v1')
    const actual = individualFromResult(result, individual, preparedParts)
    const candidate = { individual: actual, result }
    const actualKey = individualKey(actual, runKey)
    cheapCache.set(key, candidate)
    cheapCache.set(`${depth}:${semantics}:${actualKey}`, candidate)
    if (depth === 'quick' && !searchRotations) {
      cheapEvaluatedKeys.add(actualKey)
    }
    // Rank diagnostics compare like-for-like against the current champion.
    const improved = !cheapThreshold || isBetterNestingResult(result, cheapThreshold)
    notifyEvaluation('rank', elapsedMs, improved)
    return { candidate, cancelled: false }
  }

  const refreshCheapThreshold = (): boolean => {
    if (!championGene) return false
    const ranked = rank(championGene)
    if (ranked.cancelled) return false
    cheapThreshold = ranked.candidate?.result ?? null
    return true
  }
  const evaluateAndRefreshExact = (
    individual: Individual,
    stage: ExactStage,
    activity: ProgressActivity,
    depth?: ExactDepth,
  ): ExactOutcome => {
    const outcome = evaluateExact(individual, stage, activity, depth)
    if (!outcome.improved || !championGene) return outcome
    if (aborted()) return { ...outcome, cancelled: true }
    if (converged()) return outcome
    return refreshCheapThreshold()
      ? outcome
      : { ...outcome, cancelled: true }
  }

  const improvesCheapChampion = (candidate: RankedCandidate): boolean =>
    cheapThreshold != null &&
    isBetterNestingResult(candidate.result, cheapThreshold)

  let beam: RankedCandidate[] = []
  discovery: {
    if (aborted()) return cancelled()
    if (converged()) break discovery
    if (!refreshCheapThreshold()) return cancelled()

    emit({
      ratio: 0.25,
      phase: 'optimize',
      activity: 'orders',
      message: 'Trying orders',
    })
    const rankedCandidates: RankedCandidate[] = []
    const requiredOrders = buildOrderCandidates(preparedParts.slice(), rng, {
      includeRandom: false,
    })
    for (const orderCandidate of requiredOrders) {
      if (aborted()) return cancelled()
      if (converged()) break discovery
      const outcome = rank(
        {
          order: orderCandidate.order,
          rotations: orderCandidate.order.map(
            (id) => preparedById.get(id)?.rotations[0] ?? BALANCED_ANGLES[0]!,
          ),
        },
        'quick',
        true,
      )
      if (outcome.cancelled) return cancelled()
      emit({
        ratio: 0.25,
        phase: 'optimize',
        activity: 'orders',
        message: `Trying orders · ${orderCandidate.name}`,
      })
      if (!outcome.candidate) continue
      rankedCandidates.push(outcome.candidate)
      const previousBeamKeys = new Set(
        beam.map(({ individual }) => individualKey(individual, runKey)),
      )
      const nextBeam = selectBeam(rankedCandidates, 4, runKey)
      const candidateKey = individualKey(outcome.candidate.individual, runKey)
      const enteredBeam =
        !previousBeamKeys.has(candidateKey) &&
        nextBeam.some(
          ({ individual }) => individualKey(individual, runKey) === candidateKey,
        )
      beam = nextBeam
      if (aborted()) return cancelled()
      if (converged()) break discovery
      if (enteredBeam || improvesCheapChampion(outcome.candidate)) {
        const exact = evaluateAndRefreshExact(
          outcome.candidate.individual,
          'fixed',
          'orders',
        )
        if (exact.cancelled || aborted()) return cancelled()
      }
    }
    markRequiredOrdersComplete(convergence)

    let layer = 0
    for (;;) {
      layer++
      emit({
        ratio: 0.65,
        phase: 'optimize',
        activity: 'beam',
        message: `Improving layout · layer ${layer}`,
      })
      const previousKeys = beam.map(({ individual }) =>
        individualKey(individual, runKey),
      )
      const children: RankedCandidate[] = []
      for (const member of beam) {
        for (const child of expandOrder(member.individual, rng)) {
          if (aborted()) return cancelled()
          if (converged()) break discovery
          const childKey = individualKey(child, runKey)
          if (cheapEvaluatedKeys.has(childKey)) continue
          const outcome = rank(child)
          if (outcome.cancelled) return cancelled()
          if (!outcome.candidate) continue
          children.push(outcome.candidate)
          if (aborted()) return cancelled()
          if (converged()) break discovery
          const tentative = selectBeam([...beam, ...children], 4, runKey)
          const rankedKey = individualKey(
            outcome.candidate.individual,
            runKey,
          )
          const entersBeam = tentative.some(
            ({ individual }) => individualKey(individual, runKey) === rankedKey,
          ) && !beam.some(
            ({ individual }) => individualKey(individual, runKey) === rankedKey,
          )
          if (entersBeam || improvesCheapChampion(outcome.candidate)) {
            const exact = evaluateAndRefreshExact(
              outcome.candidate.individual,
              'fixed',
              'beam',
            )
            if (exact.cancelled || aborted()) return cancelled()
          }
        }
      }
      const next = selectBeam([...beam, ...children], 4, runKey)
      const nextKeys = next.map(({ individual }) =>
        individualKey(individual, runKey),
      )
      beam = next
      const stable =
        previousKeys.length === nextKeys.length &&
        previousKeys.every((key, index) => key === nextKeys[index])
      if (stable) {
        emit({
          ratio: 0.65,
          phase: 'optimize',
          activity: 'beam',
          message: `Improving layout · layer ${layer} stable`,
        })
        break
      }
    }
  }

  if (beam.length === 0) {
    beam = [{ individual: championGene, result: champion }]
  }

  type RefinementState = 'done' | 'full-improved' | 'cancelled'
  const runTerminalFinalist = (
    individual: Individual,
    source: 'finalist' | 'repair',
    activity: ProgressActivity,
  ): RefinementState => {
    emit({
      ratio: 0.65,
      phase: 'optimize',
      activity,
      message: source === 'repair'
        ? 'Improving layout · bounded-angle repair champion'
        : 'Improving layout · bounded-angle finalist',
    })
    const terminal = evaluateExact(individual, 'event', activity, 'event')
    if (terminal.cancelled || aborted()) return 'cancelled'
    return terminal.improved ? 'full-improved' : 'done'
  }
  const refineFinalist = (
    individual: Individual,
    source: 'finalist' | 'repair',
  ): RefinementState => {
    const activity: ProgressActivity =
      source === 'repair' ? 'repair' : 'refine'
    if (aborted()) return 'cancelled'
    if (converged()) return runTerminalFinalist(individual, source, activity)
    emit({
      ratio: 0.65,
      phase: 'optimize',
      activity,
      message: source === 'repair'
        ? 'Improving layout · coarse repair champion'
        : 'Improving layout · coarse finalist',
    })
    const coarsened = rank(individual, 'coarse')
    if (coarsened.cancelled || aborted()) return 'cancelled'
    if (converged()) return runTerminalFinalist(individual, source, activity)
    let refinementGene = individual
    if (
      coarsened.candidate &&
      improvesCheapChampion(coarsened.candidate)
    ) {
      const exact = evaluateAndRefreshExact(
        coarsened.candidate.individual,
        'coarse',
        activity,
      )
      if (exact.cancelled || aborted()) return 'cancelled'
      if (exact.improved && exact.gene) refinementGene = exact.gene
      if (converged()) {
        return runTerminalFinalist(refinementGene, source, activity)
      }
    }
    emit({
      ratio: 0.65,
      phase: 'optimize',
      activity,
      message: source === 'repair'
        ? 'Improving layout · refining repair champion'
        : 'Improving layout · refining finalist',
    })
    const refined = evaluateAndRefreshExact(
      refinementGene,
      'refine',
      activity,
      'refine',
    )
    if (refined.cancelled || aborted()) return 'cancelled'
    if (!refined.improved || !refined.gene) {
      return runTerminalFinalist(refinementGene, source, activity)
    }
    refinementGene = refined.gene
    if (converged()) {
      return runTerminalFinalist(refinementGene, source, activity)
    }
    emit({
      ratio: 0.65,
      phase: 'optimize',
      activity,
      message: source === 'repair'
        ? 'Improving layout · polishing repair champion'
        : 'Improving layout · polishing finalist',
    })
    const polished = evaluateAndRefreshExact(
      refinementGene,
      'seed',
      activity,
      'seed',
    )
    if (polished.cancelled || aborted()) return 'cancelled'
    return runTerminalFinalist(polished.gene ?? refinementGene, source, activity)
  }

  const finalistKeys = new Set<string>()
  const finalists = [championGene, ...beam.map(({ individual }) => individual)]
    .filter((individual) => {
      const key = orderKey(individual)
      if (finalistKeys.has(key)) return false
      finalistKeys.add(key)
      return true
    })
  for (const finalist of finalists) {
    const state = refineFinalist(finalist, 'finalist')
    if (state === 'cancelled') return cancelled()
  }
  if (aborted()) return cancelled()
  if (converged()) return finish()
  if (!refreshCheapThreshold()) return cancelled()

  emit({
    ratio: 0.65,
    phase: 'optimize',
    activity: 'repair',
    message: 'Improving layout',
  })
  const repairState = createRepairState()
  for (;;) {
    if (aborted()) return cancelled()
    if (converged()) return finish()
    const proposal = proposeRepair(
      championGene,
      allowedRotations,
      champion,
      preparedById,
      rng,
      repairState,
    )
    const proposalKey = individualKey(proposal.individual, runKey)
    if (cheapEvaluatedKeys.has(proposalKey)) {
      // ponytail: duplicates count toward convergence; no alternate search needed.
      recordEvaluation(convergence)
      continue
    }

    const ranked = rank(proposal.individual)
    if (ranked.cancelled) return cancelled()
    if (!ranked.candidate) continue
    if (aborted()) return cancelled()
    if (converged()) return finish()
    if (!improvesCheapChampion(ranked.candidate)) continue
    const exact = evaluateAndRefreshExact(
      ranked.candidate.individual,
      'fixed',
      'repair',
    )
    if (exact.cancelled || aborted()) return cancelled()
    if (!exact.improved) continue
    rewardRepairOperator(repairState, proposal.operator)
    const state = refineFinalist(championGene, 'repair')
    if (state === 'cancelled') return cancelled()
    if (aborted()) return cancelled()
    if (converged()) return finish()
    if (state === 'full-improved' && !refreshCheapThreshold()) return cancelled()
  }
}
