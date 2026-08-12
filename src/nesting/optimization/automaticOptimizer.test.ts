import { describe, expect, it, vi } from 'vitest'
import type { GeometryPart } from '../../geometry'
import { boundingBox } from '../../geometry'
import { prepareParts } from '../core/prepare'
import {
  placeWithOrder,
  placeWithPlan,
  runBottomLeftNest,
} from '../placement/blf'
import {
  compareNestingResults,
  isBetterNestingResult,
} from '../scoring/fitness'
import type {
  NestProgress,
  NestingRequest,
  NestingSettings,
  NestingSuccess,
} from '../types'
import {
  runAutomaticNest,
  type AutomaticOptions,
} from './automaticOptimizer'
import type { RepairOperator } from './destroyRepair'
import { buildOrderCandidates } from './orderSearch'
import { createRng } from './rng'

const settings: NestingSettings = {
  spacingMm: 0,
  allowedRotations: [0, 90, 180, 270],
  rotationStepDeg: null,
  allowArbitraryRotation: true,
  allowRotation: true,
  rotationMode: 'free',
  seed: 7,
}

type ApprovedAutomaticOptionKey =
  | 'onProgress'
  | 'onAttempt'
  | 'onAttemptFlush'
  | 'signal'
  | 'seed'
  | 'deterministic'
  | 'now'
  | 'onEvaluation'

type AutomaticOptionsHaveExactKeys =
  Exclude<keyof AutomaticOptions, ApprovedAutomaticOptionKey> extends never
    ? Exclude<ApprovedAutomaticOptionKey, keyof AutomaticOptions> extends never
      ? true
      : false
    : false

const automaticOptionsHaveExactKeys: AutomaticOptionsHaveExactKeys = true

function rect(id: string, index: number, width: number, height: number): GeometryPart {
  const points = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]
  return {
    id,
    sourceElement: 'rect',
    originalIndex: index,
    sourceId: id,
    outer: { points },
    holes: [],
    boundingBox: boundingBox(points),
    area: width * height,
    centroid: { x: width / 2, y: height / 2 },
    originalTransform: null,
  }
}

function request(
  parts: GeometryPart[],
  overrides: Partial<NestingSettings> = {},
): NestingRequest {
  return {
    parts,
    sheets: [{ widthMm: 100, heightMm: 80, marginMm: 0, quantity: 5 }],
    settings: { ...settings, ...overrides },
  }
}

function planFor(result: NestingSuccess) {
  const rotations = new Map(
    result.placements.map(({ partId, rotation }) => [partId, rotation]),
  )
  const order = [
    ...result.placements.map(({ partId }) => partId),
    ...result.unplacedPartIds,
  ]
  return { order, rotations: order.map((id) => rotations.get(id) ?? 0) }
}

function champions(progress: NestProgress[]): NestingSuccess[] {
  return progress.flatMap(({ bestSoFar }) => bestSoFar ? [bestSoFar] : [])
}

function scoredResult(
  req: NestingRequest,
  order: readonly string[],
  wasteMm2: number,
): NestingSuccess {
  return {
    status: 'ok',
    placements: order.map((partId, index) => ({
      partId,
      sheetIndex: 0,
      x: index,
      y: 0,
      rotation: 0,
    })),
    sheets: [{
      sheetIndex: 0,
      widthMm: 500,
      heightMm: 500,
      placedCount: order.length,
      utilization: 0.5,
      wasteMm2,
      usedBounds: { minX: 0, minY: 0, maxX: order.length, maxY: 1 },
    }],
    unplacedPartIds: [],
    utilization: 0.5,
    wasteMm2,
    calculationTimeMs: 0,
    statistics: {
      partCount: req.parts.length,
      placedCount: req.parts.length,
      unplacedCount: 0,
      sheetCountUsed: 1,
      totalPartAreaMm2: 1,
      totalSheetAreaMm2: 250_000,
      overallUtilization: 0.5,
      overallWasteMm2: wasteMm2,
    },
    engineId: 'test',
  }
}

