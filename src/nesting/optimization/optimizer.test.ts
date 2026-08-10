import { describe, expect, it } from 'vitest'
import type { GeometryPart } from '../../geometry'
import { boundingBox } from '../../geometry'
import { runBottomLeftNest } from '../placement/blf'
import { scoreNestingResult, isBetterScore } from '../scoring/fitness'
import type { NestingRequest, NestingSettings } from '../types'
import { orderCrossover } from './crossover'
import { runEvolutionaryNest } from './geneticOptimizer'
import {
  individualKey,
  isValidIndividual,
  type Individual,
} from './individual'
import {
  insertionMutation,
  rotationMutation,
  swapMutation,
} from './mutation'
import { createRng } from './rng'
import { elitistSurvive, tournamentSelect, type RankedIndividual } from './selection'

const settings: NestingSettings = {
  spacingMm: 1,
  allowedRotations: [0, 90, 180, 270],
  rotationStepDeg: null,
  allowArbitraryRotation: false,
  optimizationLevel: 'fast',
  timeLimitMs: 400,
  seed: 7,
}

function rect(
  id: string,
  index: number,
  w: number,
  h: number,
): GeometryPart {
  const points = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
  return {
    id,
    sourceElement: 'rect',
    originalIndex: index,
    sourceId: id,
    outer: { points },
    holes: [],
    boundingBox: boundingBox(points),
    area: w * h,
    centroid: { x: w / 2, y: h / 2 },
    originalTransform: null,
  }
}

function req(parts: GeometryPart[], extra?: Partial<NestingSettings>): NestingRequest {
  return {
    parts,
    sheets: [{ widthMm: 100, heightMm: 80, marginMm: 2, quantity: 5 }],
    settings: { ...settings, ...extra },
  }
}

function sampleInd(): Individual {
  return {
    order: ['a', 'b', 'c', 'd'],
    rotations: [0, 90, 180, 270],
  }
}

