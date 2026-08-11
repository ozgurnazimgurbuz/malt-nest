import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOLERANCE,
  makeShape,
  rotateShape,
  shapeCentroid,
} from '../src/geometry'
import {
  collidePlacements,
  createPlacement,
  createSheet,
  validatePlacement,
} from '../src/placement'
import {
  computeInnerNfp,
  computeOuterNfp,
  nfpContainsPoint,
} from '../src/nfp'
import {
  computeFreeRegions,
  createNfpCache,
  createPlaceCounters,
  nest,
  placePartOnSheet,
  sheetContainerShape,
} from '../src/nest'
import {
  BASE_ORDERING_STRATEGIES,
  type OrderingStrategy,
} from '../src/ordering'
import {
  compareOrderingEvals,
  optimizeMultiStart,
  toEval,
  type OrderingEval,
} from '../src/optimization'
import { resolveFreeConfig } from '../src/rotation'

function rect(id: string, width: number, height: number) {
  return makeShape(id, [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ])
}

function triangle(id: string, width: number, height: number) {
  return makeShape(id, [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
  ])
}

function lShape(id: string, width: number, height: number, thickness: number) {
  return makeShape(id, [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: thickness },
    { x: thickness, y: thickness },
    { x: thickness, y: height },
    { x: 0, y: height },
  ])
}

