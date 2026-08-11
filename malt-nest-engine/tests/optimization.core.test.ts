import { describe, expect, it } from 'vitest'
import { makeShape } from '../src/geometry'
import {
  orderIds,
  shapeComplexity,
  BASE_ORDERING_STRATEGIES,
} from '../src/ordering'
import { createSheet } from '../src/placement'
import {
  buildFullShortlist,
  compareOrderingEvals,
  dedupeStrategies,
  optimizeMultiStart,
  rankEvals,
  toEval,
} from '../src/optimization'
import { nest } from '../src/nest'
import type { OrderingEval } from '../src/optimization'

function rect(id: string, w: number, h: number) {
  return makeShape(id, [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ])
}

function L(id: string) {
  return makeShape(id, [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 4 },
    { x: 0, y: 4 },
  ])
}

function frame(id: string) {
  return makeShape(
    id,
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    [
      [
        { x: 3, y: 3 },
        { x: 7, y: 3 },
        { x: 7, y: 7 },
        { x: 3, y: 7 },
      ],
    ],
  )
}

describe('ordering strategies deterministic', () => {
  const parts = [rect('b', 2, 2), rect('a', 5, 5), L('L'), frame('F')]

  it('1. area_desc deterministic', () => {
    expect(orderIds(parts, 'area_desc')).toEqual(orderIds(parts, 'area_desc'))
  })
  it('2. bbox deterministic', () => {
    expect(orderIds(parts, 'bbox_area_desc')).toEqual(
      orderIds(parts, 'bbox_area_desc'),
    )
  })
  it('3. height deterministic', () => {
    expect(orderIds(parts, 'height_desc')).toEqual(orderIds(parts, 'height_desc'))
  })
  it('4. width deterministic', () => {
    expect(orderIds(parts, 'width_desc')).toEqual(orderIds(parts, 'width_desc'))
  })
  it('5. complexity deterministic', () => {
    expect(orderIds(parts, 'complexity_desc')).toEqual(
      orderIds(parts, 'complexity_desc'),
    )
    expect(shapeComplexity(L('L'))).toBeGreaterThan(
      shapeComplexity(rect('r', 4, 4)),
    )
    expect(shapeComplexity(frame('F'))).toBeGreaterThan(shapeComplexity(L('L')))
  })
})

