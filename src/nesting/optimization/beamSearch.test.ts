import { describe, expect, it } from 'vitest'
import type { NestingSuccess } from '../types'
import { isValidIndividual, type Individual } from './individual'
import {
  expandOrder,
  selectBeam,
  selectNextBeam,
  type RankedCandidate,
} from './beamSearch'
import { createRng } from './rng'

function individual(order = ['a', 'b', 'c', 'd']): Individual {
  return { order, rotations: [0, 90, 180, 270].slice(0, order.length) }
}

function result({
  unplaced = 0,
  sheets = 1,
  waste = 100,
  utilization = 0.5,
  boundsArea = 100,
}: {
  unplaced?: number
  sheets?: number
  waste?: number
  utilization?: number
  boundsArea?: number
} = {}): NestingSuccess {
  return {
    status: 'ok',
    placements: [],
    sheets: Array.from({ length: sheets }, (_, sheetIndex) => ({
      sheetIndex,
      widthMm: 100,
      heightMm: 100,
      placedCount: 0,
      utilization,
      wasteMm2: waste / sheets,
      usedBounds: { minX: 0, minY: 0, maxX: boundsArea / sheets, maxY: 1 },
    })),
    unplacedPartIds: Array.from({ length: unplaced }, (_, i) => `u-${i}`),
    utilization,
    wasteMm2: waste,
    calculationTimeMs: 1,
    statistics: {
      partCount: 4,
      placedCount: 4 - unplaced,
      unplacedCount: unplaced,
      sheetCountUsed: sheets,
      totalPartAreaMm2: 1,
      totalSheetAreaMm2: sheets * 10_000,
      overallUtilization: utilization,
      overallWasteMm2: waste,
    },
    engineId: 'test',
  }
}

function candidate(
  name: string,
  nestingResult = result(),
): RankedCandidate {
  return { individual: { order: [name], rotations: [0] }, result: nestingResult }
}

describe('bounded order beam helpers', () => {
  it('expands valid aligned neighboring orders without mutating the input', () => {
    const input = individual()
    const before = structuredClone(input)
    const neighbors = expandOrder(input, createRng(123))

    expect(neighbors).toHaveLength(5)
    expect(input).toEqual(before)
    for (const neighbor of neighbors) {
      expect(isValidIndividual(neighbor, input.order, [0, 90, 180, 270])).toBe(true)
      expect(
        Object.fromEntries(neighbor.order.map((id, index) => [id, neighbor.rotations[index]])),
      ).toEqual({ a: 0, b: 90, c: 180, d: 270 })
    }
  })

  it('includes every adjacent swap plus seeded arbitrary swap and insertion moves', () => {
    const neighbors = expandOrder(individual(), createRng(123))

    expect(neighbors.map((neighbor) => neighbor.order)).toEqual([
      ['b', 'a', 'c', 'd'],
      ['a', 'c', 'b', 'd'],
      ['a', 'b', 'd', 'c'],
      ['c', 'b', 'a', 'd'],
      ['b', 'c', 'a', 'd'],
    ])
  })

  it('returns no neighbors for zero or one part and deduplicates two parts', () => {
    expect(expandOrder({ order: [], rotations: [] }, createRng(1))).toEqual([])
    expect(expandOrder({ order: ['a'], rotations: [0] }, createRng(1))).toEqual([])
    expect(expandOrder({ order: ['a', 'b'], rotations: [0, 90] }, createRng(1))).toEqual([
      { order: ['b', 'a'], rotations: [90, 0] },
    ])
  })

  it('selects in canonical order despite deliberately reversed scalar scores', () => {
    const candidates = [
      {
        ...candidate('partial', result({ unplaced: 1, sheets: 1, waste: 0 })),
        score: { total: 0 },
      },
      {
        ...candidate('two-sheets', result({ sheets: 2, waste: 0 })),
        score: { total: 1 },
      },
      {
        ...candidate('more-waste', result({ waste: 11, utilization: 0.99, boundsArea: 1 })),
        score: { total: 2 },
      },
      {
        ...candidate('lower-utilization', result({ waste: 10, utilization: 0.7, boundsArea: 1 })),
        score: { total: 3 },
      },
      {
        ...candidate('looser-bounds', result({ waste: 10, utilization: 0.8, boundsArea: 30 })),
        score: { total: 4 },
      },
      {
        ...candidate('best', result({ waste: 10, utilization: 0.8, boundsArea: 20 })),
        score: { total: 5 },
      },
    ]

    const selected = selectBeam(candidates, 6)

    expect(selected).toEqual([...candidates].reverse())
  })

  it('uses the supplied settings key for deduplication and keeps stable ties without mutation', () => {
    const first = candidate('first', result({ waste: 10 }))
    const duplicate = { ...first, result: result({ waste: 0 }) }
    const tied = candidate('tied', result({ waste: 10 }))
    const candidates = [first, duplicate, tied]
    const before = structuredClone(candidates)

    expect(selectBeam(candidates, 3, 'settings')).toEqual([first, tied])
    expect(candidates).toEqual(before)
  })

  it('retains an equal child so a later layer can cross a neutral valley', () => {
    const current = ['a', 'b', 'c', 'd'].map((name) => candidate(name))
    const neutral = candidate('neutral')

    const next = selectNextBeam(current, [neutral], 4)
    expect(next.map(({ individual }) => individual.order[0])).toContain('neutral')

    const improved = candidate('improved', result({ waste: 50 }))
    const afterValley = selectNextBeam(next, [improved], 4)
    expect(afterValley[0]).toBe(improved)
  })

  it('caps at width and rejects invalid widths', () => {
    const candidates = [candidate('a'), candidate('b'), candidate('c')]

    expect(selectBeam(candidates, 2)).toHaveLength(2)
    expect(selectBeam(candidates, 0)).toEqual([])
    for (const width of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => selectBeam(candidates, width)).toThrow(RangeError)
    }
  })
})
