/**
 * Deterministic geometry / nesting micro-benchmark.
 * Run via: npx vitest run src/geometry/benchmark.test.ts
 */

import {
  beginNestingGeometrySession,
  computeNfp,
  getSharedNfpCache,
  normalizePolygon,
  offsetPolygon,
  solidFromRings,
  solidsCollide,
  type Solid,
} from './index'
import { runBottomLeftNest } from '../nesting/placement/blf'
import type { NestingRequest } from '../nesting/types'
import type { GeometryPart } from './types'
import { boundingBox, netArea, centroid } from './ops'

export type BenchRow = {
  name: string
  ops: number
  ms: number
  cacheHitRate?: number
}

function rectPart(id: string, w: number, h: number, index: number): GeometryPart {
  const outer = {
    points: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
  }
  return {
    id,
    sourceElement: 'rect',
    originalIndex: index,
    sourceId: null,
    outer,
    holes: [],
    boundingBox: boundingBox(outer.points),
    area: netArea(outer, []),
    centroid: centroid(outer.points),
    originalTransform: null,
  }
}

function timed(name: string, ops: number, fn: () => void): BenchRow {
  const t0 = performance.now()
  fn()
  return { name, ops, ms: performance.now() - t0 }
}

export function runGeometryBenchmark(): BenchRow[] {
  const rows: BenchRow[] = []
  const A = solidFromRings(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ],
    [],
  )
  const B = solidFromRings(
    [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 20 },
      { x: 0, y: 20 },
    ],
    [],
  )
  const L: Solid = solidFromRings(
    [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 60 },
      { x: 0, y: 60 },
    ],
    [],
  )

  rows.push(
    timed('normalize', 500, () => {
      for (let i = 0; i < 500; i++) {
        normalizePolygon(L.outer.points, true)
      }
    }),
  )

  rows.push(
    timed('collision', 2000, () => {
      for (let i = 0; i < 2000; i++) {
        solidsCollide(A, B, i % 5)
      }
    }),
  )

  rows.push(
    timed('offset', 200, () => {
      for (let i = 0; i < 200; i++) {
        offsetPolygon(A.outer, 2)
      }
    }),
  )

  beginNestingGeometrySession()
  const cache = getSharedNfpCache()
  rows.push(
    timed('nfp', 80, () => {
      for (let i = 0; i < 80; i++) {
        computeNfp(A, B, i % 3)
      }
    }),
  )
  rows[rows.length - 1]!.cacheHitRate = cache.hitRate()

  // Cached NFP repeats
  beginNestingGeometrySession()
  const cache2 = getSharedNfpCache()
  rows.push(
    timed('nfp_cached_repeats', 200, () => {
      for (let i = 0; i < 200; i++) {
        const nfp = computeNfp(A, B, 2)
        cache2.set(
          {
            stationaryPartId: 'A',
            movingPartId: 'B',
            rotationA: 0,
            rotationB: 0,
            spacing: 2,
            geometryVersion: 'v1',
          },
          nfp,
        )
        cache2.get({
          stationaryPartId: 'A',
          movingPartId: 'B',
          rotationA: 0,
          rotationB: 0,
          spacing: 2,
          geometryVersion: 'v1',
        })
      }
    }),
  )
  rows[rows.length - 1]!.cacheHitRate = cache2.hitRate()

  const parts = [
    rectPart('p0', 100, 80, 0),
    rectPart('p1', 90, 70, 1),
    rectPart('p2', 60, 50, 2),
    rectPart('p3', 40, 40, 3),
    rectPart('p4', 30, 25, 4),
  ]
  const request: NestingRequest = {
    parts,
    sheets: [
      { widthMm: 500, heightMm: 400, marginMm: 5, quantity: 2 },
    ],
    settings: {
      spacingMm: 2,
      allowedRotations: [0, 90, 180, 270],
      allowArbitraryRotation: false,
      optimizationLevel: 'fast',
      timeLimitMs: 200,
      seed: 1,
      allowPartInPart: false,
    },
  }

  rows.push(
    timed('placement_blf_nest', 1, () => {
      runBottomLeftNest(request)
    }),
  )

  return rows
}

export function formatBenchmark(rows: BenchRow[]): string {
  const lines = ['Geometry benchmark', '------------------']
  for (const r of rows) {
    const hit =
      r.cacheHitRate != null
        ? `  cacheHit=${(r.cacheHitRate * 100).toFixed(1)}%`
        : ''
    lines.push(
      `${r.name.padEnd(22)} ops=${String(r.ops).padStart(5)}  ${r.ms.toFixed(2)}ms${hit}`,
    )
  }
  return lines.join('\n')
}