describe('nest regression coverage', () => {
  it('keeps zero-measure inner-fit candidates after another part is placed', () => {
    const result = nest([rect('a', 10, 5), rect('b', 10, 5)], createSheet(10, 10), {
      gap: 0,
      maxSheets: 1,
      rotation: { kind: 'none' },
    })

    expect(result.placements).toHaveLength(2)
    expect(result.unplaced).toHaveLength(0)
    expect(result.metrics.sheetCount).toBe(1)
  })

  it('recovers an exact-width corridor between placed parts', () => {
    const sheet = createSheet(10, 10)
    const left = createPlacement(rect('left', 4, 10), { x: 2, y: 5 }, 0)
    const right = createPlacement(rect('right', 4, 10), { x: 8, y: 5 }, 0)
    const attempt = placePartOnSheet(
      rect('middle', 2, 2),
      {
        sheet,
        placed: [left, right],
        gap: 0,
        tolerance: DEFAULT_TOLERANCE,
        counters: createPlaceCounters(),
        nfpCache: createNfpCache<ReturnType<typeof computeOuterNfp>>(),
        sheetContainer: sheetContainerShape(sheet),
      },
      { kind: 'none' },
    )

    expect(attempt.ok).toBe(true)
    if (attempt.ok) expect(attempt.placement.position.x).toBe(5)
  })

  it('uses zero sheets for empty input', () => {
    const result = nest([], createSheet(10, 10), {
      gap: 0,
      rotation: { kind: 'none' },
    })

    expect(result.sheets).toEqual([])
    expect(result.metrics.sheetCount).toBe(0)
    expect(result.metrics.sheetArea).toBe(0)
    expect(result.metrics.waste).toBe(0)
  })

  it.each([
    rect('too-large', 20, 20),
    makeShape('invalid', [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]),
  ])('does not report an empty sheet when every part is unplaced', (part) => {
    const result = nest([part], createSheet(10, 10), {
      gap: 0,
      maxSheets: 1,
      rotation: { kind: 'none' },
    })

    expect(result.placements).toEqual([])
    expect(result.sheets).toEqual([])
    expect(result.metrics.sheetArea).toBe(0)
    expect(result.metrics.waste).toBe(0)
  })

  it('threads a custom tolerance through placement and NFP work', () => {
    const thin = triangle('thin', 1, 2e-10)
    const tolerance = {
      abs: 1e-15,
      rel: 0,
      edgeMinLen2: 1e-30,
      curveTolerance: 0.25,
      clipperScale: 1000,
    }

    const result = nest([thin], createSheet(10, 10), {
      gap: 0,
      rotation: { kind: 'none' },
      tolerance,
    })

    expect(result.placements).toHaveLength(1)
    expect(
      validatePlacement(result.placements[0]!, createSheet(10, 10), [], {
        gap: 0,
        tolerance,
      }).valid,
    ).toBe(true)
  })

  it('never returns geometry different from the custom-precision angle evaluated', () => {
    const length = 1_000_000
    const height = 1
    const exactDeg = 10
    const radians = (exactDeg * Math.PI) / 180
    const sheet = createSheet(
      length * Math.cos(radians) + height * Math.sin(radians),
      length * Math.sin(radians) + height * Math.cos(radians),
    )
    const result = nest([rect('bar', length, height)], sheet, {
      gap: 0,
      rotation: {
        kind: 'free',
        free: {
          baselineFloor: false,
          coarseStepDeg: 10.00004,
          refineStepDeg: 360,
          finalStepDeg: 360,
          coarseTopK: 1,
          baselineAnglesDeg: [],
          diversityCount: 0,
          precision: { decimals: 6 },
        },
      },
    })

    for (const placement of result.placements) {
      expect(validatePlacement(placement, sheet, [], { gap: 0 }).valid).toBe(true)
    }
  })

  it('checks the full circle at final-step precision', () => {
    const length = 100
    const height = 1
    const radians = (37 * Math.PI) / 180
    const sheet = createSheet(
      length * Math.cos(radians) + height * Math.sin(radians),
      length * Math.sin(radians) + height * Math.cos(radians),
    )
    const result = nest([rect('bar', length, height)], sheet, {
      gap: 0,
      maxSheets: 1,
      rotation: { kind: 'free', free: { baselineFloor: false } },
    })

    expect(result.placements).toHaveLength(1)
    expect([37, 217]).toContain(result.placements[0]!.rotationDeg)
  })

  it('reuses NFPs for identical geometry with distinct public IDs', () => {
    const parts = Array.from({ length: 64 }, (_, index) =>
      rect(`r${index}`, 4, 3),
    )
    const result = nest(parts, createSheet(300, 100), {
      gap: 0,
      rotation: { kind: 'orthogonal' },
    })
    const repeated = nest(parts, createSheet(300, 100), {
      gap: 0,
      rotation: { kind: 'orthogonal' },
    })

    expect(result.placements).toHaveLength(parts.length)
    expect(result.diagnostics.cacheHits).toBeGreaterThan(8300)
    expect(result.diagnostics.nfpComputeCount).toBeLessThan(20)
    expect(
      repeated.placements.map((placement) => [
        placement.shapeId,
        placement.position,
        placement.rotationDeg,
      ]),
    ).toEqual(
      result.placements.map((placement) => [
        placement.shapeId,
        placement.position,
        placement.rotationDeg,
      ]),
    )
    expect(repeated.diagnostics.nfpComputeCount).toBe(
      result.diagnostics.nfpComputeCount,
    )
  })

  it('evicts old NFP entries at the configured cache bound', () => {
    const cache = createNfpCache<number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)

    expect(cache.size).toBe(2)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
  })

  it('preserves requested free config and aggregates baseline-floor work', () => {
    const parts = [rect('a', 8, 8)]
    const sheet = createSheet(30, 30)
    const requested = { kind: 'free' as const, free: { baselineFloor: true } }
    const free = nest(parts, sheet, {
      gap: 0,
      rotation: { kind: 'free', free: { baselineFloor: false } },
    })
    const orthogonal = nest(parts, sheet, {
      gap: 0,
      rotation: { kind: 'orthogonal' },
    })
    const floored = nest(parts, sheet, { gap: 0, rotation: requested })

    expect(floored.config.rotation).toEqual(requested)
    expect(floored.diagnostics.nfpComputeCount).toBe(
      free.diagnostics.nfpComputeCount + orthogonal.diagnostics.nfpComputeCount,
    )
    expect(floored.diagnostics.anglesEvaluated).toBe(
      (free.diagnostics.anglesEvaluated ?? 0) +
        (orthogonal.diagnostics.anglesEvaluated ?? 0),
    )
  })
})