async function fidelityPromotionScenario(
  targetWaste: number,
  options: { stopAtFirstLayer?: boolean; childWaste?: number } = {},
) {
  const req = request([
    rect('a', 0, 83, 65),
    rect('b', 1, 42, 53),
    rect('c', 2, 82, 63),
    rect('d', 3, 47, 9),
    rect('e', 4, 23, 70),
    rect('f', 5, 40, 6),
    rect('g', 6, 52, 14),
    rect('h', 7, 16, 52),
    rect('i', 8, 32, 12),
    rect('j', 9, 14, 17),
    rect('k', 10, 77, 72),
    rect('l', 11, 63, 32),
  ])
  req.sheets = [{ widthMm: 500, heightMm: 500, marginMm: 0, quantity: 1 }]
  const prepared = prepareParts(req.parts, req.settings, { sortByArea: true })
  const required = buildOrderCandidates(prepared, createRng(7), {
    includeRandom: false,
  })
  const seedOrder = prepared.map(({ partId }) => partId)
  const seedKey = seedOrder.join(',')
  const alternatives = required.filter(({ order }) => order.join(',') !== seedKey)
  if (alternatives.length < 5) throw new Error('fixture needs five alternative orders')
  const target = alternatives[4]!
  const targetOrder = target.order
  const preparedById = new Map(prepared.map((part) => [part.partId, part]))
  const targetDefaultRotations = targetOrder.map(
    (id) => preparedById.get(id)!.rotations[0]!,
  )
  let defaultTargetExactCalls = 0
  const requiredKeys = new Set(required.map(({ order }) => order.join(',')))
  const cheapWaste = new Map<string, number>([
    [seedKey, 50],
    ...alternatives.slice(0, 4).map(
      ({ order }, index) => [order.join(','), 10 + index * 10] as const,
    ),
    [targetOrder.join(','), targetWaste],
  ])

  vi.resetModules()
  vi.doMock('../placement/blf', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../placement/blf')>()
    const runBottomLeftNestUnchecked: typeof actual.runBottomLeftNestUnchecked =
      (nestRequest, options) => scoredResult(
        nestRequest,
        options.preparedParts?.map(({ partId }) => partId) ?? [],
        80,
      )
    const placeWithOrderUnchecked: typeof actual.placeWithOrderUnchecked =
      (nestRequest, order) => scoredResult(
        nestRequest,
        order,
        cheapWaste.get(order.join(',')) ??
          (requiredKeys.has(order.join(',')) ? 200 : (options.childWaste ?? 200)),
      )
    const placeWithPlanUnchecked: typeof actual.placeWithPlanUnchecked =
      (nestRequest, plan, placementOptions) => {
        if (
          placementOptions.nfpFidelity === 'exact' &&
          plan.order.join() === targetOrder.join() &&
          plan.rotations.join() === targetDefaultRotations.join()
        ) defaultTargetExactCalls++
        const result = scoredResult(
          nestRequest,
          plan.order,
          placementOptions.nfpFidelity === 'simplified'
          ? cheapWaste.get(plan.order.join(',')) ??
            (requiredKeys.has(plan.order.join(','))
              ? 200
              : (options.childWaste ?? 200))
          : 100,
        )
        return {
          ...result,
          placements: result.placements.map((placement, index) => ({
            ...placement,
            rotation: plan.rotations[index]!,
          })),
        }
      }
    return {
      ...actual,
      runBottomLeftNestUnchecked,
      placeWithOrderUnchecked,
      placeWithPlanUnchecked,
    }
  })

  try {
    const { runAutomaticNest: runMockedAutomaticNest } =
      await import('./automaticOptimizer')
    const beamLayers: number[] = []
    const stableBeamLayers: number[] = []
    let publishedChampions = 0
    let clock = 0
    runMockedAutomaticNest(req, {
      deterministic: options.stopAtFirstLayer === false,
      now: () => clock,
      onProgress: ({ bestSoFar, message }) => {
        if (bestSoFar) publishedChampions++
        const layerMatch = message?.match(/^Improving layout · layer (\d+)$/)
        if (layerMatch) {
          beamLayers.push(Number(layerMatch[1]))
          if (options.stopAtFirstLayer !== false) clock = 5_000
        }
        const stableLayerMatch = message?.match(
          /^Improving layout · layer (\d+) stable$/,
        )
        if (stableLayerMatch) stableBeamLayers.push(Number(stableLayerMatch[1]))
      },
    })
    return {
      beamLayers,
      defaultTargetExactCalls,
      publishedChampions,
      stableBeamLayers,
    }
  } finally {
    vi.doUnmock('../placement/blf')
    vi.resetModules()
  }
}

async function refinementScenario(refineWaste: number) {
  const req = request([rect('a', 0, 20, 10)], {
    allowRotation: false,
  })
  vi.resetModules()
  vi.doMock('../placement/blf', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../placement/blf')>()
    const runBottomLeftNestUnchecked: typeof actual.runBottomLeftNestUnchecked =
      (nestRequest, options) => scoredResult(
        nestRequest,
        options.preparedParts?.map(({ partId }) => partId) ?? [],
        120,
      )
    const placeWithOrderUnchecked: typeof actual.placeWithOrderUnchecked =
      (nestRequest, order) => scoredResult(nestRequest, order, 100)
    const placeWithPlanUnchecked: typeof actual.placeWithPlanUnchecked =
      (nestRequest, plan, options) => scoredResult(
        nestRequest,
        plan.order,
        options.freeAngleDepth === 'refine'
          ? refineWaste
          : options.freeAngleDepth === 'seed'
            ? 80
            : 100,
      )
    return {
      ...actual,
      runBottomLeftNestUnchecked,
      placeWithOrderUnchecked,
      placeWithPlanUnchecked,
    }
  })

  try {
    const { runAutomaticNest: runMockedAutomaticNest } =
      await import('./automaticOptimizer')
    const finalistStages: Array<{ stage: 'refine' | 'seed'; improved: boolean }> = []
    let finalistStage: 'refine' | 'seed' | null = null
    runMockedAutomaticNest(req, {
      deterministic: true,
      now: () => 0,
      onProgress: ({ message }) => {
        if (message === 'Improving layout · refining finalist') {
          finalistStage = 'refine'
        } else if (message === 'Improving layout · polishing finalist') {
          finalistStage = 'seed'
        }
      },
      onEvaluation: ({ kind, improved }) => {
        if (kind !== 'exact' || !finalistStage) return
        finalistStages.push({ stage: finalistStage, improved })
        finalistStage = null
      },
    })
    return finalistStages
  } finally {
    vi.doUnmock('../placement/blf')
    vi.resetModules()
  }
}

