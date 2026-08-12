/**
 * Stage 9 fabrication-style fixtures A–J + before/after helper.
 */
import type { GeometryPart } from './types'
import { boundingBox, centroid, netArea } from './ops'
import { runBottomLeftNest } from '../nesting/placement/blf'
import { runAutomaticNest } from '../nesting/optimization/automaticOptimizer'
import type { NestingRequest, NestingSuccess } from '../nesting/types'
import {
  compareNestingResults,
  scoreNestingResult,
} from '../nesting/scoring/fitness'

export type FabId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J'

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

function rect(w: number, h: number) {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
}

function L(scale = 1) {
  return [
    { x: 0, y: 0 },
    { x: 40 * scale, y: 0 },
    { x: 40 * scale, y: 12 * scale },
    { x: 12 * scale, y: 12 * scale },
    { x: 12 * scale, y: 40 * scale },
    { x: 0, y: 40 * scale },
  ]
}

function C(scale = 1) {
  return [
    { x: 0, y: 0 },
    { x: 40 * scale, y: 0 },
    { x: 40 * scale, y: 12 * scale },
    { x: 12 * scale, y: 12 * scale },
    { x: 12 * scale, y: 28 * scale },
    { x: 40 * scale, y: 28 * scale },
    { x: 40 * scale, y: 40 * scale },
    { x: 0, y: 40 * scale },
  ]
}

function narrow(w: number, h: number) {
  return rect(w, h)
}

export function buildFabFixture(id: FabId): GeometryPart[] {
  switch (id) {
    case 'A': // 10 rectangular panels
      return Array.from({ length: 10 }, (_, i) =>
        part(`A${i}`, i, rect(80 + (i % 3) * 10, 50 + (i % 2) * 15)),
      )
    case 'B': // 20 mixed rectangles
      return Array.from({ length: 20 }, (_, i) =>
        part(`B${i}`, i, rect(30 + (i % 7) * 8, 25 + (i % 5) * 6)),
      )
    case 'C': // 20 irregular signage
      return Array.from({ length: 20 }, (_, i) =>
        part(`C${i}`, i, i % 2 === 0 ? L(0.7 + (i % 3) * 0.1) : C(0.7 + (i % 3) * 0.1)),
      )
    case 'D': // 50 mixed
      return Array.from({ length: 50 }, (_, i) => {
        if (i % 5 === 0) return part(`D${i}`, i, L(0.5))
        if (i % 5 === 1) return part(`D${i}`, i, C(0.5))
        return part(`D${i}`, i, rect(18 + (i % 6) * 4, 14 + (i % 4) * 3))
      })
    case 'E': // 100 small
      return Array.from({ length: 100 }, (_, i) =>
        part(`E${i}`, i, rect(12 + (i % 4), 10 + (i % 3))),
      )
    case 'F': // concave-heavy
      return Array.from({ length: 16 }, (_, i) =>
        part(`F${i}`, i, i % 2 ? L(0.8) : C(0.8)),
      )
    case 'G': // hole-heavy
      return [
        ...Array.from({ length: 4 }, (_, i) =>
          part(
            `Ghost${i}`,
            i,
            rect(90, 70),
            [
              [
                { x: 20, y: 15 },
                { x: 20, y: 50 },
                { x: 55, y: 50 },
                { x: 55, y: 15 },
              ],
            ],
          ),
        ),
        ...Array.from({ length: 8 }, (_, i) =>
          part(`Gfill${i}`, 4 + i, rect(20 + (i % 3) * 2, 18)),
        ),
      ]
    case 'H': // mixed large + small
      return [
        part('Hbig0', 0, rect(160, 110)),
        part('Hbig1', 1, rect(140, 90)),
        part('Hmid', 2, L(1.2)),
        ...Array.from({ length: 12 }, (_, i) =>
          part(`Hs${i}`, 3 + i, rect(16 + (i % 4) * 3, 14 + (i % 3) * 2)),
        ),
      ]
    case 'I': // very narrow
      return Array.from({ length: 15 }, (_, i) =>
        part(`I${i}`, i, narrow(120 + i * 2, 8 + (i % 2))),
      )
    case 'J': // rotated irregular (engine will try angles)
      return Array.from({ length: 12 }, (_, i) =>
        part(`J${i}`, i, L(0.6 + (i % 4) * 0.15)),
      )
  }
}

export type FabRow = {
  id: FabId
  engine: 'blf' | 'automatic'
  placed: number
  unplaced: number
  sheets: number
  utilization: number
  waste: number
  score: number
  firstChampionMs: number
  finalMs: number
  canonicalVsSeed: number | null
}

function requestFor(parts: GeometryPart[], opts?: { partInPart?: boolean }): NestingRequest {
  return {
    parts,
    sheets: [{ widthMm: 500, heightMm: 400, marginMm: 5, quantity: 20 }],
    settings: {
      spacingMm: 2,
      allowedRotations: [0, 90, 180, 270],
      allowArbitraryRotation: false,
      rotationMode: 'orthogonal',
      seed: 9,
      allowPartInPart: opts?.partInPart ?? false,
    },
  }
}

export function runFabBenchmark(): FabRow[] {
  const ids: FabId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
  const rows: FabRow[] = []
  for (const id of ids) {
    const parts = buildFabFixture(id)
    const req = requestFor(parts, { partInPart: id === 'G' })

    const t0 = performance.now()
    const blf = runBottomLeftNest(req)
    const blfMs = performance.now() - t0
    if (blf.status === 'ok') {
      rows.push({
        id,
        engine: 'blf',
        placed: blf.statistics.placedCount,
        unplaced: blf.statistics.unplacedCount,
        sheets: blf.statistics.sheetCountUsed,
        utilization: blf.utilization,
        waste: blf.wasteMm2,
        score: scoreNestingResult(blf).total,
        firstChampionMs: blfMs,
        finalMs: blfMs,
        canonicalVsSeed: null,
      })
    }

    const automaticStartedAt = performance.now()
    let firstChampionMs: number | null = null
    let exactSeed = null as NestingSuccess | null
    const automatic = runAutomaticNest(req, {
      seed: 9,
      onProgress: ({ bestSoFar }) => {
        if (firstChampionMs == null && bestSoFar) {
          firstChampionMs = performance.now() - automaticStartedAt
          exactSeed = bestSoFar
        }
      },
    })
    const automaticMs = performance.now() - automaticStartedAt
    if (automatic.status === 'ok') {
      rows.push({
        id,
        engine: 'automatic',
        placed: automatic.statistics.placedCount,
        unplaced: automatic.statistics.unplacedCount,
        sheets: automatic.statistics.sheetCountUsed,
        utilization: automatic.utilization,
        waste: automatic.wasteMm2,
        score: scoreNestingResult(automatic).total,
        firstChampionMs: firstChampionMs ?? automaticMs,
        finalMs: automaticMs,
        canonicalVsSeed: exactSeed == null
          ? null
          : compareNestingResults(automatic, exactSeed),
      })
    }
  }
  return rows
}

export function formatFabBench(rows: FabRow[]): string {
  const lines = ['Stage 9 fabrication fixtures', '----------------------------']
  for (const r of rows) {
    lines.push(
      `${r.id} ${r.engine.padEnd(12)} placed=${r.placed} unplaced=${r.unplaced} sheets=${r.sheets} util=${(r.utilization * 100).toFixed(1)}% waste=${r.waste.toFixed(0)} score=${r.score.toFixed(0)} first=${r.firstChampionMs.toFixed(0)}ms final=${r.finalMs.toFixed(0)}ms`,
    )
  }
  return lines.join('\n')
}