describe('public input validation', () => {
  it.each([
    [Infinity, 10, 0],
    [10, Infinity, 0],
    [10, 10, NaN],
  ])('rejects non-finite sheet values', (width, height, margin) => {
    expect(() => createSheet(width, height, margin)).toThrow(/finite/i)
  })

  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid gap %s', (gap) => {
    expect(() =>
      nest([rect('a', 1, 1)], createSheet(10, 10), {
        gap,
        rotation: { kind: 'none' },
      }),
    ).toThrow(/gap/i)
  })

  it.each([0, 1.5, NaN, Infinity])('rejects invalid maxSheets %s', (maxSheets) => {
    expect(() =>
      nest([rect('a', 1, 1)], createSheet(10, 10), {
        gap: 0,
        maxSheets,
        rotation: { kind: 'none' },
      }),
    ).toThrow(/maxSheets/i)
  })

  it('rejects empty and duplicate shape IDs', () => {
    expect(() =>
      nest([rect(' ', 1, 1)], createSheet(10, 10), {
        gap: 0,
        rotation: { kind: 'none' },
      }),
    ).toThrow(/shape id/i)
    expect(() =>
      nest([rect('same', 1, 1), rect('same', 1, 1)], createSheet(10, 10), {
        gap: 0,
        rotation: { kind: 'none' },
      }),
    ).toThrow(/duplicate/i)
  })

  it('rejects invalid fixed and free rotation configuration', () => {
    const part = rect('a', 1, 1)
    const sheet = createSheet(10, 10)
    const run = (rotation: Parameters<typeof nest>[2]['rotation']) =>
      nest([part], sheet, { gap: 0, rotation })

    expect(() => run({ kind: 'fixed', anglesDeg: [] })).toThrow(/angle/i)
    expect(() => run({ kind: 'fixed', anglesDeg: [Infinity] })).toThrow(/finite/i)
    expect(() =>
      run({ kind: 'free', free: { coarseStepDeg: 0, baselineFloor: false } }),
    ).toThrow(/coarseStepDeg/i)
    expect(() =>
      run({ kind: 'free', free: { coarseTopK: -1, baselineFloor: false } }),
    ).toThrow(/coarseTopK/i)
    expect(() =>
      run({ kind: 'free', free: { diversityCount: 1.5, baselineFloor: false } }),
    ).toThrow(/diversityCount/i)
    expect(() =>
      run({ kind: 'free', free: { precision: { decimals: 400 } } }),
    ).toThrow(/decimals/i)
    expect(() =>
      run({ kind: 'free', free: { baselineAnglesDeg: [NaN] } }),
    ).toThrow(/baseline/i)
    expect(() =>
      resolveFreeConfig({ finalStepDeg: 0.01, precision: { decimals: 2 } }),
    ).not.toThrow()
    expect(() =>
      resolveFreeConfig({ finalStepDeg: 0.001, precision: { decimals: 3 } }),
    ).toThrow(/too many/i)
    expect(() =>
      resolveFreeConfig({ finalStepDeg: 1e-6, precision: { decimals: 6 } }),
    ).toThrow(/too many/i)
  })

  it.each([
    { abs: -1 },
    { rel: NaN },
    { edgeMinLen2: -1 },
    { curveTolerance: 0 },
    { clipperScale: Infinity },
    { clipperScale: 1e9 },
  ])('rejects invalid tolerance overrides: %o', (override) => {
    const tolerance = {
      abs: 1e-9,
      rel: 1e-12,
      edgeMinLen2: 1e-24,
      curveTolerance: 0.25,
      clipperScale: 1000,
      ...override,
    }
    expect(() =>
      nest([rect('a', 1, 1)], createSheet(10, 10), {
        gap: 0,
        rotation: { kind: 'none' },
        tolerance,
      }),
    ).toThrow(/tolerance/i)
  })
})