describe('multi-start', () => {
  const parts = [rect('a', 8, 6), rect('b', 5, 5), L('L'), rect('c', 4, 7)]
  const sheet = createSheet(50, 40, 1)
  const cfg = {
    gap: 1,
    maxSheets: 4,
    fullRotation: { kind: 'orthogonal' as const },
  }

  it('6. all base orderings evaluated in FAST', () => {
    const r = optimizeMultiStart(parts, sheet, cfg)
    expect(r.fastCandidates.length).toBe(BASE_ORDERING_STRATEGIES.length)
    expect(new Set(r.fastCandidates.map((e) => e.strategy))).toEqual(
      new Set(BASE_ORDERING_STRATEGIES),
    )
    expect(r.fastCandidates.every((e) => e.rotationMode === 'fast')).toBe(true)
  })

  it('7. area_desc always retained in FULL shortlist', () => {
    for (const best of BASE_ORDERING_STRATEGIES) {
      expect(buildFullShortlist(best)).toContain('area_desc')
    }
    const r = optimizeMultiStart(parts, sheet, cfg)
    expect(r.diagnostics.fullShortlist).toContain('area_desc')
    expect(r.fullCandidates.some((e) => e.strategy === 'area_desc')).toBe(true)
  })

  it('8. baseline cannot be lost', () => {
    const r = optimizeMultiStart(parts, sheet, cfg)
    expect(r.diagnostics.baselinePreserved).toBe(true)
    expect(compareOrderingEvals(r.best, r.baseline)).toBeLessThanOrEqual(0)
  })

  it('9. deterministic best', () => {
    const a = optimizeMultiStart(parts, sheet, cfg)
    const b = optimizeMultiStart(parts, sheet, cfg)
    expect(a.best.strategy).toBe(b.best.strategy)
    expect(a.best.packedBoundsMm2).toBeCloseTo(b.best.packedBoundsMm2, 6)
    expect(a.best.placed).toBe(b.best.placed)
    expect(a.diagnostics.fullShortlist).toEqual(b.diagnostics.fullShortlist)
  })

  it('10. duplicate ordering not evaluated twice', () => {
    expect(buildFullShortlist('area_desc').filter((s) => s === 'area_desc')).toHaveLength(
      1,
    )
    expect(dedupeStrategies(['area_desc', 'area_desc', 'bbox_area_desc'])).toEqual([
      'area_desc',
      'bbox_area_desc',
    ])
    const r = optimizeMultiStart(parts, sheet, cfg)
    const ids = r.fullCandidates.map((e) => e.strategy)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('fast/full modes', () => {
  const parts = [rect('a', 6, 4), rect('b', 5, 5)]
  const sheet = createSheet(40, 30, 0)

  it('11. FAST uses orthogonal', () => {
    const r = optimizeMultiStart(parts, sheet, {
      gap: 0,
      fullRotation: { kind: 'none' },
    })
    expect(
      r.fastCandidates.every((e) => e.nest.config.rotation.kind === 'orthogonal'),
    ).toBe(true)
  })

  it('12. FULL uses free by default', () => {
    const r = optimizeMultiStart(parts, sheet, {
      gap: 0,
      strategies: ['area_desc'],
      maxSheets: 2,
    })
    expect(r.fullCandidates.every((e) => e.rotationMode === 'full')).toBe(true)
    expect(
      r.fullCandidates.every((e) => e.nest.config.rotation.kind === 'free'),
    ).toBe(true)
  }, 120_000)

  it('13. best FAST selection deterministic', () => {
    const r = optimizeMultiStart(parts, sheet, {
      gap: 0,
      fullRotation: { kind: 'orthogonal' },
    })
    const bestFast = [...r.fastCandidates].sort(compareOrderingEvals)[0]!
    expect(r.diagnostics.fullShortlist).toContain(bestFast.strategy)
  })

  it('14. FULL ranking diagnostic correct', () => {
    const r = optimizeMultiStart(parts, sheet, {
      gap: 0,
      fullRotation: { kind: 'orthogonal' },
    })
    const ranks = rankEvals(r.fullCandidates)
    for (const row of r.diagnostics.ranking) {
      if (row.fullRank !== null) {
        expect(row.fullRank).toBe(ranks.get(row.strategy))
      }
    }
    expect(
      r.diagnostics.ranking.find((x) => x.strategy === 'area_desc')!.fullRank,
    ).toBeTruthy()
  })
})

describe('ETAP 4 / 5 regression via multi-start orchestration', () => {
  it('15. ETAP 4 golden unchanged (area_desc + orthogonal)', () => {
    const sheet = createSheet(30, 20, 0)
    const parts = [rect('a', 10, 10), rect('b', 8, 8)]
    const r = nest(parts, sheet, {
      gap: 0,
      ordering: 'area_desc',
      rotation: { kind: 'orthogonal' },
    })
    expect(r.placements.find((p) => p.shapeId === 'a')!.position.x).toBeCloseTo(5, 4)
    expect(r.placements.find((p) => p.shapeId === 'a')!.position.y).toBeCloseTo(5, 4)
  })

  it('16. ETAP 5 free long-bar still places non-ortho', () => {
    const sheet = createSheet(20, 20, 0)
    const r = nest([rect('bar', 21, 2)], sheet, {
      gap: 0,
      ordering: 'area_desc',
      rotation: { kind: 'free', free: { baselineFloor: false } },
    })
    expect(r.placements.length).toBe(1)
    expect([0, 90, 180, 270].includes(r.placements[0]!.rotationDeg)).toBe(false)
  })
})

describe('compare helper', () => {
  it('prefers fewer sheets then more placed', () => {
    const a = fakeEval('area_desc', { sheets: 1, placed: 2 })
    const b = fakeEval('bbox_area_desc', { sheets: 2, placed: 3 })
    expect(compareOrderingEvals(a, b)).toBeLessThan(0)
  })
})

function fakeEval(
  strategy: OrderingEval['strategy'],
  partial: Partial<OrderingEval>,
): OrderingEval {
  const nestResult = {
    metrics: {
      sheetCount: partial.sheets ?? 1,
      placedCount: partial.placed ?? 1,
      unplacedCount: 0,
      usedPartArea: 1,
      sheetArea: 100,
      utilization: partial.utilization ?? 0.1,
      waste: 0.9,
      packedBoundsMm2: partial.packedBoundsMm2 ?? 50,
      sheetPackedBounds: [],
    },
    diagnostics: {
      nfpComputeCount: 0,
      validationCount: 0,
      candidateCount: 0,
      rejectedCandidates: 0,
    },
    runtimeMs: 1,
    sheets: [],
    placements: [],
    unplaced: [],
    config: {
      gap: 0,
      ordering: strategy,
      rotation: { kind: 'orthogonal' as const },
    },
  }
  return toEval(strategy, 'fast', nestResult as never, ['a'])
}