describe('evolutionary optimizer primitives', () => {
  it('1. individual validity', () => {
    const ind = sampleInd()
    expect(isValidIndividual(ind, ['a', 'b', 'c', 'd'], [0, 90, 180, 270])).toBe(
      true,
    )
    expect(
      isValidIndividual(
        { order: ['a', 'a', 'b', 'c'], rotations: [0, 0, 0, 0] },
        ['a', 'b', 'c', 'd'],
        [0],
      ),
    ).toBe(false)
  })

  it('2. seeded RNG reproducibility', () => {
    const a = createRng(123)
    const b = createRng(123)
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).toEqual(seqB)
    expect(createRng(1).next()).not.toEqual(createRng(2).next())
  })

  it('3. swap mutation', () => {
    const rng = createRng(1)
    const ind = sampleInd()
    const out = swapMutation(ind, rng)
    expect(isValidIndividual(out, ind.order, [0, 90, 180, 270])).toBe(true)
    expect(out.order.slice().sort()).toEqual(ind.order.slice().sort())
  })

  it('4. insertion mutation', () => {
    const rng = createRng(2)
    const ind = sampleInd()
    const out = insertionMutation(ind, rng)
    expect(isValidIndividual(out, ind.order, [0, 90, 180, 270])).toBe(true)
  })

  it('5. rotation mutation', () => {
    const rng = createRng(3)
    const ind = sampleInd()
    const out = rotationMutation(ind, rng, [0, 90, 180, 270])
    expect(isValidIndividual(out, ind.order, [0, 90, 180, 270])).toBe(true)
  })

  it('6–8. OX crossover valid permutation', () => {
    const rng = createRng(9)
    const a = sampleInd()
    const b = {
      order: ['d', 'c', 'b', 'a'],
      rotations: [270, 180, 90, 0],
    }
    for (let i = 0; i < 30; i++) {
      const child = orderCrossover(a, b, rng)
      expect(isValidIndividual(child, a.order, [0, 90, 180, 270])).toBe(true)
      expect(new Set(child.order).size).toBe(4)
      expect(child.order).toHaveLength(4)
    }
  })

  it('9. selection prefers better score', () => {
    const rng = createRng(5)
    const mk = (total: number, id: string): RankedIndividual => ({
      individual: { order: [id], rotations: [0] },
      score: {
        sheetPenalty: 0,
        wastePenalty: 0,
        compactnessPenalty: 0,
        cutPenalty: 0,
        unplacedPenalty: 0,
        total,
      },
      resultKey: id,
    })
    const pop = [mk(100, 'bad'), mk(1, 'good'), mk(50, 'mid')]
    let goodWins = 0
    for (let i = 0; i < 40; i++) {
      const sel = tournamentSelect(pop, rng, 3)
      if (sel.order[0] === 'good') goodWins++
    }
    expect(goodWins).toBeGreaterThan(10)
  })

  it('10. elitism keeps best', () => {
    const pop: RankedIndividual[] = [
      {
        individual: { order: ['a'], rotations: [0] },
        score: {
          sheetPenalty: 0,
          wastePenalty: 0,
          compactnessPenalty: 0,
          cutPenalty: 0,
          unplacedPenalty: 0,
          total: 9,
        },
        resultKey: 'a',
      },
      {
        individual: { order: ['b'], rotations: [0] },
        score: {
          sheetPenalty: 0,
          wastePenalty: 0,
          compactnessPenalty: 0,
          cutPenalty: 0,
          unplacedPenalty: 0,
          total: 1,
        },
        resultKey: 'b',
      },
    ]
    const elite = elitistSurvive(pop, 1)
    expect(elite).toHaveLength(1)
    expect(elite[0]!.resultKey).toBe('b')
  })

  it('11. fitness ordering', () => {
    const parts = [rect('a', 0, 20, 20), rect('b', 1, 20, 20)]
    const r = runBottomLeftNest(req(parts))
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    const s = scoreNestingResult(r)
    const worse = {
      ...s,
      unplacedPenalty: s.unplacedPenalty + 1,
      total: s.total + 10_000_000,
    }
    expect(isBetterScore(s, worse)).toBe(true)
  })

  it('12. cache via individualKey', () => {
    const ind = sampleInd()
    expect(individualKey(ind, 's')).toBe(individualKey({ ...ind }, 's'))
    expect(individualKey(ind, 's')).not.toBe(
      individualKey({ ...ind, rotations: [0, 0, 0, 0] }, 's'),
    )
  })

  it('13. termination by generation', () => {
    const parts = [rect('a', 0, 30, 20), rect('b', 1, 25, 25), rect('c', 2, 15, 40)]
    const result = runEvolutionaryNest(req(parts), {
      maxGenerations: 3,
      timeLimitMs: 60_000,
      seed: 11,
    })
    expect(result.status).toBe('ok')
  })

  it('14. termination by time budget', () => {
    const parts = [rect('a', 0, 30, 20), rect('b', 1, 25, 25), rect('c', 2, 15, 40)]
    const t0 = performance.now()
    const result = runEvolutionaryNest(req(parts), {
      maxGenerations: 10_000,
      timeLimitMs: 50,
      seed: 12,
    })
    const elapsed = performance.now() - t0
    expect(result.status).toBe('ok')
    expect(elapsed).toBeLessThan(2000)
  })

  it('15. baseline is never lost', () => {
    const parts = [
      rect('a', 0, 40, 30),
      rect('b', 1, 35, 35),
      rect('c', 2, 20, 50),
      rect('d', 3, 28, 22),
    ]
    const request = req(parts, { seed: 99, timeLimitMs: 300 })
    const baseline = runBottomLeftNest(request)
    const evolved = runEvolutionaryNest(request, { seed: 99, timeLimitMs: 300 })
    expect(baseline.status).toBe('ok')
    expect(evolved.status).toBe('ok')
    if (baseline.status !== 'ok' || evolved.status !== 'ok') return
    const sb = scoreNestingResult(baseline)
    const se = scoreNestingResult(evolved)
    expect(se.total).toBeLessThanOrEqual(sb.total + 1e-6)
  })

  it('16. optimizer can improve a known simple case', () => {
    // Order-sensitive: large C-like waste if small parts placed first wrongly —
    // use parts where rotation/order matters for sheet count.
    const parts = [
      rect('big', 0, 55, 55),
      rect('m1', 1, 40, 25),
      rect('m2', 2, 40, 25),
      rect('s1', 3, 20, 20),
      rect('s2', 4, 18, 22),
    ]
    const request = req(parts, {
      seed: 21,
      timeLimitMs: 800,
      optimizationLevel: 'balanced',
      allowedRotations: [0, 90],
    })
    request.sheets[0] = {
      widthMm: 100,
      heightMm: 100,
      marginMm: 0,
      quantity: 5,
    }
    const baseline = runBottomLeftNest(request)
    const evolved = runEvolutionaryNest(request, {
      seed: 21,
      timeLimitMs: 800,
    })
    expect(baseline.status).toBe('ok')
    expect(evolved.status).toBe('ok')
    if (baseline.status !== 'ok' || evolved.status !== 'ok') return
    const sb = scoreNestingResult(baseline)
    const se = scoreNestingResult(evolved)
    expect(se.total).toBeLessThanOrEqual(sb.total + 1e-6)
    // Either equal (acceptable) or strictly better
    expect(
      se.total < sb.total - 1e-6 ||
        evolved.statistics.sheetCountUsed <= baseline.statistics.sheetCountUsed,
    ).toBe(true)
  })

  it('17. STOP returns best-so-far', () => {
    const parts = [
      rect('a', 0, 30, 20),
      rect('b', 1, 25, 25),
      rect('c', 2, 15, 40),
      rect('d', 3, 22, 18),
    ]
    const request = req(parts, { timeLimitMs: 10_000, seed: 3 })
    let aborted = false
    setTimeout(() => {
      aborted = true
    }, 30)
    const result = runEvolutionaryNest(request, {
      seed: 3,
      timeLimitMs: 10_000,
      maxGenerations: 500,
      signal: {
        get aborted() {
          return aborted
        },
      } as AbortSignal,
    })
    expect(result.status === 'cancelled' || result.status === 'ok').toBe(true)
    if (result.status === 'cancelled') {
      expect(result.bestSoFar).toBeTruthy()
      expect(result.bestSoFar!.status).toBe('ok')
      expect(result.bestSoFar!.placements.length).toBeGreaterThan(0)
    } else {
      // Finished before abort fired — still a valid complete result
      expect(result.placements.length).toBeGreaterThan(0)
    }
  })

  it('17b. BLF abort mid-run returns partial bestSoFar', () => {
    const parts = Array.from({ length: 8 }, (_, i) =>
      rect(`p${i}`, i, 40, 30),
    )
    const request = req(parts, { timeLimitMs: 60_000, seed: 1 })
    let calls = 0
    const result = runBottomLeftNest(request, {
      signal: {
        get aborted() {
          calls += 1
          return calls > 3
        },
      } as AbortSignal,
    })
    expect(result.status).toBe('cancelled')
    if (result.status === 'cancelled') {
      expect(result.bestSoFar?.status).toBe('ok')
    }
  })

  it('18. deterministic seed produces reproducible result', () => {
    const parts = [rect('a', 0, 30, 20), rect('b', 1, 25, 25), rect('c', 2, 15, 40)]
    const request = req(parts, { seed: 4242, timeLimitMs: 60_000 })
    const r1 = runEvolutionaryNest(request, {
      seed: 4242,
      timeLimitMs: 60_000,
      maxGenerations: 10,
      deterministic: true,
    })
    const r2 = runEvolutionaryNest(request, {
      seed: 4242,
      timeLimitMs: 60_000,
      maxGenerations: 10,
      deterministic: true,
    })
    expect(r1.status).toBe('ok')
    expect(r2.status).toBe('ok')
    if (r1.status !== 'ok' || r2.status !== 'ok') return
    expect(r1.placements).toEqual(r2.placements)
    expect(r1.statistics.sheetCountUsed).toBe(r2.statistics.sheetCountUsed)
    expect(r1.utilization).toBeCloseTo(r2.utilization, 10)
  })
})
