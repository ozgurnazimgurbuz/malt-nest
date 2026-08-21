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
  req.settings.timeLimitMs = 10_000
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
  let championOrderKey = JSON.stringify(seedOrder)
  let defaultTargetExactCalls = 0
  const eventOrderKeys: string[] = []
  let terminalBeamOrderKeys: string[] = []
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
          placementOptions.freeAngleDepth === 'event'
        ) {
          eventOrderKeys.push(JSON.stringify(plan.order))
        }
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
  vi.doMock('./beamSearch', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./beamSearch')>()
    const selectBeam: typeof actual.selectBeam = (candidates, width, runKey) => {
      const selected = actual.selectBeam(candidates, width, runKey)
      terminalBeamOrderKeys = selected.map(({ individual }) =>
        JSON.stringify(individual.order),
      )
      return selected
    }
    return { ...actual, selectBeam }
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
        if (bestSoFar) {
          publishedChampions++
          championOrderKey = JSON.stringify([
            ...bestSoFar.placements.map(({ partId }) => partId),
            ...bestSoFar.unplacedPartIds,
          ])
        }
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
      championOrderKey,
      defaultTargetExactCalls,
      eventOrderKeys,
      publishedChampions,
      stableBeamLayers,
      terminalBeamOrderKeys,
    }
  } finally {
    vi.doUnmock('../placement/blf')
    vi.doUnmock('./beamSearch')
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
            : options.freeAngleDepth === 'event'
              ? 70
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
    type FinalistStage = 'refine' | 'seed' | 'event'
    const finalistStages: Array<{ stage: FinalistStage; improved: boolean }> = []
    let finalistStage: FinalistStage | null = null
    runMockedAutomaticNest(req, {
      deterministic: true,
      now: () => 0,
      onProgress: ({ message }) => {
        if (message === 'Improving layout · refining finalist') {
          finalistStage = 'refine'
        } else if (message === 'Improving layout · polishing finalist') {
          finalistStage = 'seed'
        } else if (message === 'Improving layout · bounded-angle finalist') {
          finalistStage = 'event'
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
  const req = request([
    rect('a', 0, 83, 65),
    rect('b', 1, 40, 30),
  ], { allowRotation: false })
  req.sheets = [{ widthMm: 500, heightMm: 500, marginMm: 0, quantity: 1 }]
  req.settings.timeLimitMs = 10_000
  const seedOrder = prepareParts(req.parts, req.settings, {
    sortByArea: true,
  }).map(({ partId }) => partId)
  const repairOrder = seedOrder.slice().reverse()
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
            ? options.freeAngleDepth === 'refine'
              ? 40
              : options.freeAngleDepth === 'event'
                ? 30
                : repairExactWaste
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
  vi.doMock('./beamSearch', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./beamSearch')>()
    const selectBeam: typeof actual.selectBeam = (candidates, width, runKey) => {
      const selected = actual.selectBeam(candidates, width, runKey)
      const seed = selected.find(({ individual }) =>
        JSON.stringify(individual.order) === JSON.stringify(seedOrder),
      )
      return seed ? [seed] : selected.slice(0, 1)
    }
    const expandOrder: typeof actual.expandOrder = () => []
    return { ...actual, expandOrder, selectBeam }
  })
  vi.doMock('./destroyRepair', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./destroyRepair')>()
    const proposeRepair: typeof actual.proposeRepair = () => {
      const proposal = {
        individual: {
          order: repairOrder,
          rotations: repairOrder.map(() => 90),
        },
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
    let clock = 0
    let inRepair = false
    let repairStage: 'candidate' | 'coarse' | 'refine' | 'seed' | 'event' =
      'candidate'
    const result = runMockedAutomaticNest(req, {
      deterministic: false,
      now: () => clock,
      signal: controller.signal,
      onProgress: ({ bestSoFar, message }) => {
        if (message === 'Improving layout' && !inRepair) {
          phase = 'repair'
          inRepair = true
          sequence.push('repair:start')
        }
        if (!inRepair) return
        if (bestSoFar) {
          sequence.push('repair:champion')
          clock = 5_000
        }
        if (message === 'Verifying result') sequence.push('finish')
        if (message === 'Improving layout · coarse repair champion') {
          repairStage = 'coarse'
          sequence.push('repair:coarse:start')
        } else if (message === 'Improving layout · refining repair champion') {
          repairStage = 'refine'
          sequence.push('repair:refine:start')
        } else if (message === 'Improving layout · polishing repair champion') {
          repairStage = 'seed'
          sequence.push('repair:seed:start')
        } else if (message === 'Improving layout · bounded-angle repair champion') {
          repairStage = 'event'
          sequence.push('repair:event:start')
        }
      },
      onEvaluation: ({ kind, improved }) => {
        if (!inRepair) return
        sequence.push(`${kind}:${repairStage}:${improved}`)
        if (kind === 'exact' && repairStage === 'event') controller.abort()
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
    vi.doUnmock('./beamSearch')
    vi.doUnmock('./destroyRepair')
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
    ], { allowRotation: false })
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
    ], { allowRotation: false })
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

  it('keeps a valid partial seed when the constructive pass is cancelled', async () => {
    const req = request([rect('a', 0, 30, 20), rect('b', 1, 25, 25)])
    vi.resetModules()
    vi.doMock('../placement/blf', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../placement/blf')>()
      const runBottomLeftNestUnchecked: typeof actual.runBottomLeftNestUnchecked =
        (nestRequest, options) => {
          const firstPart = options.preparedParts?.[0]?.partId
          const partial = scoredResult(
            nestRequest,
            firstPart ? [firstPart] : [],
            10,
          )
          partial.unplacedPartIds = nestRequest.parts
            .map(({ id }) => id)
            .filter((id) => id !== firstPart)
          partial.statistics.placedCount = partial.placements.length
          partial.statistics.unplacedCount = partial.unplacedPartIds.length
          return {
            status: 'cancelled' as const,
            message: 'Cancelled',
            bestSoFar: partial,
          }
        }
      return { ...actual, runBottomLeftNestUnchecked }
    })

    try {
      const { runAutomaticNest: runMockedAutomaticNest } =
        await import('./automaticOptimizer')
      const result = runMockedAutomaticNest(req, { deterministic: true })

      expect(result.status).toBe('cancelled')
      if (result.status !== 'cancelled') return
      expect(result.bestSoFar?.placements).toHaveLength(1)
    } finally {
      vi.doUnmock('../placement/blf')
      vi.resetModules()
    }
  })

  it('completes a physically placeable seed after the automatic deadline', () => {
    const req = request([
      rect('a', 0, 20, 20),
      rect('b', 1, 15, 15),
    ])
    req.settings.timeLimitMs = 0.001

    const result = runAutomaticNest(req)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.placements).toHaveLength(2)
    expect(result.unplacedPartIds).toEqual([])
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

  it('cancels a full replay without publishing its partial result', async () => {
    const req = request([rect('a', 0, 20, 10)], { allowRotation: false })
    req.settings.timeLimitMs = 10_000
    const controller = new AbortController()
    let eventCalls = 0
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
        (nestRequest, plan, options) => {
          if (options.freeAngleDepth === 'event') {
            eventCalls++
            controller.abort()
            return {
              status: 'cancelled',
              message: 'Cancelled',
              bestSoFar: scoredResult(nestRequest, plan.order, 0),
            }
          }
          return scoredResult(nestRequest, plan.order, 100)
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
      let clock = 0
      let lastPublished: NestingSuccess | undefined
      const result = runMockedAutomaticNest(req, {
        deterministic: false,
        now: () => clock,
        signal: controller.signal,
        onProgress: ({ bestSoFar }) => {
          if (!bestSoFar) return
          lastPublished = bestSoFar
          clock = 5_000
        },
      })

      expect(eventCalls).toBe(1)
      expect(result.status).toBe('cancelled')
      if (result.status !== 'cancelled') return
      expect(result.bestSoFar).toBeTruthy()
      expect(lastPublished?.wasteMm2).not.toBe(0)
      expect(compareNestingResults(result.bestSoFar!, lastPublished!)).toBe(0)
      expect(result.bestSoFar?.wasteMm2).not.toBe(0)
    } finally {
      vi.doUnmock('../placement/blf')
      vi.resetModules()
    }
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

    let suppliedExpanded = false
    let suppliedPlanRanks = 0
    vi.resetModules()
    vi.doMock('../placement/blf', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../placement/blf')>()
      const placeWithPlanUnchecked: typeof actual.placeWithPlanUnchecked = (
        nestRequest,
        plan,
        options,
      ) => {
        if (
          options.freeAngleDepth === 'quick' &&
          plan.order.join() === supplied.order.join() &&
          plan.rotations.join() === supplied.rotations.join()
        ) {
          suppliedPlanRanks++
        }
        return actual.placeWithPlanUnchecked(nestRequest, plan, options)
      }
      return { ...actual, placeWithPlanUnchecked }
    })
    vi.doMock('./beamSearch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./beamSearch')>()
      const expandOrder: typeof actual.expandOrder = () => {
        if (suppliedExpanded) return []
        suppliedExpanded = true
        return [supplied]
      }
      return { ...actual, expandOrder }
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
      expect(suppliedExpanded).toBe(true)
      expect(suppliedPlanRanks).toBeGreaterThan(0)
      expect(published.some((candidate) =>
        compareNestingResults(candidate, suppliedResult) === 0 &&
        candidate.placements.map(({ rotation }) => rotation).join(',') ===
          suppliedResult.placements.map(({ rotation }) => rotation).join(','),
      )).toBe(true)
      expect(compareNestingResults(result, suppliedResult)).toBeLessThanOrEqual(0)
    } finally {
      vi.doUnmock('../placement/blf')
      vi.doUnmock('./beamSearch')
      vi.resetModules()
    }
  })

  it('reserves convergence budget for beam and finalist refinement', () => {
    const messages: string[] = []
    const result = runAutomaticNest(request([
      rect('wide', 0, 45, 12),
      rect('tall', 1, 14, 38),
    ]), {
      deterministic: true,
      now: () => 0,
      onProgress: ({ message }) => {
        if (message) messages.push(message)
      },
    })

    expect(result.status).toBe('ok')
    expect(messages.some((message) =>
      message.startsWith('Improving layout · layer '),
    )).toBe(true)
    expect(messages).toContain('Improving layout · coarse finalist')
    expect(messages).toContain('Improving layout · refining finalist')
  })

  it('preserves the champion when an exact replay rejects a cheap improvement', async () => {
    const { defaultTargetExactCalls, publishedChampions } =
      await fidelityPromotionScenario(45)

    expect(defaultTargetExactCalls).toBe(1)
    expect(publishedChampions).toBe(1)
  })

  it('preserves convergence terminal orders through bounded-angle finalists', async () => {
    const {
      championOrderKey,
      eventOrderKeys,
      terminalBeamOrderKeys,
    } = await fidelityPromotionScenario(75, { stopAtFirstLayer: true })

    expect(new Set(eventOrderKeys)).toEqual(
      new Set([championOrderKey, ...terminalBeamOrderKeys]),
    )
  })

  it('runs seed one-degree polish only after a strict refine improvement', async () => {
    expect(await refinementScenario(90)).toEqual([
      { stage: 'refine', improved: true },
      { stage: 'seed', improved: true },
      { stage: 'event', improved: true },
    ])
  })

  it('runs bounded-angle refinement after a non-improving refine stage', async () => {
    expect(await refinementScenario(110)).toEqual([
      { stage: 'refine', improved: false },
      { stage: 'event', improved: true },
    ])
  })

  it('deduplicates bounded-angle finalists by order', async () => {
    const req = request([rect('a', 0, 20, 10)], { allowRotation: false })
    let finalistRefinements = 0
    const eventOrders: string[] = []
    vi.resetModules()
    vi.doMock('../placement/blf', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../placement/blf')>()
      const runBottomLeftNestUnchecked: typeof actual.runBottomLeftNestUnchecked =
        (nestRequest, options) => scoredResult(
          nestRequest,
          options.preparedParts?.map(({ partId }) => partId) ?? [],
          100,
        )
      const placeWithOrderUnchecked: typeof actual.placeWithOrderUnchecked =
        (nestRequest, order) => scoredResult(nestRequest, order, 100)
      const placeWithPlanUnchecked: typeof actual.placeWithPlanUnchecked =
        (nestRequest, plan, options) => {
          if (options.freeAngleDepth === 'event') {
            eventOrders.push(JSON.stringify(plan.order))
          }
          const result = scoredResult(nestRequest, plan.order, 100)
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
    vi.doMock('./beamSearch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./beamSearch')>()
      const selectBeam: typeof actual.selectBeam = (candidates, width, runKey) => {
        const selected = actual.selectBeam(candidates, width, runKey)
        if (!selected[0]) return selected
        return [
          selected[0],
          {
            ...selected[0],
            individual: {
              order: selected[0].individual.order.slice(),
              rotations: selected[0].individual.rotations.map(
                (rotation) => rotation + 90,
              ),
            },
          },
        ]
      }
      return { ...actual, selectBeam }
    })

    try {
      const { runAutomaticNest: runMockedAutomaticNest } =
        await import('./automaticOptimizer')
      runMockedAutomaticNest(req, {
        deterministic: true,
        now: () => 0,
        onProgress: ({ message }) => {
          if (message === 'Improving layout · refining finalist') {
            finalistRefinements++
          }
        },
      })

      expect(finalistRefinements).toBe(1)
      expect(eventOrders).toEqual([JSON.stringify(['a'])])
    } finally {
      vi.doUnmock('../placement/blf')
      vi.doUnmock('./beamSearch')
      vi.resetModules()
    }
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
    expect(messages).toContain('Improving layout · coarse finalist')
    expect(evaluations.some(({ stage, kind, improved }) =>
      (stage === 'search' || stage === 'coarse') && kind === 'exact' && improved,
    )).toBe(true)
    expect(evaluations.length).toBeLessThan(50)
  })

  it('searches allowed rotations for required quick-order candidates', async () => {
    const req = request([rect('bar', 0, 100, 10)], {
      allowedRotations: [0, 90],
      allowedRotationsExplicit: [0, 90],
      allowArbitraryRotation: false,
      rotationMode: 'orthogonal',
    })
    req.sheets = [{
      widthMm: 20,
      heightMm: 110,
      marginMm: 0,
      quantity: 1,
    }]
    const fixed = placeWithPlan(req, {
      order: ['bar'],
      rotations: [0],
    }, {
      freeAngleDepth: 'quick',
      nfpFidelity: 'simplified',
    })
    const searched = placeWithOrder(req, ['bar'], {
      freeAngleDepth: 'quick',
      nfpFidelity: 'simplified',
    })

    expect(fixed.status).toBe('ok')
    expect(searched.status).toBe('ok')
    if (fixed.status !== 'ok' || searched.status !== 'ok') return
    expect(fixed.statistics.placedCount).toBe(0)
    expect(searched.statistics.placedCount).toBe(1)
    expect(searched.placements[0]?.rotation).toBe(90)

    const controller = new AbortController()
    let quickOrderCalls = 0
    vi.resetModules()
    vi.doMock('../placement/blf', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../placement/blf')>()
      const placeWithOrderUnchecked: typeof actual.placeWithOrderUnchecked =
        (nestRequest, order, options) => {
          const result = actual.placeWithOrderUnchecked(
            nestRequest,
            order,
            options,
          )
          if (options.freeAngleDepth === 'quick') {
            quickOrderCalls++
            controller.abort()
          }
          return result
        }
      return { ...actual, placeWithOrderUnchecked }
    })

    try {
      const { runAutomaticNest: runMockedAutomaticNest } =
        await import('./automaticOptimizer')
      runMockedAutomaticNest(req, {
        deterministic: true,
        now: () => 0,
        signal: controller.signal,
      })
      expect(quickOrderCalls).toBe(1)
    } finally {
      vi.doUnmock('../placement/blf')
      vi.resetModules()
    }
  })

  it('preserves a repair champion through bounded-angle search before another repair', async () => {
    const { sequence } = await repairImprovementScenario()
    const repairRank = sequence.indexOf('rank:candidate:true')
    const repairChampion = sequence.indexOf('repair:champion')
    const repairExact = sequence.indexOf('exact:candidate:true')
    const repairEventStart = sequence.indexOf('repair:event:start')
    const repairEvent = sequence.indexOf('exact:event:true')
    const nextRepairRankOrFinish = sequence.findIndex(
      (event, index) =>
        index > repairExact &&
        (event.startsWith('rank:candidate:') || event === 'finish'),
    )

    expect(repairRank).toBeGreaterThan(-1)
    expect(repairChampion).toBeGreaterThan(repairRank)
    expect(repairExact).toBeGreaterThan(repairChampion)
    expect(repairEventStart).toBeGreaterThan(repairExact)
    expect(repairEvent).toBeGreaterThan(repairEventStart)
    expect(
      nextRepairRankOrFinish === -1 || nextRepairRankOrFinish > repairEvent,
    ).toBe(true)
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

  it('uses the request-start safety ceiling before ranking orders', () => {
    const req = request([rect('a', 0, 20, 10), rect('b', 1, 10, 20)])

    let clock = 0
    let ranks = 0
    const result = runAutomaticNest(req, {
      deterministic: false,
      now: () => clock,
      onProgress: ({ bestSoFar }) => {
        if (bestSoFar) clock = 5_000
      },
      onEvaluation: ({ kind }) => {
        if (kind === 'rank') ranks++
      },
    })

    expect(result.status).toBe('ok')
    expect(ranks).toBe(0)
  })

  it('evaluates every required deterministic order before beam search', () => {
    const req = request([
      rect('a', 0, 40, 10),
      rect('b', 1, 20, 20),
      rect('c', 2, 10, 30),
      rect('d', 3, 15, 15),
    ], { allowRotation: false })
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