async function repairImprovementScenario(repairExactWaste = 50) {
  const req = request([rect('a', 0, 83, 65)], { allowRotation: false })
  req.sheets = [{ widthMm: 500, heightMm: 500, marginMm: 0, quantity: 1 }]
  let phase: 'search' | 'repair' = 'search'
  let latestProposalOperator: RepairOperator | null = null
  const proposedOperators: RepairOperator[] = []
  const rewardedProposalOperators: RepairOperator[] = []
  const sequence: string[] = []
  vi.resetModules()
  vi.doMock('../placement/blf', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../placement/blf')>()
    const runBottomLeftNestUnchecked: typeof actual.runBottomLeftNestUnchecked =
      (nestRequest, options) => scoredResult(
        nestRequest,
        options.preparedParts?.map(({ partId }) => partId) ?? [],
        120,
      )
    const placeWithOrderUnchecked: typeof actual.placeWithOrderUnchecked =
      (nestRequest, order) => scoredResult(
        nestRequest,
        order,
        phase === 'repair' ? 50 : 100,
      )
    const placeWithPlanUnchecked: typeof actual.placeWithPlanUnchecked =
      (nestRequest, plan, options) => {
        const result = scoredResult(
          nestRequest,
          plan.order,
          options.nfpFidelity === 'simplified'
          ? phase === 'repair' ? 50 : 100
          : phase === 'repair'
            ? options.freeAngleDepth === 'refine' ? 40 : repairExactWaste
          : options.freeAngleDepth === 'refine' ? 110 : 100,
        )
        return {
          ...result,
          placements: result.placements.map((placement, index) => ({
            ...placement,
            rotation: plan.rotations[index]!,
          })),
        }
      }
    return {
      ...actual,
      runBottomLeftNestUnchecked,
      placeWithOrderUnchecked,
      placeWithPlanUnchecked,
    }
  })
  vi.doMock('./destroyRepair', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./destroyRepair')>()
    const proposeRepair: typeof actual.proposeRepair = () => {
      const proposal = {
        individual: { order: ['a'], rotations: [90] },
        operator: 'rotation' as const,
      }
      latestProposalOperator = proposal.operator
      proposedOperators.push(proposal.operator)
      return proposal
    }
    const rewardRepairOperator: typeof actual.rewardRepairOperator = vi.fn(
      (state, operator) => {
        if (latestProposalOperator) {
          rewardedProposalOperators.push(latestProposalOperator)
        }
        sequence.push(`reward:${operator}`)
        actual.rewardRepairOperator(state, operator)
      },
    )
    return { ...actual, proposeRepair, rewardRepairOperator }
  })

  try {
    const { runAutomaticNest: runMockedAutomaticNest } =
      await import('./automaticOptimizer')
    const repairModule = await import('./destroyRepair')
    const rewardSpy = vi.mocked(repairModule.rewardRepairOperator)
    const controller = new AbortController()
    let inRepair = false
    let repairStage: 'candidate' | 'coarse' | 'refine' | 'seed' = 'candidate'
    const result = runMockedAutomaticNest(req, {
      deterministic: true,
      now: () => 0,
      signal: controller.signal,
      onProgress: ({ bestSoFar, message }) => {
        if (message === 'Improving layout' && !inRepair) {
          phase = 'repair'
          inRepair = true
          sequence.push('repair:start')
        }
        if (!inRepair) return
        if (bestSoFar) sequence.push('repair:champion')
        if (message === 'Improving layout · coarse repair champion') {
          repairStage = 'coarse'
          sequence.push('repair:coarse:start')
        } else if (message === 'Improving layout · refining repair champion') {
          repairStage = 'refine'
          sequence.push('repair:refine:start')
        } else if (message === 'Improving layout · polishing repair champion') {
          repairStage = 'seed'
          sequence.push('repair:seed:start')
        }
      },
      onEvaluation: ({ kind, improved }) => {
        if (!inRepair) return
        sequence.push(`${kind}:${repairStage}:${improved}`)
        if (kind === 'exact' && repairStage === 'refine') controller.abort()
        if (kind === 'exact') repairStage = 'candidate'
      },
    })
    return {
      proposedOperators,
      result,
      rewardedProposalOperators,
      rewardSpy,
      sequence,
    }
  } finally {
    vi.doUnmock('../placement/blf')
    vi.doUnmock('./destroyRepair')
    vi.resetModules()
  }
}

async function mixedNeighborhoodScenario() {
  const req = request([
    rect('a', 0, 40, 10),
    rect('b', 1, 35, 12),
    rect('c', 2, 30, 14),
    rect('d', 3, 25, 16),
  ])
  let mixedStarted = false
  let valleyRanked = false
  let targetPending = false
  let clock = 0
  const events: string[] = []
  const localEvaluationCounts: number[] = []
  const rngSeeds: number[] = []
  const valley = {
    order: ['d', 'c', 'b', 'a'],
    rotations: [90, 0, 0, 0],
  }

  vi.resetModules()
  vi.doMock('../placement/blf', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../placement/blf')>()
    const runBottomLeftNestUnchecked: typeof actual.runBottomLeftNestUnchecked =
      (nestRequest, options) => scoredResult(
        nestRequest,
        options.preparedParts?.map(({ partId }) => partId) ?? [],
        100,
      )
    const placeWithPlanUnchecked: typeof actual.placeWithPlanUnchecked =
      (nestRequest, plan, options) => {
        if (options.nfpFidelity === 'simplified' && mixedStarted) {
          if (!valleyRanked) {
            valleyRanked = true
            events.push('local:worse')
            return scoredResult(nestRequest, plan.order, 120)
          }
          targetPending = true
          events.push('restart:leader')
          return scoredResult(nestRequest, plan.order, 50)
        }
        if (options.nfpFidelity === 'exact' && targetPending) {
          targetPending = false
          events.push('exact:improved')
          return scoredResult(nestRequest, plan.order, 50)
        }
        return scoredResult(nestRequest, plan.order, 100)
      }
    return { ...actual, runBottomLeftNestUnchecked, placeWithPlanUnchecked }
  })
  vi.doMock('./mutation', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./mutation')>()
    const controlled = () => {
      mixedStarted = true
      return valley
    }
    return {
      ...actual,
      adjacentSwapMutation: controlled,
      insertionMutation: controlled,
      rotationMutation: controlled,
      swapMutation: controlled,
    }
  })
  vi.doMock('./localSearch', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./localSearch')>()
    const localSearchImprove: typeof actual.localSearchImprove = (
      start,
      allowedRotations,
      rng,
      evaluate,
      deadlineMs,
      now,
    ) => {
      events.push('local')
      let evaluations = 0
      const result = actual.localSearchImprove(
        start,
        allowedRotations,
        rng,
        (individual) => {
          evaluations++
          return evaluate(individual)
        },
        deadlineMs,
        now,
      )
      localEvaluationCounts.push(evaluations)
      return result
    }
    return { ...actual, localSearchImprove }
  })
  vi.doMock('./rng', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./rng')>()
    const createRng: typeof actual.createRng = (seed) => {
      rngSeeds.push(seed)
      return actual.createRng(seed)
    }
    return { ...actual, createRng }
  })

  try {
    const { runAutomaticNest: runMockedAutomaticNest } =
      await import('./automaticOptimizer')
    const result = runMockedAutomaticNest(req, {
      deterministic: false,
      now: () => clock,
      onProgress: ({ bestSoFar, message }) => {
        if (message?.startsWith('Trying orders')) events.push('orders')
        if (bestSoFar?.wasteMm2 === 50) clock = 7_000
      },
    })
    return { events, localEvaluationCounts, result, rngSeeds }
  } finally {
    vi.doUnmock('../placement/blf')
    vi.doUnmock('./localSearch')
    vi.doUnmock('./mutation')
    vi.doUnmock('./rng')
    vi.resetModules()
  }
}