describe('NFP and clearance regressions', () => {
  it('recovers the point inner NFP of identical triangles', () => {
    const container = triangle('container', 10, 10)
    const part = triangle('part', 10, 10)
    const centroid = shapeCentroid(container)!

    expect(nfpContainsPoint(centroid, computeInnerNfp(container, part))).toBe(
      true,
    )
  })

  it('recovers the point inner NFP of identical rotated rectangles', () => {
    const container = rotateShape(rect('container', 10, 4), 37)
    const part = rotateShape(rect('part', 10, 4), 37)
    const centroid = shapeCentroid(container)!

    expect(nfpContainsPoint(centroid, computeInnerNfp(container, part))).toBe(
      true,
    )
  })

  it('recovers an exact fit inside a convex stationary hole', () => {
    const hole = [
      { x: 2, y: 2 },
      { x: 12, y: 2 },
      { x: 2, y: 12 },
    ]
    const frame = makeShape(
      'frame',
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      [hole],
    )
    const holeCentroid = shapeCentroid(makeShape('hole', hole))!

    expect(
      nfpContainsPoint(
        holeCentroid,
        computeOuterNfp(frame, triangle('part', 10, 10)),
      ),
    ).toBe(false)
  })

  it('recovers exact boundary fits in a concave inner NFP', () => {
    const container = lShape('concave-container', 10, 10, 2)
    const part = rect('part', 1, 1)

    const ifp = computeInnerNfp(container, part)

    expect(nfpContainsPoint({ x: 0.5, y: 0.5 }, ifp)).toBe(true)
    expect(nfpContainsPoint({ x: 5, y: 5 }, ifp)).toBe(false)
  })

  it('recovers gap-offset boundary fits in a concave inner NFP', () => {
    const container = lShape('concave-container', 10, 10, 2)
    const part = rect('part', 1, 1)
    const ifp = computeInnerNfp(container, part, { gap: 0.25 })

    expect(nfpContainsPoint({ x: 0.75, y: 0.75 }, ifp)).toBe(true)
    expect(nfpContainsPoint({ x: 0.6, y: 0.6 }, ifp)).toBe(false)
  })

  it('preserves an exact off-center stationary-hole fit candidate', () => {
    const frame = makeShape(
      'frame',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      [[
        { x: 1, y: 1 },
        { x: 5, y: 1 },
        { x: 5, y: 5 },
        { x: 1, y: 5 },
      ]],
    )
    const result = nest([frame, rect('part', 4, 4)], createSheet(10, 10), {
      gap: 0,
      maxSheets: 1,
      rotation: { kind: 'none' },
    })

    expect(result.placements).toHaveLength(2)
    expect(result.placements.find((part) => part.shapeId === 'part')?.position)
      .toEqual({ x: 3, y: 3 })
  })

  it('subtracts container holes from the inner-fit region', () => {
    const container = makeShape(
      'container',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      [[
        { x: 3, y: 3 },
        { x: 7, y: 3 },
        { x: 7, y: 7 },
        { x: 3, y: 7 },
      ]],
    )
    const ifp = computeInnerNfp(container, rect('part', 2, 2))

    expect(nfpContainsPoint({ x: 1, y: 1 }, ifp)).toBe(true)
    expect(nfpContainsPoint({ x: 3, y: 5 }, ifp)).toBe(false)
    expect(nfpContainsPoint({ x: 5, y: 5 }, ifp)).toBe(false)
  })

  it('keeps a container defect enclosed by the orbiting part hole', () => {
    const container = makeShape(
      'container',
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      [[
        { x: 9, y: 9 },
        { x: 11, y: 9 },
        { x: 11, y: 11 },
        { x: 9, y: 11 },
      ]],
    )
    const orbitingFrame = makeShape(
      'orbiting-frame',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      [[
        { x: 3, y: 3 },
        { x: 7, y: 3 },
        { x: 7, y: 7 },
        { x: 3, y: 7 },
      ]],
    )

    expect(
      nfpContainsPoint(
        { x: 10, y: 10 },
        computeInnerNfp(container, orbitingFrame),
      ),
    ).toBe(true)
  })

  it('preserves a free pose inside an orbiting-part hole', () => {
    const stationaryShape = rect('stationary', 2, 2)
    const orbitingFrame = makeShape(
      'orbiting-frame',
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      [[
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 15, y: 15 },
        { x: 5, y: 15 },
      ]],
    )
    const nfp = computeOuterNfp(stationaryShape, orbitingFrame)
    const stationary = createPlacement(
      stationaryShape,
      { x: 1, y: 1 },
      0,
    )
    const orbiting = createPlacement(orbitingFrame, { x: 1, y: 1 }, 0)

    expect(['overlap', 'gap-violation']).not.toContain(
      collidePlacements(stationary, orbiting, 0).kind,
    )
    expect(nfpContainsPoint({ x: 1, y: 1 }, nfp)).toBe(false)
  })

  it('uses positive gap when fitting a part inside a stationary hole', () => {
    const frame = makeShape(
      'frame',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      [[
        { x: 2, y: 2 },
        { x: 8, y: 2 },
        { x: 8, y: 8 },
        { x: 2, y: 8 },
      ]],
    )
    const result = nest([frame, rect('part', 2, 2)], createSheet(10, 10), {
      gap: 1,
      maxSheets: 1,
      rotation: { kind: 'none' },
    })

    expect(result.placements).toHaveLength(2)
  })

  it('preserves a legitimate no-collision pocket in a concavity', () => {
    const keyhole = makeShape('keyhole', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4.5 },
      { x: 8, y: 4.5 },
      { x: 8, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 8 },
      { x: 8, y: 8 },
      { x: 8, y: 5.5 },
      { x: 10, y: 5.5 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ])
    const part = rect('part', 2, 2)
    const result = nest([keyhole, part], createSheet(10, 10), {
      gap: 0,
      maxSheets: 1,
      rotation: { kind: 'none' },
    })

    expect(result.placements).toHaveLength(2)
    expect(
      validatePlacement(result.placements[1]!, createSheet(10, 10), [result.placements[0]!], {
        gap: 0,
      }).valid,
    ).toBe(true)
  })

  it('finds a rectangle in a narrow concave stationary hole', () => {
    const frame = makeShape(
      'l-hole-frame',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      [[
        { x: 1, y: 1 },
        { x: 7, y: 1 },
        { x: 7, y: 3 },
        { x: 3, y: 3 },
        { x: 3, y: 7 },
        { x: 1, y: 7 },
      ]],
    )
    const result = nest([frame, rect('part', 2, 2)], createSheet(10, 10), {
      gap: 0,
      maxSheets: 1,
      rotation: { kind: 'none' },
    })

    expect(result.placements).toHaveLength(2)
  })

  it('bounds contact recovery for a high-vertex hole that cannot fit the part', () => {
    const vertexCount = 512
    const hole = Array.from({ length: vertexCount }, (_, index) => {
      const angle = (index * 2 * Math.PI) / vertexCount
      const radius = index % 2 === 0 ? 100 : 50
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
    })
    const frame = makeShape(
      'high-vertex-frame',
      [
        { x: -600, y: -600 },
        { x: 600, y: -600 },
        { x: 600, y: 600 },
        { x: -600, y: 600 },
      ],
      [hole],
    )
    const started = performance.now()
    const nfp = computeOuterNfp(frame, rect('too-large-for-hole', 500, 500))

    expect(nfp.regions.length).toBeGreaterThan(0)
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('bounds inner-fit contact recovery for a feasible high-vertex container', () => {
    const vertexCount = 512
    const outer = Array.from({ length: vertexCount }, (_, index) => {
      const angle = (index * 2 * Math.PI) / vertexCount
      const radius = index % 2 === 0 ? 100 : 90
      return {
        x: 120 + Math.cos(angle) * radius,
        y: 120 + Math.sin(angle) * radius,
      }
    })
    const container = makeShape('high-vertex-container', outer)
    const started = performance.now()
    const ifp = computeInnerNfp(container, rect('part', 1, 1))

    expect(nfpContainsPoint({ x: 120, y: 120 }, ifp)).toBe(true)
    expect(ifp.contactPoints?.length ?? 0).toBeLessThanOrEqual(1024)
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('assigns each free-region hole to its containing outer', () => {
    const outer = (x0: number, y0: number, x1: number, y1: number) => [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ]
    const hole = (x0: number, y0: number, x1: number, y1: number) => [
      { x: x0, y: y0 },
      { x: x0, y: y1 },
      { x: x1, y: y1 },
      { x: x1, y: y0 },
    ]
    const regions = computeFreeRegions(
      {
        kind: 'inner',
        stationaryId: 'sheet',
        orbitingId: 'part',
        reference: 'centroid',
        gap: 0,
        regions: [
          { outer: outer(0, 0, 10, 10), holes: [hole(2, 2, 4, 4)] },
          { outer: outer(20, 0, 29, 9), holes: [hole(22, 2, 23, 3)] },
        ],
        bounds: { minX: 0, minY: 0, maxX: 29, maxY: 10 },
        algorithm: 'minkowski-clipper2',
      },
      [],
    )

    expect(regions.map((region) => region.holes.length)).toEqual([1, 1])
  })

  it('uses Euclidean round clearance consistently in collision and NFP', () => {
    const stationaryShape = rect('stationary', 1, 1)
    const orbitingShape = rect('orbiting', 0.1, 0.1)
    const stationary = createPlacement(stationaryShape, { x: 0.5, y: 0.5 }, 0)
    const justAbove = createPlacement(orbitingShape, { x: 1.85, y: 1.85 }, 0)
    const justBelow = createPlacement(orbitingShape, { x: 1.65, y: 1.65 }, 0)
    const nfp = computeOuterNfp(stationary.geometry, orbitingShape, { gap: 1 })

    expect(collidePlacements(stationary, justAbove, 1).kind).toBe('none')
    expect(nfpContainsPoint(justAbove.position, nfp)).toBe(false)
    expect(collidePlacements(stationary, justBelow, 1).kind).toBe('gap-violation')
    expect(nfpContainsPoint(justBelow.position, nfp)).toBe(true)
  })
})

describe('optimizer regressions', () => {
  it('ranks feasibility before sheet count', () => {
    const fewerPlaced = fakeEval('area_desc', { placed: 2, sheets: 1 })
    const morePlaced = fakeEval('bbox_area_desc', { placed: 3, sheets: 2 })

    expect(compareOrderingEvals(morePlaced, fewerPlaced)).toBeLessThan(0)
  })

  it('evaluates every configured strategy in FULL and never regresses below FAST', () => {
    const parts = [
      triangle('p0', 4, 12),
      rect('p1', 7, 5),
      lShape('p2', 7, 13, 1),
      lShape('p3', 6, 7, 1),
    ]
    const result = optimizeMultiStart(parts, createSheet(10, 15), {
      gap: 0,
      maxSheets: 1,
    })
    const bestFast = [...result.fastCandidates].sort(compareOrderingEvals)[0]!

    expect(result.fullCandidates.map((candidate) => candidate.strategy)).toEqual(
      BASE_ORDERING_STRATEGIES,
    )
    expect(compareOrderingEvals(result.best, bestFast)).toBeLessThanOrEqual(0)
    expect(result.best.placed).toBe(4)
  })

  it('does not inject unconfigured non-baseline strategies into FULL', () => {
    const strategies: OrderingStrategy[] = ['height_desc', 'width_desc']
    const result = optimizeMultiStart(
      [rect('a', 4, 3), rect('b', 3, 2)],
      createSheet(10, 10),
      {
        gap: 0,
        strategies,
        fullRotation: { kind: 'none' },
      },
    )

    expect(result.fullCandidates.map((candidate) => candidate.strategy)).toEqual([
      'area_desc',
      ...strategies,
    ])
  })
})

function fakeEval(
  strategy: OrderingEval['strategy'],
  partial: Pick<OrderingEval, 'placed' | 'sheets'>,
): OrderingEval {
  const nestResult = {
    metrics: {
      sheetCount: partial.sheets,
      placedCount: partial.placed,
      unplacedCount: 0,
      usedPartArea: partial.placed,
      sheetArea: partial.sheets * 100,
      utilization: partial.placed / (partial.sheets * 100),
      waste: 0,
      packedBoundsMm2: 1,
      sheetPackedBounds: [],
    },
    diagnostics: {
      nfpComputeCount: 0,
      validationCount: 0,
      candidateCount: 0,
      rejectedCandidates: 0,
    },
    runtimeMs: 0,
    sheets: [],
    placements: [],
    unplaced: [],
    config: {
      gap: 0,
      ordering: strategy,
      rotation: { kind: 'none' as const },
    },
  }
  return toEval(strategy, 'fast', nestResult as never, [])
}
