/**
 * Permanent deterministic nesting geometry fixtures + BLF / evolutionary runs.
 */
import type { GeometryPart } from './types'
import { boundingBox, centroid, netArea } from './ops'
import { runBottomLeftNest } from '../nesting/placement/blf'
import { runEvolutionaryNest } from '../nesting/optimization/geneticOptimizer'
import type { NestingRequest, NestingSuccess } from '../nesting/types'
import { scoreNestingResult } from '../nesting/scoring/fitness'

export type FixtureId =
  | 'rectangles'
  | 'triangles'
  | 'circles'
  | 'L'
  | 'C'
  | 'U'
  | 'stars'
  | 'letters'
  | 'holes'
  | 'multiHoles'
  | 'mixedIrregular'
  | 'manySmall'
  | 'fewLarge'
  | 'mixedSizes'

function part(
  id: string,
  index: number,
  outer: { x: number; y: number }[],
  holes: { x: number; y: number }[][] = [],
): GeometryPart {
  const o = { points: outer }
  const h = holes.map((pts) => ({ points: pts }))
  return {
    id,
    sourceElement: 'path',
    originalIndex: index,
    sourceId: null,
    outer: o,
    holes: h,
    boundingBox: boundingBox(outer),
    area: netArea(o, h),
    centroid: centroid(outer),
    originalTransform: null,
  }
}

function rectRing(w: number, h: number) {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
}

function circleRing(r: number, n = 24) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    pts.push({ x: r + r * Math.cos(a), y: r + r * Math.sin(a) })
  }
  return pts
}

function LRing() {
  return [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 12 },
    { x: 12, y: 12 },
    { x: 12, y: 40 },
    { x: 0, y: 40 },
  ]
}

function CRing() {
  return [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 12 },
    { x: 12, y: 12 },
    { x: 12, y: 28 },
    { x: 40, y: 28 },
    { x: 40, y: 40 },
    { x: 0, y: 40 },
  ]
}

function URing() {
  return [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 28 },
    { x: 28, y: 28 },
    { x: 28, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 0, y: 40 },
  ]
}

function starRing() {
  const pts = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 18 : 7
    const a = Math.PI / 2 + (i * Math.PI) / 5
    pts.push({ x: 18 + r * Math.cos(a), y: 18 + r * Math.sin(a) })
  }
  return pts
}

/** Letter-like “E” path (fabrication-ish irregular). */
function letterE() {
  return [
    { x: 0, y: 0 },
    { x: 28, y: 0 },
    { x: 28, y: 8 },
    { x: 10, y: 8 },
    { x: 10, y: 16 },
    { x: 24, y: 16 },
    { x: 24, y: 24 },
    { x: 10, y: 24 },
    { x: 10, y: 32 },
    { x: 28, y: 32 },
    { x: 28, y: 40 },
    { x: 0, y: 40 },
  ]
}

export function buildFixture(id: FixtureId): GeometryPart[] {
  switch (id) {
    case 'rectangles':
      return [40, 35, 30, 25, 20].map((w, i) =>
        part(`r${i}`, i, rectRing(w, w * 0.7)),
      )
    case 'triangles':
      return [0, 1, 2, 3].map((i) =>
        part(`t${i}`, i, [
          { x: 0, y: 0 },
          { x: 30 + i * 5, y: 0 },
          { x: 15, y: 25 + i * 3 },
        ]),
      )
    case 'circles':
      return [12, 16, 20, 10].map((r, i) => part(`c${i}`, i, circleRing(r)))
    case 'L':
      return [0, 1, 2].map((i) => part(`L${i}`, i, LRing()))
    case 'C':
      return [0, 1, 2].map((i) => part(`C${i}`, i, CRing()))
    case 'U':
      return [0, 1, 2].map((i) => part(`U${i}`, i, URing()))
    case 'stars':
      return [0, 1, 2].map((i) => part(`s${i}`, i, starRing()))
    case 'letters':
      return [0, 1, 2, 3].map((i) => part(`E${i}`, i, letterE()))
    case 'holes':
      return [
        part(
          'donut',
          0,
          rectRing(80, 80),
          [
            [
              { x: 20, y: 20 },
              { x: 20, y: 60 },
              { x: 60, y: 60 },
              { x: 60, y: 20 },
            ],
          ],
        ),
        part('fill', 1, rectRing(25, 25)),
        part('side', 2, rectRing(30, 20)),
      ]
    case 'multiHoles':
      return [
        part(
          'mh',
          0,
          rectRing(120, 80),
          [
            [
              { x: 10, y: 10 },
              { x: 10, y: 35 },
              { x: 40, y: 35 },
              { x: 40, y: 10 },
            ],
            [
              { x: 70, y: 20 },
              { x: 70, y: 55 },
              { x: 105, y: 55 },
              { x: 105, y: 20 },
            ],
          ],
        ),
        part('a', 1, rectRing(18, 18)),
        part('b', 2, rectRing(22, 15)),
      ]
    case 'mixedIrregular':
      return [
        part('L', 0, LRing()),
        part('C', 1, CRing()),
        part('star', 2, starRing()),
        part('E', 3, letterE()),
        part('circ', 4, circleRing(14)),
      ]
    case 'manySmall':
      return Array.from({ length: 16 }, (_, i) =>
        part(`ms${i}`, i, rectRing(12 + (i % 5), 10 + (i % 3))),
      )
    case 'fewLarge':
      return [
        part('A', 0, rectRing(180, 120)),
        part('B', 1, rectRing(160, 100)),
        part('C', 2, LRing().map((p) => ({ x: p.x * 3, y: p.y * 3 }))),
      ]
    case 'mixedSizes':
      return [
        part('big', 0, rectRing(100, 80)),
        part('mid', 1, rectRing(50, 40)),
        part('s1', 2, rectRing(20, 15)),
        part('s2', 3, rectRing(18, 22)),
        part('L', 4, LRing()),
        part('circ', 5, circleRing(12)),
      ]
  }
}

