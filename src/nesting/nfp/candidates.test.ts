import { describe, expect, it } from 'vitest'
import {
  beginNestingGeometrySession,
  computeNfp,
  getSharedNfpCache,
  NfpCache,
  nfpBoundaryTranslations,
  rotatePoints,
  solidFromRings,
  solidsCollide,
  translateSolid,
} from '../../geometry'
import {
  collectPlacementCandidates,
  nfpCandidateTranslations,
} from './candidates'

const rectangle = (width: number, height: number) =>
  solidFromRings([
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ])

describe('NFP placement candidates', () => {
  it('does not merge distinct contact points above geometry tolerance', () => {
    const outer = {
      points: [
        { x: 0, y: 0 },
        { x: 0.0000004, y: 0 },
        { x: 1, y: 1 },
      ],
    }
    const points = nfpBoundaryTranslations({
      regions: [{ outer, holes: [] }],
      outers: [outer],
      outer,
      method: 'minkowski-convex',
      exact: true,
      spacingMm: 0,
      backend: 'test',
      issues: [],
    })

    expect(points).toContainEqual({ x: 0, y: 0 })
    expect(points).toContainEqual({ x: 0.0000004, y: 0 })
  })

  it('rejects unbounded or invalid cache capacities', () => {
    expect(() => new NfpCache(0)).toThrow('positive safe integers')
    expect(() => new NfpCache(Infinity)).toThrow('positive safe integers')
    expect(() => new NfpCache(10, Infinity)).toThrow('positive safe integers')
  })

  it('does not alias distinct sub-micrometer spacing cache keys', () => {
    const cache = beginNestingGeometrySession()
    const stationary = rectangle(10, 10)
    const moving = rectangle(2, 2)

    nfpCandidateTranslations(stationary, moving, 0)
    nfpCandidateTranslations(stationary, moving, 0.0000004)

    expect(cache.misses).toBe(2)
    expect(cache.hits).toBe(0)
  })

  it('rejects a digest-key hit when exact geometry identities differ', () => {
    const cache = new NfpCache()
    const key = {
      stationaryPartId: 'same-digest',
      movingPartId: 'same-digest',
      rotationA: 0,
      rotationB: 0,
      spacing: 0,
      geometryVersion: 'forced-collision',
      geometrySignature: new Float64Array([1, 2, 3]),
    }
    cache.set(key, computeNfp(rectangle(10, 10), rectangle(2, 2)))

    expect(
      cache.get({
        ...key,
        geometrySignature: new Float64Array([1, 2, 4]),
      }),
    ).toBeUndefined()
    expect(cache.hits).toBe(0)
    expect(cache.misses).toBe(1)
  })

  it('reuses identical local geometry across part IDs and world poses', () => {
    const cache = beginNestingGeometrySession()
    const stationary = rectangle(10, 10)
    const moving = rectangle(2, 2)
    const first = nfpCandidateTranslations(stationary, moving, 0, {
      stationaryPartId: 'first-copy',
      movingPartId: 'moving-a',
      rotationA: 0,
      rotationB: 0,
    })
    const shifted = nfpCandidateTranslations(
      translateSolid(stationary, 40, 25),
      translateSolid(moving, 3, 7),
      0,
      {
        stationaryPartId: 'second-copy',
        movingPartId: 'moving-b',
        rotationA: 0,
        rotationB: 0,
      },
    )

    expect(cache.misses).toBe(1)
    expect(cache.hits).toBe(1)
    const keys = new Set(first.map((p) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`))
    for (const point of shifted) {
      expect(
        keys.has(`${(point.x - 37).toFixed(5)},${(point.y - 18).toFixed(5)}`),
      ).toBe(true)
    }
    expect(getSharedNfpCache()).toBe(cache)
  })

  it('generates the symmetric pose for a later frame around an earlier part', () => {
    beginNestingGeometrySession()
    const stationary = translateSolid(rectangle(2, 2), 10, 10)
    const frame = solidFromRings(
      [
        { x: 0, y: 0 }, { x: 10, y: 0 },
        { x: 10, y: 10 }, { x: 0, y: 10 },
      ],
      [[
        { x: 3, y: 3 }, { x: 7, y: 3 },
        { x: 7, y: 7 }, { x: 3, y: 7 },
      ]],
    )
    const candidates = nfpCandidateTranslations(stationary, frame, 0)

    expect(candidates).toContainEqual({ x: 7, y: 7 })
  })

  it('includes an exact pocket formed only by multiple obstacle boundaries', () => {
    beginNestingGeometrySession()
    const guest = rectangle(2, 2)
    const placed = [
      rectangle(2, 10),
      translateSolid(rectangle(6, 10), 4, 0),
      rectangle(10, 3),
      translateSolid(rectangle(10, 5), 0, 5),
    ]
    const candidates = collectPlacementCandidates(
      {
        partId: 'guest',
        sourceIndex: 0,
        rotation: 0,
        solid: guest,
        area: 4,
        rankSize: 2,
        width: 2,
        height: 2,
        perimeter: 8,
      },
      placed,
      { minX: 0, minY: 0, maxX: 8, maxY: 8 },
      0,
      undefined,
      undefined,
      undefined,
      true,
    )

    expect(candidates).toContainEqual({ x: 2, y: 3 })
    const fitted = translateSolid(guest, 2, 3)
    expect(placed.some((solid) => solidsCollide(solid, fitted, 0))).toBe(false)
  })

  it('retains a full 360-angle pair working set without LRU thrash', () => {
    const cache = beginNestingGeometrySession()
    const stationary = rectangle(10, 10)
    const triangle = [
      { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0.5, y: 2 },
    ]
    const run = () => {
      for (let angle = 0; angle < 360; angle++) {
        const moving = solidFromRings(
          rotatePoints(triangle, angle, { x: 0.5, y: 0.5 }),
        )
        nfpCandidateTranslations(stationary, moving, 0, {
          stationaryPartId: 'stationary',
          movingPartId: 'moving',
          rotationA: 0,
          rotationB: angle,
        })
      }
    }

    run()
    expect(cache.misses).toBe(360)
    run()
    expect(cache.misses).toBe(360)
    expect(cache.hits).toBe(360)
    expect(cache.pointCount).toBeLessThanOrEqual(200_000)
  })
})
