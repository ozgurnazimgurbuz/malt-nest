/**
 * Backend comparison: custom miter offset vs clipper2-ts.
 * WASM deferred (init cost) — measured separately if installed.
 */
import {
  inflatePathsD,
  JoinType,
  EndType,
  minkowskiDiffD,
  unionD,
  differenceD,
  FillRule,
} from 'clipper2-ts'
import { offsetPolygon as miterOffset } from './offset'
import { minkowskiDifferenceConvex } from './minkowski'
import { solidFromRings } from './collide'
import { computeNfp } from './nfp'
import { GEOMETRY_BACKEND_ID } from './backend/id'

export type BackendBenchRow = {
  name: string
  backend: string
  ops: number
  ms: number
}

function rect(w: number, h: number) {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
}

function L() {
  return [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 12 },
    { x: 12, y: 12 },
    { x: 12, y: 40 },
    { x: 0, y: 40 },
  ]
}

function timed(
  name: string,
  backend: string,
  ops: number,
  fn: () => void,
): BackendBenchRow {
  const t0 = performance.now()
  fn()
  return { name, backend, ops, ms: performance.now() - t0 }
}

export function runBackendBenchmark(): BackendBenchRow[] {
  const rows: BackendBenchRow[] = []
  const A = rect(100, 80)
  const B = rect(30, 20)
  const Lp = L()
  const solidA = solidFromRings(A, [])
  const solidB = solidFromRings(B, [])
  const solidL = solidFromRings(Lp, [])

  rows.push(
    timed('offset', 'clipper', 200, () => {
      for (let i = 0; i < 200; i++) {
        inflatePathsD([A], 2, JoinType.Miter, EndType.Polygon, 4, 2)
      }
    }),
  )
  rows.push(
    timed('offset', 'miter-fallback-api', 200, () => {
      for (let i = 0; i < 200; i++) {
        miterOffset({ points: A }, 2)
      }
    }),
  )

  rows.push(
    timed('union', 'clipper', 200, () => {
      for (let i = 0; i < 200; i++) {
        unionD([A], [B.map((p) => ({ x: p.x + 40, y: p.y + 20 }))], FillRule.NonZero)
      }
    }),
  )
  rows.push(
    timed('difference', 'clipper', 200, () => {
      for (let i = 0; i < 200; i++) {
        differenceD([A], [B.map((p) => ({ x: p.x + 10, y: p.y + 10 }))], FillRule.NonZero)
      }
    }),
  )

  rows.push(
    timed('nfp_convex', 'custom-minkowski', 200, () => {
      for (let i = 0; i < 200; i++) minkowskiDifferenceConvex({ points: A }, { points: B })
    }),
  )
  rows.push(
    timed('nfp_convex', 'clipper-minkowski', 200, () => {
      for (let i = 0; i < 200; i++) minkowskiDiffD(B, A, true)
    }),
  )
  rows.push(
    timed('nfp_concave', 'clipper-via-computeNfp', 80, () => {
      for (let i = 0; i < 80; i++) computeNfp(solidL, solidB, 0)
    }),
  )
  rows.push(
    timed('nfp_concave', 'clipper-via-computeNfp-spaced', 80, () => {
      for (let i = 0; i < 80; i++) computeNfp(solidL, solidB, 2)
    }),
  )

  rows.push(
    timed('nfp_warm_cache_path', GEOMETRY_BACKEND_ID, 80, () => {
      for (let i = 0; i < 80; i++) computeNfp(solidA, solidB, 1)
    }),
  )

  return rows
}

export function formatBackendBench(rows: BackendBenchRow[]): string {
  const lines = [
    'Backend benchmark (custom vs clipper2-ts)',
    '----------------------------------------',
  ]
  for (const r of rows) {
    lines.push(
      `${r.name.padEnd(28)} ${r.backend.padEnd(28)} ops=${String(r.ops).padStart(4)}  ${r.ms.toFixed(2)}ms`,
    )
  }
  lines.push('')
  lines.push('WASM: deferred — clipper2-ts selected (no init, Worker-friendly, BSL-1.0).')
  return lines.join('\n')
}