export type NestBenchRow = {
  fixture: FixtureId
  engine: 'blf' | 'evolutionary'
  placed: number
  unplaced: number
  sheets: number
  utilization: number
  waste: number
  compactness: number
  score: number
  ms: number
}

function requestFor(parts: GeometryPart[]): NestingRequest {
  return {
    parts,
    sheets: [{ widthMm: 400, heightMm: 300, marginMm: 5, quantity: 8 }],
    settings: {
      spacingMm: 2,
      allowedRotations: [0, 90, 180, 270],
      allowArbitraryRotation: false,
      optimizationLevel: 'fast',
      timeLimitMs: 400,
      seed: 7,
      allowPartInPart: false,
    },
  }
}

function compactness(ok: NestingSuccess): number {
  let sum = 0
  for (const s of ok.sheets) {
    if (!s.usedBounds) continue
    const w = s.usedBounds.maxX - s.usedBounds.minX
    const h = s.usedBounds.maxY - s.usedBounds.minY
    sum += w * h
  }
  return sum
}

export function runNestingFixtureSuite(): NestBenchRow[] {
  const ids: FixtureId[] = [
    'rectangles',
    'triangles',
    'circles',
    'L',
    'C',
    'U',
    'stars',
    'letters',
    'holes',
    'multiHoles',
    'mixedIrregular',
    'manySmall',
    'fewLarge',
    'mixedSizes',
  ]
  const rows: NestBenchRow[] = []
  for (const id of ids) {
    const parts = buildFixture(id)
    const req = requestFor(parts)

    const t0 = performance.now()
    const blf = runBottomLeftNest(req)
    const blfMs = performance.now() - t0
    if (blf.status === 'ok') {
      const sc = scoreNestingResult(blf)
      rows.push({
        fixture: id,
        engine: 'blf',
        placed: blf.statistics.placedCount,
        unplaced: blf.statistics.unplacedCount,
        sheets: blf.statistics.sheetCountUsed,
        utilization: blf.utilization,
        waste: blf.wasteMm2,
        compactness: compactness(blf),
        score: sc.total,
        ms: blfMs,
      })
    }

    const t1 = performance.now()
    const evo = runEvolutionaryNest(req, {
      seed: 7,
      timeLimitMs: 400,
      maxGenerations: 40,
    })
    const evoMs = performance.now() - t1
    if (evo.status === 'ok') {
      const sc = scoreNestingResult(evo)
      rows.push({
        fixture: id,
        engine: 'evolutionary',
        placed: evo.statistics.placedCount,
        unplaced: evo.statistics.unplacedCount,
        sheets: evo.statistics.sheetCountUsed,
        utilization: evo.utilization,
        waste: evo.wasteMm2,
        compactness: compactness(evo),
        score: sc.total,
        ms: evoMs,
      })
    }
  }
  return rows
}

export function formatNestBench(rows: NestBenchRow[]): string {
  const lines = ['Nesting fixture benchmark', '-------------------------']
  for (const r of rows) {
    lines.push(
      `${r.fixture.padEnd(16)} ${r.engine.padEnd(12)} placed=${r.placed}/${r.placed + r.unplaced} sheets=${r.sheets} util=${(r.utilization * 100).toFixed(1)}% score=${r.score.toFixed(1)} ${r.ms.toFixed(1)}ms`,
    )
  }
  return lines.join('\n')
}