async function largeExtremeSeedScenario() {
  const req = request(
    Array.from({ length: 64 }, (_, index) =>
      rect(`large-${index}`, index, 20, 10),
    ),
    {
      allowedRotations: [0, 90],
      allowedRotationsExplicit: [0, 90],
      allowArbitraryRotation: false,
      rotationMode: 'orthogonal',
    },
  )
  req.sheets = [{ widthMm: 500, heightMm: 400, marginMm: 0, quantity: 2 }]
  let clock = 0
  const events: string[] = []

  vi.resetModules()
  vi.doMock('../placement/blf', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../placement/blf')>()
    const runBottomLeftNestUnchecked: typeof actual.runBottomLeftNestUnchecked =
      (nestRequest, options) => scoredResult(
        nestRequest,
        options.preparedParts?.map(({ partId }) => partId) ?? [],
        100,
      )
    const placeWithPlanUnchecked: typeof actual.placeWithPlanUnchecked =
      (nestRequest, plan, options) => {
        const tallest = plan.rotations.every((rotation) => rotation === 90)
        if (tallest) {
          events.push(`${options.nfpFidelity}:tallest`)
          if (options.nfpFidelity === 'exact') clock = 7_000
          const result = scoredResult(nestRequest, plan.order, 50)
          return {
            ...result,
            placements: result.placements.map((placement, index) => ({
              ...placement,
              rotation: plan.rotations[index]!,
            })),
          }
        }
        return scoredResult(nestRequest, plan.order, 100)
      }
    return { ...actual, runBottomLeftNestUnchecked, placeWithPlanUnchecked }
  })
  vi.doMock('./mutation', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./mutation')>()
    const observed = (individual: Parameters<typeof actual.swapMutation>[0]) => {
      events.push('mixed')
      return individual
    }
    return {
      ...actual,
      adjacentSwapMutation: observed,
      insertionMutation: observed,
      rotationMutation: observed,
      swapMutation: observed,
    }
  })

  try {
    const { runAutomaticNest: runMockedAutomaticNest } =
      await import('./automaticOptimizer')
    const result = runMockedAutomaticNest(req, {
      deterministic: false,
      now: () => clock,
    })
    return { events, result }
  } finally {
    vi.doUnmock('../placement/blf')
    vi.doUnmock('./mutation')
    vi.resetModules()
  }
}

async function compactWidestScenario() {
  const req = request([
    rect('a', 0, 20, 20),
    rect('b', 1, 50, 10),
    rect('c', 2, 15, 30),
    rect('d', 3, 10, 10),
  ], {
    allowedRotations: [0, 90],
    allowedRotationsExplicit: [0, 90],
    allowArbitraryRotation: false,
    rotationMode: 'orthogonal',
  })
  const prepared = prepareParts(req.parts, req.settings, { sortByArea: true })
  const byId = new Map(prepared.map((part) => [part.partId, part]))
  const compactOrder = buildOrderCandidates(prepared, createRng(7), {
    includeRandom: false,
  }).find(({ name }) => name === 'compact_fill_desc')!.order
  const compactRotations = compactOrder.map((id) => byId.get(id)!.widestRotation)
  const events: string[] = []
  let clock = 0

  vi.resetModules()
  vi.doMock('../placement/blf', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../placement/blf')>()
    const runBottomLeftNestUnchecked: typeof actual.runBottomLeftNestUnchecked =
      (nestRequest, options) => scoredResult(
        nestRequest,
        options.preparedParts?.map(({ partId }) => partId) ?? [],
        100,
      )
    const placeWithPlanUnchecked: typeof actual.placeWithPlanUnchecked =
      (nestRequest, plan, options) => {
        const target = plan.order.join() === compactOrder.join() &&
          plan.rotations.join() === compactRotations.join()
        if (!target) return scoredResult(nestRequest, plan.order, 100)
        events.push(`compact:${options.nfpFidelity}`)
        if (options.nfpFidelity === 'exact') clock = 7_000
        const result = scoredResult(nestRequest, plan.order, 50)
        return {
          ...result,
          placements: result.placements.map((placement, index) => ({
            ...placement,
            rotation: plan.rotations[index]!,
          })),
        }
      }
    return { ...actual, runBottomLeftNestUnchecked, placeWithPlanUnchecked }
  })

  try {
    const { runAutomaticNest: runMockedAutomaticNest } =
      await import('./automaticOptimizer')
    const result = runMockedAutomaticNest(req, {
      deterministic: false,
      now: () => clock,
      onProgress: ({ message }) => {
        if (message?.startsWith('Trying orders')) events.push('orders')
      },
    })
    return { events, result }
  } finally {
    vi.doUnmock('../placement/blf')
    vi.resetModules()
  }
}

