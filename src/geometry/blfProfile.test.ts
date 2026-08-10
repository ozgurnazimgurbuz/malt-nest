import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { boundingBox, type GeometryPart } from '../geometry'
import {
  beginBlfProfiling,
  blfProfileBeginPart,
  blfProfileBeginRotation,
  blfProfileEndPart,
  blfProfileEndRotation,
  endBlfProfiling,
  formatBlfProfileReport,
  getBlfProfileSnapshot,
} from '../geometry/debug/blfProfiler'
import { beginNestingGeometrySession, solidsCollide } from '../geometry'
import {
  findVariant,
  ifpBounds,
  prepareParts,
  variantWorldSolid,
} from '../nesting/core/prepare'
import { collectPlacementCandidates } from '../nesting/nfp/candidates'
import type { NestingSettings } from '../nesting/types'

function denseRing(
  r: number,
  n: number,
  wobble: number,
  seed: number,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const w = 1 + wobble * Math.sin(a * (3 + (seed % 5)) + seed)
    pts.push({ x: Math.cos(a) * r * w, y: Math.sin(a) * r * w })
  }
  return pts
}

function partFromRing(
  id: string,
  index: number,
  points: { x: number; y: number }[],
): GeometryPart {
  return {
    id,
    sourceElement: 'path',
    originalIndex: index,
    sourceId: null,
    outer: { points },
    holes: [],
    boundingBox: boundingBox(points),
    area: Math.abs(
      points.reduce((s, p, i) => {
        const q = points[(i + 1) % points.length]!
        return s + (p.x * q.y - q.x * p.y)
      }, 0) / 2,
    ),
    centroid: {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    },
    originalTransform: null,
  }
}

function buildDemoLike16(): GeometryPart[] {
  const specs: Array<{ r: number; n: number; wobble: number }> = [
    { r: 180, n: 64, wobble: 0.18 },
    { r: 160, n: 56, wobble: 0.22 },
    { r: 140, n: 72, wobble: 0.15 },
    { r: 130, n: 48, wobble: 0.25 },
    { r: 120, n: 80, wobble: 0.12 },
    { r: 110, n: 44, wobble: 0.3 },
    { r: 100, n: 56, wobble: 0.2 },
    { r: 95, n: 64, wobble: 0.16 },
    { r: 90, n: 40, wobble: 0.28 },
    { r: 85, n: 72, wobble: 0.14 },
    { r: 80, n: 48, wobble: 0.24 },
    { r: 75, n: 52, wobble: 0.18 },
    { r: 70, n: 40, wobble: 0.22 },
    { r: 65, n: 36, wobble: 0.2 },
    { r: 60, n: 44, wobble: 0.15 },
    { r: 55, n: 32, wobble: 0.26 },
  ]
  return specs.map((s, i) =>
    partFromRing(`part-${i}`, i, denseRing(s.r, s.n, s.wobble, i + 1)),
  )
}

const settings: NestingSettings = {
  spacingMm: 5,
  allowedRotations: [0, 90, 180, 270],
  allowArbitraryRotation: false,
  rotationMode: 'orthogonal',
  optimizationLevel: 'fast',
  timeLimitMs: 500,
  seed: 1,
  allowPartInPart: false,
}

