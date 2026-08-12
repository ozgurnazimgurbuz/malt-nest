import { describe, expect, it } from 'vitest'
import type { PreparedPart } from '../core/prepare'
import type { NestingSuccess, Placement, SheetResult } from '../types'
import {
  createRepairState,
  proposeRepair,
  rewardRepairOperator,
  type RepairOperator,
  type RepairState,
} from './destroyRepair'
import type { Individual } from './individual'
import type { Rng } from './rng'

const operators: RepairOperator[] = ['random', 'bounds', 'sheet', 'unplaced']

function rng(first: number, rest = 0): Rng {
  let initial = true
  const next = () => {
    if (initial) {
      initial = false
      return first
    }
    return rest
  }
  return {
    next,
    int: (max) => Math.floor(next() * max),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    shuffle: (items) => items.slice().reverse(),
    chance: (p) => next() < p,
  }
}

function operatorRng(operator: RepairOperator, rest = 0): Rng {
  return rng((operators.indexOf(operator) + 0.1) / operators.length, rest)
}

function part(partId: string, width = 10, height = 10, area = width * height): PreparedPart {
  return {
    partId,
    sourceIndex: 0,
    area,
    variants: [],
    rotations: [0],
    maxWidth: width,
    maxHeight: height,
    perimeter: 2 * (width + height),
    widestRotation: 0,
    tallestRotation: 0,
    hasHoles: false,
    sourceOuter: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    sourceHoles: [],
  }
}

function result(
  placements: Placement[] = [],
  sheets: SheetResult[] = [],
  unplacedPartIds: string[] = [],
): NestingSuccess {
  return {
    status: 'ok',
    placements,
    sheets,
    unplacedPartIds,
    utilization: 0,
    wasteMm2: 0,
    calculationTimeMs: 0,
    statistics: {
      partCount: placements.length + unplacedPartIds.length,
      placedCount: placements.length,
      unplacedCount: unplacedPartIds.length,
      sheetCountUsed: sheets.length,
      totalPartAreaMm2: 0,
      totalSheetAreaMm2: 0,
      overallUtilization: 0,
      overallWasteMm2: 0,
    },
    engineId: 'test',
  }
}

function sheet(sheetIndex: number, maxX = 10, maxY = 10): SheetResult {
  return {
    sheetIndex,
    widthMm: 100,
    heightMm: 100,
    placedCount: 1,
    utilization: 0,
    wasteMm2: 0,
    usedBounds: { minX: 0, minY: 0, maxX, maxY },
  }
}

function individual(ids = ['a', 'b', 'c', 'd', 'e', 'f']): Individual {
  return { order: ids, rotations: ids.map((_, index) => index * 10) }
}

function expectValid(before: Individual, after: Individual): void {
  expect(after.order.slice().sort()).toEqual(before.order.slice().sort())
  expect(after.rotations).toHaveLength(after.order.length)
  const rotations = new Map(before.order.map((id, index) => [id, before.rotations[index]]))
  expect(after.rotations).toEqual(after.order.map((id) => rotations.get(id)))
}

describe('repair state', () => {
  it('starts each operator at weight one', () => {
    expect(createRepairState().weights).toEqual({ random: 1, bounds: 1, sheet: 1, unplaced: 1 })
  })

  it('increments rewards and decays every weight exactly when one reaches 16', () => {
    const state: RepairState = { weights: { random: 15, bounds: 7, sheet: 2, unplaced: 1 } }
    rewardRepairOperator(state, 'random')
    expect(state.weights).toEqual({ random: 8, bounds: 3, sheet: 1, unplaced: 1 })
  })

  it('uses weights while keeping every positive operator reachable', () => {
    const state: RepairState = { weights: { random: 1, bounds: 3, sheet: 1, unplaced: 1 } }
    const empty = individual([])
    const seen = [0.01, 0.2, 0.7, 0.9].map(
      (roll) => proposeRepair(empty, [], result(), new Map(), rng(roll), state).operator,
    )
    expect(seen).toEqual(operators)
  })
})