describe('runAutomaticNest', () => {
  it('exports exactly the approved automatic options', () => {
    expect(automaticOptionsHaveExactKeys).toBe(true)
  })

  it('publishes an exact seed before optimize and never regresses', () => {
    const req = request([
      rect('big', 0, 55, 55),
      rect('m1', 1, 40, 25),
      rect('m2', 2, 40, 25),
      rect('s1', 3, 20, 20),
      rect('s2', 4, 18, 22),
    ])
    const progress: NestProgress[] = []

    const result = runAutomaticNest(req, {
      deterministic: true,
      onProgress: (item) => progress.push(item),
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const emitted = champions(progress)
    expect(emitted.length).toBeGreaterThan(0)
    const firstIndex = progress.findIndex(({ bestSoFar }) => bestSoFar != null)
    expect(progress[firstIndex]?.phase).toBe('seed')
    expect(progress.slice(0, firstIndex).some(({ phase }) => phase === 'optimize'))
      .toBe(false)
    expect(emitted[0]!.engineId).toBe('automatic-blf-v1')
    for (let i = 1; i < emitted.length; i++) {
      expect(isBetterNestingResult(emitted[i]!, emitted[i - 1]!)).toBe(true)
      expect(emitted[i]!.engineId).toBe('automatic-anytime-v1')
    }
    expect(compareNestingResults(result, emitted[0]!)).toBeLessThanOrEqual(0)

    for (const champion of emitted) {
      const replay = placeWithPlan(req, planFor(champion), {
        nfpFidelity: 'exact',
      })
      expect(replay.status).toBe('ok')
      if (replay.status === 'ok') {
        expect(compareNestingResults(replay, champion)).toBe(0)
      }
    }
  })

  it('preserves the selected seed order when result placements are grouped by sheet', async () => {
    const req = request([
      rect('a', 0, 6, 10),
      rect('b', 1, 6, 10),
      rect('c', 2, 4, 10),
    ])
    req.sheets = [{ widthMm: 10, heightMm: 10, marginMm: 0, quantity: 2 }]
    const flattened = runBottomLeftNest(req, {
      freeAngleDepth: 'orthogonal',
      nfpFidelity: 'simplified',
      exactFallback: true,
    })
    expect(flattened.status).toBe('ok')
    if (flattened.status !== 'ok') return
    expect(flattened.placements.map(({ partId }) => partId)).toEqual([
      'a', 'c', 'b',
    ])

    vi.resetModules()
    vi.doMock('../placement/blf', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../placement/blf')>()
      const placeWithPlanUnchecked: typeof actual.placeWithPlanUnchecked =
        (nestRequest, plan) => {
          const selectedSeedOrder = plan.order.join(',') === 'a,b,c'
          return scoredResult(
            nestRequest,
            plan.order,
            selectedSeedOrder ? 100 : 200,
          )
        }
      return { ...actual, placeWithPlanUnchecked }
    })

    let firstChampion: NestingSuccess | undefined
    try {
      const { runAutomaticNest: runMockedAutomaticNest } =
        await import('./automaticOptimizer')
      runMockedAutomaticNest(req, {
        deterministic: true,
        onProgress: ({ bestSoFar }) => {
          firstChampion ??= bestSoFar
        },
      })
    } finally {
      vi.doUnmock('../placement/blf')
      vi.resetModules()
    }

    expect(firstChampion?.wasteMm2).toBe(100)
    expect(firstChampion?.placements.map(({ partId }) => partId)).toEqual([
      'a', 'b', 'c',
    ])
  })

  it('never introduces zero-degree genes when only ninety degrees is allowed', () => {
    const req = request([rect('only', 0, 15, 5)], {
      allowedRotationsExplicit: [90],
    })
    req.sheets = [{ widthMm: 15, heightMm: 5, marginMm: 0, quantity: 1 }]

    const result = runAutomaticNest(req, {
      deterministic: true,
      now: () => 0,
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements.map(({ rotation }) => rotation)).not.toContain(0)
    expect(result.unplacedPartIds).toEqual(['only'])
  })

  it('is reproducible for the same deterministic seed and evaluation count', () => {
    const req = request([
      rect('a', 0, 30, 20),
      rect('b', 1, 25, 25),
      rect('c', 2, 15, 40),
    ])
    const run = () => {
      const evaluations: string[] = []
      const result = runAutomaticNest(req, {
        deterministic: true,
        seed: 123,
        now: () => 0,
        onEvaluation: ({ kind }) => evaluations.push(kind),
      })
      return { result, evaluations }
    }

    const first = run()
    const second = run()

    expect(first.result.status).toBe('ok')
    expect(second.result.status).toBe('ok')
    if (first.result.status !== 'ok' || second.result.status !== 'ok') return
    expect(second.result.placements).toEqual(first.result.placements)
    expect(second.evaluations).toEqual(first.evaluations)
  })

  it('uses compact run-local individual cache keys', async () => {
    const settingsKeys: string[] = []
    vi.resetModules()
    vi.doMock('./individual', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./individual')>()
      const individualKey: typeof actual.individualKey = (individual, key) => {
        settingsKeys.push(key)
        return actual.individualKey(individual, key)
      }
      return { ...actual, individualKey }
    })

    try {
      const { runAutomaticNest: runMockedAutomaticNest } =
        await import('./automaticOptimizer')
      const result = runMockedAutomaticNest(
        request([rect('a', 0, 20, 10), rect('b', 1, 10, 20)], {
          allowRotation: true,
          rotationStepDeg: 1,
        }),
        { deterministic: true, now: () => 0 },
      )

      expect(result.status).toBe('ok')
      expect(settingsKeys.length).toBeGreaterThan(0)
      expect(new Set(settingsKeys)).toEqual(new Set(['']))
    } finally {
      vi.doUnmock('./individual')
      vi.resetModules()
    }
  })

  it('returns the latest exact champion when aborted between evaluations', () => {
    const controller = new AbortController()
    const published: NestingSuccess[] = []
    let exactEvaluations = 0
    const result = runAutomaticNest(
      request([rect('a', 0, 30, 20), rect('b', 1, 25, 25)]),
      {
        deterministic: true,
        signal: controller.signal,
        onProgress: ({ bestSoFar }) => {
          if (bestSoFar) published.push(bestSoFar)
        },
        onEvaluation: ({ kind }) => {
          if (kind === 'exact' && ++exactEvaluations === 2) controller.abort()
        },
      },
    )

    expect(result.status).toBe('cancelled')
    if (result.status !== 'cancelled') return
    expect(result.bestSoFar).toBeTruthy()
    expect(compareNestingResults(result.bestSoFar!, published.at(-1)!)).toBe(0)
  })

  it('returns the seed champion when aborted during finalist refinement', () => {
    const controller = new AbortController()
    let exactEvaluations = 0
    let seedChampion: NestingSuccess | undefined
    const result = runAutomaticNest(request([rect('a', 0, 20, 10)], {
      allowRotation: false,
    }), {
      deterministic: true,
      signal: controller.signal,
      onProgress: ({ bestSoFar }) => {
        seedChampion ??= bestSoFar
      },
      onEvaluation: ({ kind }) => {
        if (kind === 'exact' && ++exactEvaluations === 2) controller.abort()
      },
    })

    expect(result.status).toBe('cancelled')
    if (result.status !== 'cancelled') return
    expect(compareNestingResults(result.bestSoFar!, seedChampion!)).toBe(0)
  })

  it('does not expose the live champion through progress', () => {
    let clock = 0
    const result = runAutomaticNest(request([rect('a', 0, 20, 10)], {
      allowRotation: false,
    }), {
      deterministic: false,
      now: () => clock,
      onProgress: ({ bestSoFar }) => {
        if (!bestSoFar) return
        bestSoFar.placements.length = 0
        bestSoFar.sheets[0]!.placedCount = 0
        bestSoFar.statistics.placedCount = 0
        bestSoFar.unplacedPartIds.push('observer-corruption')
        clock = 5_000
      },
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements).toHaveLength(1)
    expect(result.sheets[0]?.placedCount).toBe(1)
    expect(result.statistics.placedCount).toBe(1)
    expect(result.unplacedPartIds).toEqual([])
  })

  it('publishes structured progress activity independently of messages', () => {
    const progress: NestProgress[] = []

    runAutomaticNest(request([rect('a', 0, 20, 10)], {
      allowRotation: false,
    }), {
      deterministic: true,
      onProgress: (item) => progress.push(item),
    })

    expect(progress.every(({ activity }) => activity != null)).toBe(true)
    expect(progress.find(({ phase }) => phase === 'seed')?.activity).toBe(
      'initial',
    )
    expect(
      progress.find(({ message }) => message?.startsWith('Trying orders'))
        ?.activity,
    ).toBe('orders')
    expect(
      progress.find(({ message }) => message?.startsWith('Improving layout · layer'))
        ?.activity,
    ).toBe('beam')
    expect(
      progress.find(({ message }) => message?.includes('finalist'))?.activity,
    ).toBe('refine')
    expect(
      progress.find(({ message }) => message === 'Improving layout')?.activity,
    ).toBe('repair')
    expect(progress.at(-1)?.activity).toBe('verify')
  })

  it('returns before preparation when already aborted', async () => {
    vi.resetModules()
    vi.doMock('../core/prepare', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../core/prepare')>()
      return { ...actual, prepareParts: vi.fn(actual.prepareParts) }
    })

    try {
      const { runAutomaticNest: runMockedAutomaticNest } =
        await import('./automaticOptimizer')
      const prepareModule = await import('../core/prepare')
      const controller = new AbortController()
      controller.abort()
      const progress: NestProgress[] = []
      const evaluations: string[] = []
      const attempts: unknown[] = []

      const result = runMockedAutomaticNest(
        request([rect('a', 0, 20, 10)]),
        {
          signal: controller.signal,
          onProgress: (item) => progress.push(item),
          onEvaluation: ({ kind }) => evaluations.push(kind),
          onAttempt: (attempt) => attempts.push(attempt),
        },
      )

      expect(result).toMatchObject({ status: 'cancelled', bestSoFar: null })
      expect(vi.mocked(prepareModule.prepareParts)).not.toHaveBeenCalled()
      expect(progress).toEqual([])
      expect(evaluations).toEqual([])
      expect(attempts).toEqual([])
    } finally {
      vi.doUnmock('../core/prepare')
      vi.resetModules()
    }
  })

  it('stops before preparation when its progress observer aborts', () => {
    const controller = new AbortController()
    const messages: Array<string | undefined> = []
    const evaluations: string[] = []
    const attempts: unknown[] = []

    const result = runAutomaticNest(request([rect('a', 0, 20, 10)]), {
      signal: controller.signal,
      onProgress: ({ message }) => {
        messages.push(message)
        controller.abort()
      },
      onEvaluation: ({ kind }) => evaluations.push(kind),
      onAttempt: (attempt) => attempts.push(attempt),
    })

    expect(result).toMatchObject({ status: 'cancelled', bestSoFar: null })
    expect(messages).toEqual(['Preparing parts'])
    expect(evaluations).toEqual([])
    expect(attempts).toEqual([])
  })

  it('does not publish cheap or equal exact candidates', () => {
    const progress: NestProgress[] = []
    const exactImprovements: boolean[] = []

    const result = runAutomaticNest(request([rect('a', 0, 20, 10)], {
      allowRotation: false,
    }), {
      deterministic: true,
      onProgress: (item) => progress.push(item),
      onEvaluation: ({ kind, improved }) => {
        if (kind === 'exact') exactImprovements.push(improved)
      },
    })

    expect(result.status).toBe('ok')
    expect(exactImprovements).toContain(false)
    expect(champions(progress)).toHaveLength(1)
  })

  it('does not replay a non-beam candidate that only beats the exact champion', async () => {
    const { defaultTargetExactCalls } = await fidelityPromotionScenario(75)

    expect(defaultTargetExactCalls).toBe(0)
  })

  it('replays a non-beam candidate that improves the champion cheap result', async () => {
    const { defaultTargetExactCalls } = await fidelityPromotionScenario(45)

    expect(defaultTargetExactCalls).toBe(1)
  })

  it('preserves a supplied non-default rotation when ranking an exact candidate', async () => {
    const req = request([
      rect('a', 0, 15, 14),
      rect('b', 1, 17, 8),
      rect('c', 2, 3, 18),
      rect('d', 3, 5, 12),
    ], {
      allowedRotations: [0, 90],
      allowedRotationsExplicit: [0, 90],
      allowArbitraryRotation: false,
      rotationMode: 'orthogonal',
    })
    req.sheets = [{ widthMm: 22, heightMm: 30, marginMm: 0, quantity: 2 }]
    const supplied = {
      order: ['a', 'b', 'c', 'd'],
      rotations: [0, 0, 90, 0],
    }
    const suppliedResult = placeWithPlan(req, supplied, {
      nfpFidelity: 'exact',
    })
    const rerotatedResult = placeWithOrder(req, supplied.order, {
      freeAngleDepth: 'quick',
      nfpFidelity: 'simplified',
    })
    expect(suppliedResult.status).toBe('ok')
    expect(rerotatedResult.status).toBe('ok')
    if (suppliedResult.status !== 'ok' || rerotatedResult.status !== 'ok') return
    expect(suppliedResult.placements.find(({ partId }) => partId === 'c')?.rotation)
      .toBe(90)
    expect(isBetterNestingResult(suppliedResult, rerotatedResult)).toBe(true)

    vi.resetModules()
    vi.doMock('./localSearch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./localSearch')>()
      const localSearchImprove: typeof actual.localSearchImprove = (
        _start,
        _allowed,
        _rng,
        evaluate,
      ) => {
        evaluate(supplied)
        return supplied
      }
      return { ...actual, localSearchImprove }
    })

    try {
      const { runAutomaticNest: runMockedAutomaticNest } =
        await import('./automaticOptimizer')
      const published: NestingSuccess[] = []
      const result = runMockedAutomaticNest(req, {
        deterministic: true,
        now: () => 0,
        onProgress: ({ bestSoFar }) => {
          if (bestSoFar) published.push(bestSoFar)
        },
      })

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') return
      expect(published.some((candidate) =>
        compareNestingResults(candidate, suppliedResult) === 0 &&
        candidate.placements.map(({ rotation }) => rotation).join(',') ===
          suppliedResult.placements.map(({ rotation }) => rotation).join(','),
      )).toBe(true)
      expect(compareNestingResults(result, suppliedResult)).toBeLessThanOrEqual(0)
    } finally {
      vi.doUnmock('./localSearch')
      vi.resetModules()
    }
  })

  it('continues past a non-improving local move to exact-gate a restart leader', async () => {
    const { events, localEvaluationCounts, result, rngSeeds } =
      await mixedNeighborhoodScenario()

    const requiredOrdersEnd = events.lastIndexOf('orders')
    const local = events.indexOf('local')
    const mixed = events.indexOf('local:worse')
    expect(requiredOrdersEnd).toBeGreaterThan(-1)
    expect(local).toBeGreaterThan(requiredOrdersEnd)
    expect(mixed).toBeGreaterThan(local)
    expect(events.slice(mixed, mixed + 3)).toEqual([
      'local:worse', 'restart:leader', 'exact:improved',
    ])
    expect(localEvaluationCounts).toEqual([16])
    expect(rngSeeds).toEqual([7, 7, 7])
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.wasteMm2).toBe(50)
  })

  it('exact-gates the large-part area-tallest seed before mixed evaluations', async () => {
    const { events, result } = await largeExtremeSeedScenario()

    expect(events.slice(0, 2)).toEqual([
      'simplified:tallest',
      'exact:tallest',
    ])
    expect(events).not.toContain('mixed')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.wasteMm2).toBe(50)
  })

  it('exact-gates the distinct compact-fill widest plan after required orders', async () => {
    const { events, result } = await compactWidestScenario()
    const lastOrder = events.lastIndexOf('orders')
    const simplified = events.indexOf('compact:simplified')
    const exact = events.indexOf('compact:exact')

    expect(lastOrder).toBeGreaterThan(-1)
    expect(simplified).toBeGreaterThan(lastOrder)
    expect(exact).toBeGreaterThan(simplified)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.wasteMm2).toBe(50)
  })

  it('preserves the champion when an exact replay rejects a cheap improvement', async () => {
    const { defaultTargetExactCalls, publishedChampions } =
      await fidelityPromotionScenario(45)

    expect(defaultTargetExactCalls).toBe(1)
    expect(publishedChampions).toBe(1)
  })

  it('uses the mixed phase before the legacy beam for mutable requests', async () => {
    const { beamLayers, stableBeamLayers } = await fidelityPromotionScenario(75, {
      stopAtFirstLayer: false,
      childWaste: 1,
    })

    expect(beamLayers).toEqual([])
    expect(stableBeamLayers).toEqual([])
  })

  it('runs seed one-degree polish only after a strict refine improvement', async () => {
    expect(await refinementScenario(90)).toEqual([
      { stage: 'refine', improved: true },
      { stage: 'seed', improved: true },
    ])
  })

  it('stops finalist refinement after a non-improving refine stage', async () => {
    expect(await refinementScenario(110)).toEqual([
      { stage: 'refine', improved: false },
    ])
  })

  it('finds an exact-validated allowed rotation before local refinement', () => {
    const part = rect('bar', 0, 100, 1)
    const radians = (30 * Math.PI) / 180
    const req = request([part])
    req.sheets = [{
      widthMm: 100 * Math.cos(radians) + Math.sin(radians) + 1e-6,
      heightMm: 100 * Math.sin(radians) + Math.cos(radians) + 1e-6,
      marginMm: 0,
      quantity: 1,
    }]
    const messages: string[] = []
    const evaluations: Array<{
      stage: 'search' | 'coarse' | 'refine'
      kind: 'rank' | 'exact'
      improved: boolean
    }> = []
    let stage: 'search' | 'coarse' | 'refine' = 'search'

    const result = runAutomaticNest(req, {
      deterministic: true,
      now: () => 0,
      onProgress: ({ message }) => {
        if (!message) return
        messages.push(message)
        if (message === 'Improving layout · coarse finalist') stage = 'coarse'
        if (message === 'Improving layout · refining finalist') stage = 'refine'
      },
      onEvaluation: ({ kind, improved }) => {
        evaluations.push({ stage, kind, improved })
      },
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.statistics.placedCount).toBe(1)
    expect([30, 150, 210, 330]).toContain(result.placements[0]?.rotation)
    const replay = placeWithPlan(req, planFor(result), { nfpFidelity: 'exact' })
    expect(replay.status).toBe('ok')
    if (replay.status === 'ok') {
      expect(compareNestingResults(replay, result)).toBe(0)
    }
    expect(messages).not.toContain('Improving layout · coarse finalist')
    expect(evaluations.some(({ stage, kind, improved }) =>
      (stage === 'search' || stage === 'coarse') && kind === 'exact' && improved,
    )).toBe(true)
    expect(evaluations.length).toBeLessThan(50)
  })

  it('refines a repair champion before evaluating another repair', async () => {
    const { sequence } = await repairImprovementScenario()
    const repairRank = sequence.indexOf('rank:candidate:true')
    const repairChampion = sequence.indexOf('repair:champion')
    const repairExact = sequence.indexOf('exact:candidate:true')
    const coarseStart = sequence.indexOf('repair:coarse:start')
    const coarseRank = sequence.indexOf('rank:coarse:false')
    const refineStart = sequence.indexOf('repair:refine:start')
    const refineExact = sequence.indexOf('exact:refine:true')
    const nextRepairRank = sequence.findIndex(
      (event, index) => index > repairExact && event.startsWith('rank:candidate:'),
    )

    expect(repairRank).toBeGreaterThan(-1)
    expect(repairChampion).toBeGreaterThan(repairRank)
    expect(repairExact).toBeGreaterThan(repairChampion)
    expect(coarseStart).toBeGreaterThan(repairExact)
    expect(coarseRank).toBeGreaterThan(coarseStart)
    expect(refineStart).toBeGreaterThan(coarseRank)
    expect(refineExact).toBeGreaterThan(refineStart)
    expect(nextRepairRank === -1 || nextRepairRank > refineExact).toBe(true)
  })

  it('rewards the applied repair operator only after exact champion promotion', async () => {
    const {
      proposedOperators,
      rewardedProposalOperators,
      rewardSpy,
      sequence,
    } = await repairImprovementScenario()
    const repairExact = sequence.indexOf('exact:candidate:true')
    const rewardEvent = sequence.findIndex((event) => event.startsWith('reward:'))
    const rewardedOperator = rewardSpy.mock.calls[0]?.[1]

    expect(rewardSpy).toHaveBeenCalledTimes(1)
    expect(rewardedOperator).toBe(proposedOperators.at(-1))
    expect(rewardedProposalOperators).toEqual([rewardedOperator])
    expect(rewardEvent).toBeGreaterThan(repairExact)
  })

  it('does not reward a repair operator when exact replay does not improve', async () => {
    const { result, rewardSpy, sequence } = await repairImprovementScenario(100)

    expect(result.status).toBe('ok')
    expect(sequence).toContain('exact:candidate:false')
    expect(rewardSpy).not.toHaveBeenCalled()
  })

  it('forwards attempt telemetry only from the initial BLF pass', () => {
    const req = request([rect('a', 0, 20, 10), rect('b', 1, 10, 20)])
    const seedAttempts: unknown[] = []
    const automaticAttempts: unknown[] = []

    runBottomLeftNest(req, {
      freeAngleDepth: 'orthogonal',
      nfpFidelity: 'simplified',
      exactFallback: true,
      onAttempt: (attempt) => seedAttempts.push(attempt),
    })
    runAutomaticNest(req, {
      deterministic: true,
      onAttempt: (attempt) => automaticAttempts.push(attempt),
    })

    expect(automaticAttempts).toEqual(seedAttempts)
  })

  it('uses the first-champion safety ceiling without the old stagnation stop', () => {
    const req = request([rect('a', 0, 20, 10), rect('b', 1, 10, 20)])

    let safetyClock = 0
    let safetyRanks = 0
    const safety = runAutomaticNest(req, {
      deterministic: false,
      now: () => safetyClock,
      onProgress: ({ bestSoFar }) => {
        if (bestSoFar) safetyClock = 7_000
      },
      onEvaluation: ({ kind }) => {
        if (kind === 'rank') safetyRanks++
      },
    })

    let stagnationClock = 0
    let stagnationRanks = 0
    const stagnation = runAutomaticNest(req, {
      deterministic: false,
      now: () => stagnationClock,
      onEvaluation: ({ kind }) => {
        if (kind === 'rank') {
          stagnationRanks++
          stagnationClock = 100
        }
      },
    })

    expect(safety.status).toBe('ok')
    expect(safetyRanks).toBe(0)
    expect(stagnation.status).toBe('ok')
    expect(stagnationRanks).toBeGreaterThan(1)
  })

  it('evaluates every required deterministic order before beam search', () => {
    const req = request([
      rect('a', 0, 40, 10),
      rect('b', 1, 20, 20),
      rect('c', 2, 10, 30),
      rect('d', 3, 15, 15),
    ])
    const prepared = prepareParts(req.parts, req.settings, { sortByArea: true })
    const required = buildOrderCandidates(prepared, createRng(7), {
      includeRandom: false,
    }).map(({ name }) => name)
    const tried: string[] = []

    const result = runAutomaticNest(req, {
      deterministic: true,
      onProgress: ({ message }) => {
        const prefix = 'Trying orders · '
        if (message?.startsWith(prefix)) tried.push(message.slice(prefix.length))
      },
    })

    expect(result.status).toBe('ok')
    expect(tried).toEqual(required)
  })

  it('iterates beam layers, refines finalists, and terminates duplicate repair', () => {
    const messages: string[] = []
    const started = performance.now()
    const result = runAutomaticNest(
      request([rect('a', 0, 20, 10)], { allowRotation: false }),
      {
        deterministic: true,
        onProgress: ({ message }) => {
          if (message) messages.push(message)
        },
      },
    )

    expect(result.status).toBe('ok')
    expect(messages.some((message) => message.startsWith('Improving layout · layer')))
      .toBe(true)
    expect(messages.some((message) => message === 'Improving layout · refining finalist'))
      .toBe(true)
    expect(messages).not.toContain('Improving layout · polishing finalist')
    expect(messages.at(-1)).toBe('Verifying result')
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  it('reports nonnegative evaluation durations and isolates observers', () => {
    let tick = 0
    const diagnostics: Array<{ kind: string; elapsedMs: number; improved: boolean }> = []

    const result = runAutomaticNest(request([rect('a', 0, 20, 10)], {
      allowRotation: false,
    }), {
      deterministic: true,
      now: () => tick++,
      onProgress: () => {
        throw new Error('ignored progress observer')
      },
      onEvaluation: (info) => {
        diagnostics.push(info)
        throw new Error('ignored diagnostic observer')
      },
    })

    expect(result.status).toBe('ok')
    expect(new Set(diagnostics.map(({ kind }) => kind))).toEqual(
      new Set(['rank', 'exact']),
    )
    expect(diagnostics.every(({ elapsedMs }) => elapsedMs >= 0)).toBe(true)
    expect(diagnostics.some(({ kind, improved }) => kind === 'exact' && improved))
      .toBe(true)
    expect(diagnostics.some(({ kind, improved }) => kind === 'exact' && !improved))
      .toBe(true)
  })

  it('returns a valid empty BLF result', () => {
    const result = runAutomaticNest(request([]), {
      deterministic: true,
      now: () => 10,
    })

    expect(result).toMatchObject({
      status: 'ok',
      placements: [],
      unplacedPartIds: [],
      engineId: 'automatic-blf-v1',
      calculationTimeMs: 0,
    })
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects a non-finite seed (%s)',
    (seed) => {
      expect(() => runAutomaticNest(request([]), { seed })).toThrow('seed')
    },
  )
})
