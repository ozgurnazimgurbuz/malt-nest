import { describe, expect, it, vi } from 'vitest'
import type { GeometryPart } from '../../geometry'
import { boundingBox } from '../../geometry'
import { prepareParts } from '../core/prepare'
import { placeWithPlan, runBottomLeftNest } from '../placement/blf'
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
import { runAutomaticNest } from './automaticOptimizer'
import { buildOrderCandidates } from './orderSearch'
import { createRng } from './rng'

const settings: NestingSettings = {
  spacingMm: 0,
  allowedRotations: [0, 90, 180, 270],
  rotationStepDeg: null,
  allowArbitraryRotation: true,
  allowRotation: true,
  rotationMode: 'free',
  optimizationLevel: 'fast',
  timeLimitMs: 500,
  seed: 7,
}

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
  const targetOrder = alternatives[4]!.order
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
      (nestRequest, plan) => scoredResult(nestRequest, plan.order, 100)
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
    const exactOrderKeys: string[] = []
    const exactEvents: Array<{
      source: string
      stage: string
      order: readonly string[]
      improved: boolean
    }> = []
    const beamLayers: Array<{ layer: number; stable: boolean }> = []
    let publishedChampions = 0
    let clock = 0
    runMockedAutomaticNest(req, {
      deterministic: options.stopAtFirstLayer === false,
      now: () => clock,
      onBeamLayer: (info) => beamLayers.push(info),
      onExactReplay: (info) => {
        exactEvents.push(info)
        const { source, stage, order } = info
        if (source === 'order' && stage === 'fixed') {
          exactOrderKeys.push(order.join(','))
        }
      },
      onProgress: ({ bestSoFar, message }) => {
        if (bestSoFar) publishedChampions++
        if (
          options.stopAtFirstLayer !== false &&
          message?.startsWith('Improving layout · layer')
        ) {
          clock = 5_000
        }
      },
    })
    return {
      beamLayers,
      exactEvents,
      exactOrderKeys,
      publishedChampions,
      targetKey: targetOrder.join(','),
    }
  } finally {
    vi.doUnmock('../placement/blf')
    vi.resetModules()
  }
}

async function refinementScenario(refineWaste: number) {
  const req = request([rect('a', 0, 20, 10)])
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
    const finalistStages: Array<{ stage: string; improved: boolean }> = []
    runMockedAutomaticNest(req, {
      deterministic: true,
      now: () => 0,
      onExactReplay: ({ source, stage, improved }) => {
        if (source === 'finalist') finalistStages.push({ stage, improved })
      },
    })
    return finalistStages
  } finally {
    vi.doUnmock('../placement/blf')
    vi.resetModules()
  }
}

async function repairImprovementScenario() {
  const req = request([
    rect('a', 0, 83, 65),
    rect('b', 1, 42, 53),
    rect('c', 2, 82, 63),
    rect('d', 3, 47, 9),
    rect('e', 4, 23, 70),
    rect('f', 5, 40, 6),
  ])
  req.sheets = [{ widthMm: 500, heightMm: 500, marginMm: 0, quantity: 1 }]
  let phase: 'search' | 'repair' = 'search'
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
      (nestRequest, plan, options) => scoredResult(
        nestRequest,
        plan.order,
        phase === 'repair'
          ? options.freeAngleDepth === 'refine' ? 40 : 50
          : options.freeAngleDepth === 'refine' ? 110 : 100,
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
    const controller = new AbortController()
    const sequence: string[] = []
    runMockedAutomaticNest(req, {
      deterministic: true,
      now: () => 0,
      signal: controller.signal,
      onProgress: ({ message }) => {
        if (message === 'Improving layout') phase = 'repair'
      },
      onExactReplay: ({ source, stage }) => {
        if (source !== 'repair') return
        sequence.push(`exact:${stage}`)
        if (stage === 'refine') controller.abort()
      },
      onRepairReward: (operator) => {
        sequence.push(`reward:${operator}`)
        throw new Error('ignored repair observer')
      },
    })
    return sequence
  } finally {
    vi.doUnmock('../placement/blf')
    vi.resetModules()
  }
}

describe('runAutomaticNest', () => {
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

  it('preserves the selected seed order when result placements are grouped by sheet', () => {
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

    const exactOrders: string[][] = []
    runAutomaticNest(req, {
      deterministic: true,
      onExactReplay: ({ order }) => exactOrders.push([...order]),
    })

    expect(exactOrders[0]).toEqual(['a', 'b', 'c'])
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
    const result = runAutomaticNest(request([rect('a', 0, 20, 10)]), {
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

  it('does not publish cheap or equal exact candidates', () => {
    const progress: NestProgress[] = []
    const exactImprovements: boolean[] = []

    const result = runAutomaticNest(request([rect('a', 0, 20, 10)]), {
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
    const { exactOrderKeys, targetKey } = await fidelityPromotionScenario(75)

    expect(exactOrderKeys).not.toContain(targetKey)
  })

  it('replays a non-beam candidate that improves the champion cheap result', async () => {
    const { exactOrderKeys, targetKey } = await fidelityPromotionScenario(45)

    expect(exactOrderKeys).toContain(targetKey)
  })

  it('preserves the champion when an exact replay rejects a cheap improvement', async () => {
    const { exactEvents, publishedChampions, targetKey } =
      await fidelityPromotionScenario(45)

    expect(exactEvents).toContainEqual(
      expect.objectContaining({
        source: 'order',
        stage: 'fixed',
        order: targetKey.split(','),
        improved: false,
      }),
    )
    expect(publishedChampions).toBe(1)
  })

  it('runs a genuine second beam layer and then stabilizes', async () => {
    const { beamLayers } = await fidelityPromotionScenario(75, {
      stopAtFirstLayer: false,
      childWaste: 1,
    })

    expect(beamLayers.length).toBeGreaterThan(1)
    expect(beamLayers[0]).toMatchObject({ layer: 1, stable: false })
    expect(beamLayers.at(-1)).toMatchObject({ stable: true })
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

  it('rewards a repair operator only after its exact result becomes champion', async () => {
    const sequence = await repairImprovementScenario()

    expect(sequence.some((event) => event.startsWith('reward:'))).toBe(true)
    expect(sequence.indexOf('exact:fixed')).toBeLessThan(
      sequence.findIndex((event) => event.startsWith('reward:')),
    )
  })

  it('refines a repair champion before evaluating another repair', async () => {
    const sequence = await repairImprovementScenario()

    expect(sequence.slice(0, 3)).toEqual([
      'exact:fixed',
      expect.stringMatching(/^reward:/),
      'exact:refine',
    ])
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

  it('stops at the first non-deterministic clock condition', () => {
    const req = request([rect('a', 0, 20, 10), rect('b', 1, 10, 20)])

    let safetyClock = 0
    let safetyRanks = 0
    const safety = runAutomaticNest(req, {
      deterministic: false,
      now: () => safetyClock,
      onProgress: ({ bestSoFar }) => {
        if (bestSoFar) safetyClock = 5_000
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
    expect(stagnationRanks).toBe(1)
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
      request([rect('a', 0, 20, 10)]),
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

    const result = runAutomaticNest(request([rect('a', 0, 20, 10)]), {
      deterministic: true,
      now: () => tick++,
      onProgress: () => {
        throw new Error('ignored progress observer')
      },
      onEvaluation: (info) => {
        diagnostics.push(info)
        throw new Error('ignored diagnostic observer')
      },
      onExactReplay: () => {
        throw new Error('ignored exact observer')
      },
      onBeamLayer: () => {
        throw new Error('ignored beam observer')
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