describe('Stage 10B BLF profiler', () => {
  it('profiles part #10 placement vs 9 placed dense solids', () => {
    const parts = buildDemoLike16()
    beginNestingGeometrySession()
    const prepared = prepareParts(parts, settings, { sortByArea: true })
    expect(prepared.length).toBe(16)

    // Simulate mid-BLF: first 9 area-sorted parts already placed (non-overlapping grid).
    const placedMeta: Array<{ partId: string; rotation: number }> = []
    const placedSolids = []
    for (let i = 0; i < 9; i++) {
      const p = prepared[i]!
      const v = p.variants[0]!
      const col = i % 3
      const row = Math.floor(i / 3)
      const x = 20 + col * 420
      const y = 20 + row * 280
      placedSolids.push(variantWorldSolid(v, x, y))
      placedMeta.push({ partId: p.partId, rotation: v.rotation })
    }

    const moving = prepared[9]!
    const sheetW = 1600
    const sheetH = 1000
    const margin = 10
    const spacing = 5

    beginBlfProfiling()
    blfProfileBeginPart({
      index: 9,
      partId: moving.partId,
      vertexCount: moving.variants[0]!.solid.outer.points.length,
      holeCount: moving.variants[0]!.solid.holes.length,
      bbox: {
        w: moving.variants[0]!.width,
        h: moving.variants[0]!.height,
      },
    })

    const tPart = performance.now()
    let sheetsTried = 1
    let placedOk = false

    for (const rot of [0, 90, 180, 270]) {
      const variant = findVariant(moving, rot)
      if (!variant) continue
      blfProfileBeginRotation(rot)
      const tRot = performance.now()
      const ifp = ifpBounds(variant, sheetW, sheetH, margin)
      if (!ifp) {
        blfProfileEndRotation({
          candidates: 0,
          candidateGenMs: 0,
          accepted: false,
          totalMs: performance.now() - tRot,
        })
        continue
      }
      const tCand = performance.now()
      const candidates = collectPlacementCandidates(
        variant,
        placedSolids,
        ifp,
        spacing,
        placedMeta,
      )
      const candidateGenMs = performance.now() - tCand

      let accepted = false
      for (const t of candidates) {
        const world = variantWorldSolid(variant, t.x, t.y)
        const m = margin
        if (
          !(
            world.bounds.minX >= m - 1e-9 &&
            world.bounds.minY >= m - 1e-9 &&
            world.bounds.maxX <= sheetW - m + 1e-9 &&
            world.bounds.maxY <= sheetH - m + 1e-9
          )
        ) {
          continue
        }
        let hit = false
        for (const other of placedSolids) {
          if (solidsCollide(world, other, spacing)) {
            hit = true
            break
          }
        }
        if (!hit) {
          accepted = true
          placedOk = true
          break
        }
      }

      blfProfileEndRotation({
        candidates: candidates.length,
        candidateGenMs,
        accepted,
        totalMs: performance.now() - tRot,
      })
      // Match pickBestVariant: evaluate ALL rotations (no early break).
    }

    blfProfileEndPart({
      placed: placedOk,
      placementMs: performance.now() - tPart,
      sheetsTried,
    })

    const snapshot = getBlfProfileSnapshot()
    const report = formatBlfProfileReport(9)
    // eslint-disable-next-line no-console
    console.log('\n' + report + '\n')

    const part10 = snapshot.parts.find((p) => p.index === 9)!
    expect(part10.rotations.length).toBe(4)
    // After Stage 10C edgeVertex subsample: still enough contacts, not 100k+/rot
    expect(part10.candidatesTotal).toBeGreaterThan(100)
    expect(part10.candidatesTotal).toBeLessThan(120_000)
    // NFP minkowski still dominates; candidate path should no longer be tens of seconds alone
    expect(part10.placementMs).toBeLessThan(45_000)

    const src = snapshot.candidateSources

    // Keep Stage 10B doc as baseline reference (pre-fix numbers documented in prose)
    writeFileSync(
      resolve(__dirname, '../../docs/benchmarks/stage-10c-edge-subsample.md'),
      [
        '# Stage 10C — edgeVertex subsample',
        '',
        'Fix for Stage 10B root cause: subsample `addEdgeVertexContacts` (≤36 edges × ≤36 verts),',
        'matching `vertexPairs` sampling. NFP boundary unchanged. No hard candidate CAP.',
        '',
        '```',
        report.trim(),
        '```',
        '',
        '| Source | Count |',
        '| --- | ---: |',
        `| nfpBoundary | ${src.nfpBoundary} |`,
        `| vertexPairs | ${src.vertexPairs} |`,
        `| edgeVertex (subsampled) | ${src.edgeVertex} |`,
        '',
        `Part 10 placement: **${part10.placementMs.toFixed(0)} ms** (Stage 10B was ~39500 ms).`,
        `Candidates total: **${part10.candidatesTotal}** (Stage 10B was ~724391).`,
        '',
      ].join('\n'),
    )

    expect(src.edgeVertex).toBeLessThan(200_000)
    endBlfProfiling()
  }, 180_000)
})