describe('repair proposals', () => {
  it.each(operators)('%s returns a valid aligned permutation without mutating inputs', (operator) => {
    const start = individual()
    const nesting = result([], [], ['e'])
    const prepared = new Map(start.order.map((id) => [id, part(id)]))
    const state = createRepairState()
    const snapshots = {
      start: structuredClone(start),
      nesting: structuredClone(nesting),
      prepared: structuredClone([...prepared.entries()]),
      state: structuredClone(state),
      rotations: [0, 90],
    }

    const proposal = proposeRepair(
      start,
      snapshots.rotations,
      nesting,
      prepared,
      operatorRng(operator),
      state,
    )

    expectValid(start, proposal.individual)
    expect(proposal.operator).toBe(
      operator === 'bounds' || operator === 'sheet' ? 'random' : operator,
    )
    expect(start).toEqual(snapshots.start)
    expect(nesting).toEqual(snapshots.nesting)
    expect([...prepared.entries()]).toEqual(snapshots.prepared)
    expect(state).toEqual(snapshots.state)
    expect(snapshots.rotations).toEqual([0, 90])
  })

  it('bounds targets an extent contributor on its own sheet', () => {
    const start = individual(['a', 'b', 'd', 'e', 'c'])
    const prepared = new Map(start.order.map((id) => [id, part(id)]))
    const nesting = result(
      [
        { partId: 'a', sheetIndex: 0, x: 0, y: 0, rotation: 0 },
        { partId: 'c', sheetIndex: 1, x: 20, y: 0, rotation: 0 },
      ],
      [sheet(0, 40, 40), sheet(1, 30, 40)],
    )

    const proposal = proposeRepair(start, [], nesting, prepared, operatorRng('bounds'), createRepairState())
    expect(proposal.individual.order[0]).toBe('c')
    expectValid(start, proposal.individual)
  })

  it('bounds uses rotated local bounds with BLF translation coordinates', () => {
    const rotated = {
      ...part('rotated', 20, 10),
      sourceOuter: [
        { x: 10, y: 20 },
        { x: 30, y: 20 },
        { x: 30, y: 30 },
        { x: 10, y: 30 },
      ],
    }
    const start = individual(['a', 'b', 'd', 'rotated', 'c'])
    const prepared = new Map(start.order.map((id) => [id, id === 'rotated' ? rotated : part(id)]))
    const nesting = result(
      [{ partId: 'rotated', sheetIndex: 2, x: 100, y: 50, rotation: 90 }],
      [sheet(2, 125, 85)],
    )

    const proposal = proposeRepair(start, [], nesting, prepared, operatorRng('bounds'), createRepairState())
    expect(proposal.individual.order[0]).toBe('rotated')
  })

  it('sheet targets the least efficient used sheet rather than the last sheet', () => {
    const start = individual(['a', 'b', 'd', 'e', 'f', 'c'])
    const prepared = new Map([
      ['a', part('a', 10, 10, 80)],
      ['b', part('b', 10, 10, 10)],
      ['c', part('c', 10, 10, 90)],
      ['d', part('d')],
      ['e', part('e')],
      ['f', part('f')],
    ])
    const nesting = result(
      [
        { partId: 'a', sheetIndex: 0, x: 0, y: 0, rotation: 0 },
        { partId: 'b', sheetIndex: 1, x: 0, y: 0, rotation: 0 },
        { partId: 'c', sheetIndex: 2, x: 0, y: 0, rotation: 0 },
      ],
      [sheet(0), sheet(1), sheet(2)],
    )

    const proposal = proposeRepair(start, [], nesting, prepared, operatorRng('sheet'), createRepairState())
    expect(proposal.individual.order[0]).toBe('b')
    expectValid(start, proposal.individual)
  })

  it('unplaced moves the failed part and its predecessor toward the front', () => {
    const start = individual()
    const proposal = proposeRepair(
      start,
      [],
      result([], [], ['e']),
      new Map(),
      operatorRng('unplaced'),
      createRepairState(),
    )
    expect(new Set(proposal.individual.order.slice(0, 2))).toEqual(new Set(['d', 'e']))
    expectValid(start, proposal.individual)
  })

  it('unplaced moves both failed part and predecessor for five parts', () => {
    const start = individual(['a', 'b', 'c', 'd', 'e'])
    const proposal = proposeRepair(
      start,
      [],
      result([], [], ['d']),
      new Map(),
      operatorRng('unplaced'),
      createRepairState(),
    )
    expect(new Set(proposal.individual.order.slice(0, 2))).toEqual(new Set(['c', 'd']))
  })

  it.each(['bounds', 'sheet', 'unplaced'] as const)('%s attributes fallback to random repair', (operator) => {
    const start = individual()
    const state = createRepairState()
    const proposal = proposeRepair(
      start,
      [],
      result(),
      new Map(),
      operatorRng(operator, 0.99),
      state,
    )
    rewardRepairOperator(state, proposal.operator)
    expect(proposal.operator).toBe('random')
    expect(proposal.individual.order).toEqual(start.order)
    expect(state.weights).toEqual({ random: 2, bounds: 1, sheet: 1, unplaced: 1 })
    expectValid(start, proposal.individual)
  })

  it.each([individual([]), individual(['a'])])('clones fewer than two parts unchanged', (start) => {
    const proposal = proposeRepair(
      start,
      [],
      result(),
      new Map(),
      operatorRng('sheet'),
      createRepairState(),
    )
    expect(proposal.individual).toEqual(start)
    expect(proposal.individual).not.toBe(start)
  })

  it('reward mutates only repair state', () => {
    const state = createRepairState()
    rewardRepairOperator(state, 'bounds')
    expect(state.weights).toEqual({ random: 1, bounds: 2, sheet: 1, unplaced: 1 })
  })
})
