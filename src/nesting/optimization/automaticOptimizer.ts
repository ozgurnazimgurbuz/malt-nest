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

type ExactStage = 'fixed' | 'refine' | 'seed'

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
  const rng = createRng(seed)
  const convergence = createConvergenceState({
    partCount: request.parts.length,
    deterministic,
    startedAtMs: t0,
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

  emit({ ratio: 0.02, phase: 'prepare', message: 'Preparing parts' })
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

  const cancelled = (): NestingResult => ({
    status: 'cancelled',
    message: 'Stopped — returning best so far',
    bestSoFar: champion ? timed(champion) : null,
  })
  const finish = (): NestingResult => {
    if (!champion) return cancelled()
    emit({ ratio: 0.9, phase: 'finalize', message: 'Verifying result' })
    emit({ ratio: 1, phase: 'finalize', message: 'Verifying result' })
    return timed(champion)
  }
  const halted = (): boolean =>
    !!options.signal?.aborted || shouldStop(convergence, now(), false)
  const haltResult = (): NestingResult =>
    options.signal?.aborted ? cancelled() : finish()

  emit({
    ratio: 0.1,
    phase: 'seed',
    message: 'Initial layout',
    attemptPass: 'canonical-blf',
  })
  const seedResult = runBottomLeftNestUnchecked(request, {
    signal: options.signal,
    onAttempt: options.onAttempt,
    onAttemptFlush: options.onAttemptFlush,
    freeAngleDepth: 'orthogonal',
    nfpFidelity: 'simplified',
    exactFallback: true,
    preparedParts,
    engineId: 'automatic-blf-v1',
  })
  if (seedResult.status !== 'ok') {
    return seedResult.status === 'cancelled' ? cancelled() : seedResult
  }

  const initialSeedGene: Individual = {
    order: preparedIds.slice(),
    rotations: preparedParts.map((part) => part.rotations[0]!),
  }
  const seedGene = individualFromResult(
    seedResult,
    initialSeedGene,
    preparedParts,
  )
  if (preparedParts.length === 0) {
    publish(seedResult, seedGene)
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
    depth?: Extract<FreeAngleDepth, 'refine' | 'seed'>,
  ): ExactOutcome => {
    const key = `${stage}:${individualKey(individual, runKey)}`
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
    const improved = publish(candidate, individual)
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

  const seedReplay = evaluateExact(seedGene, 'fixed')
  if (seedReplay.cancelled) {
    if (seedReplay.partial) publish(seedReplay.partial, seedGene)
    return cancelled()
  }
  if (!champion || !championGene) return cancelled()
  if (options.signal?.aborted) return cancelled()

  const cheapCache = new Map<string, RankedCandidate | null>()
  const cheapEvaluatedKeys = new Set<string>()
  type RankOutcome = {
    candidate: RankedCandidate | null
    cancelled: boolean
  }
  const rank = (individual: Individual): RankOutcome => {
    const key = individualKey(individual, runKey)
    if (cheapCache.has(key)) {
      return {
        candidate: cheapCache.get(key) ?? null,
        cancelled: false,
      }
    }

    const started = now()
    const placed = placeWithOrderUnchecked(request, individual.order, {
      signal: options.signal,
      freeAngleDepth: 'quick',
      nfpFidelity: 'simplified',
      preparedParts,
      engineId: 'automatic-anytime-v1',
    })
    const elapsedMs = Math.max(0, now() - started)
    if (placed.status === 'cancelled') {
      return { candidate: null, cancelled: true }
    }

    recordEvaluation(convergence)
    cheapEvaluatedKeys.add(key)
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
    cheapCache.set(actualKey, candidate)
    cheapEvaluatedKeys.add(actualKey)
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
  if (halted()) return haltResult()
  if (!refreshCheapThreshold()) return cancelled()

  const evaluateAndRefreshExact = (
    individual: Individual,
    stage: ExactStage,
    depth?: Extract<FreeAngleDepth, 'refine' | 'seed'>,
  ): ExactOutcome => {
    const outcome = evaluateExact(individual, stage, depth)
    if (!outcome.improved || !championGene) return outcome
    if (options.signal?.aborted) return { ...outcome, cancelled: true }
    if (shouldStop(convergence, now(), false)) return outcome
    return refreshCheapThreshold()
      ? outcome
      : { ...outcome, cancelled: true }
  }

  const improvesCheapChampion = (candidate: RankedCandidate): boolean =>
    cheapThreshold != null &&
    isBetterNestingResult(candidate.result, cheapThreshold)

  emit({ ratio: 0.25, phase: 'optimize', message: 'Trying orders' })
  const rankedCandidates: RankedCandidate[] = []
  let beam: RankedCandidate[] = []
  const requiredOrders = buildOrderCandidates(preparedParts.slice(), rng, {
    includeRandom: false,
  })
  for (const orderCandidate of requiredOrders) {
    if (halted()) return haltResult()
    const outcome = rank({
      order: orderCandidate.order,
      rotations: orderCandidate.order.map(
        (id) => preparedById.get(id)?.rotations[0] ?? BALANCED_ANGLES[0]!,
      ),
    })
    if (outcome.cancelled) return cancelled()
    emit({
      ratio: 0.25,
      phase: 'optimize',
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
    if (halted()) return haltResult()
    if (enteredBeam || improvesCheapChampion(outcome.candidate)) {
      const exact = evaluateAndRefreshExact(
        outcome.candidate.individual,
        'fixed',
      )
      if (exact.cancelled || options.signal?.aborted) return cancelled()
    }
  }
  markRequiredOrdersComplete(convergence)

  if (beam.length === 0) {
    beam = [{ individual: championGene, result: champion }]
  }
  let layer = 0
  for (;;) {
    layer++
    emit({
      ratio: 0.65,
      phase: 'optimize',
      message: `Improving layout · layer ${layer}`,
    })
    const previousKeys = beam.map(({ individual }) =>
      individualKey(individual, runKey),
    )
    const children: RankedCandidate[] = []
    for (const member of beam) {
      for (const child of expandOrder(member.individual, rng)) {
        if (halted()) return haltResult()
        const childKey = individualKey(child, runKey)
        if (cheapEvaluatedKeys.has(childKey)) continue
        const outcome = rank(child)
        if (outcome.cancelled) return cancelled()
        if (!outcome.candidate) continue
        children.push(outcome.candidate)
        if (halted()) return haltResult()
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
          )
          if (exact.cancelled || options.signal?.aborted) return cancelled()
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
        message: `Improving layout · layer ${layer} stable`,
      })
      break
    }
  }

  type RefinementState = 'done' | 'halted' | 'cancelled'
  const refineFinalist = (
    individual: Individual,
    source: 'finalist' | 'repair',
  ): RefinementState => {
    if (halted()) {
      return options.signal?.aborted ? 'cancelled' : 'halted'
    }
    emit({
      ratio: 0.65,
      phase: 'optimize',
      message: source === 'repair'
        ? 'Improving layout · refining repair champion'
        : 'Improving layout · refining finalist',
    })
    const refined = evaluateAndRefreshExact(
      individual,
      'refine',
      'refine',
    )
    if (refined.cancelled || options.signal?.aborted) return 'cancelled'
    if (!refined.improved || !refined.gene) return 'done'
    if (halted()) {
      return options.signal?.aborted ? 'cancelled' : 'halted'
    }
    emit({
      ratio: 0.65,
      phase: 'optimize',
      message: source === 'repair'
        ? 'Improving layout · polishing repair champion'
        : 'Improving layout · polishing finalist',
    })
    const polished = evaluateAndRefreshExact(
      refined.gene,
      'seed',
      'seed',
    )
    return polished.cancelled || options.signal?.aborted ? 'cancelled' : 'done'
  }

  const finalistKeys = new Set<string>()
  const finalists = [championGene, ...beam.map(({ individual }) => individual)]
    .filter((individual) => {
      const key = individualKey(individual, runKey)
      if (finalistKeys.has(key)) return false
      finalistKeys.add(key)
      return true
    })
  for (const finalist of finalists) {
    const state = refineFinalist(finalist, 'finalist')
    if (state === 'cancelled') return cancelled()
    if (state === 'halted') return finish()
  }

  emit({ ratio: 0.65, phase: 'optimize', message: 'Improving layout' })
  const repairState = createRepairState()
  for (;;) {
    if (halted()) return haltResult()
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
    if (halted()) return haltResult()
    if (!improvesCheapChampion(ranked.candidate)) continue
    const exact = evaluateAndRefreshExact(
      ranked.candidate.individual,
      'fixed',
    )
    if (exact.cancelled || options.signal?.aborted) return cancelled()
    if (!exact.improved) continue
    rewardRepairOperator(repairState, proposal.operator)
    const state = refineFinalist(championGene, 'repair')
    if (state === 'cancelled') return cancelled()
    if (state === 'halted') return finish()
  }
}
