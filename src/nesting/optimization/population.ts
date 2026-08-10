import type { PreparedPart } from '../core/prepare'
import type { NestingSuccess } from '../types'
import {
  cloneIndividual,
  individualFromMaps,
  type Individual,
} from './individual'
import type { Rng } from './rng'

function metricWidth(p: PreparedPart): number {
  return Math.max(...p.variants.map((v) => v.width))
}
function metricHeight(p: PreparedPart): number {
  return Math.max(...p.variants.map((v) => v.height))
}
function metricPerimeter(p: PreparedPart): number {
  return Math.max(...p.variants.map((v) => v.perimeter))
}
function metricCompact(p: PreparedPart): number {
  const w = metricWidth(p)
  const h = metricHeight(p)
  return p.area / Math.max(1e-9, w * h)
}
function metricLongEdge(p: PreparedPart): number {
  return Math.max(metricWidth(p), metricHeight(p))
}

function orderBy(
  parts: PreparedPart[],
  score: (p: PreparedPart) => number,
): string[] {
  return parts
    .slice()
    .sort((a, b) => {
      const d = score(b) - score(a)
      if (d !== 0) return d
      return a.partId.localeCompare(b.partId)
    })
    .map((p) => p.partId)
}

/** Hole-aware: parts with holes first (hosts), then small fillers. */
function holeAwareOrder(parts: PreparedPart[]): string[] {
  const hosts = parts.filter((p) => p.hasHoles)
  const rest = parts.filter((p) => !p.hasHoles)
  const hostIds = orderBy(hosts, (p) => p.area)
  const fillerIds = orderBy(rest, (p) => -p.area) // small first into holes
  return [...hostIds, ...fillerIds]
}

function rotationsForOrder(
  order: string[],
  byId: Map<string, PreparedPart>,
  allowed: number[],
  pick: (part: PreparedPart) => number,
): number[] {
  return order.map((id) => {
    const part = byId.get(id)
    if (!part) return allowed[0] ?? 0
    const r = pick(part)
    return allowed.includes(r) ? r : (allowed[0] ?? 0)
  })
}

function bestFitRotation(part: PreparedPart, preferWide: boolean): number {
  let best = part.variants[0]
  if (!best) return 0
  for (const v of part.variants) {
    if (!best) best = v
    else if (preferWide) {
      if (v.width > best.width) best = v
    } else if (v.height > best.height) best = v
  }
  return best.rotation
}

/** Build initial population with strong heuristic seeds + random diversity. */
export function createInitialPopulation(
  parts: PreparedPart[],
  allowedRotations: number[],
  baselineResult: NestingSuccess | null,
  populationSize: number,
  rng: Rng,
): Individual[] {
  const byId = new Map(parts.map((p) => [p.partId, p]))
  const ids = parts.map((p) => p.partId)
  const allowed = allowedRotations.length ? allowedRotations : [0]
  const out: Individual[] = []
  const seen = new Set<string>()

  const push = (ind: Individual) => {
    const key = `${ind.order.join(',')}|${ind.rotations.join(',')}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(ind)
  }

  // 1) Baseline BLF gene
  if (baselineResult && baselineResult.placements.length) {
    const placedOrder = baselineResult.placements.map((p) => p.partId)
    const rest = ids.filter((id) => !placedOrder.includes(id))
    const order = [...placedOrder, ...rest]
    const rotById = new Map<string, number>()
    for (const pl of baselineResult.placements) {
      rotById.set(pl.partId, pl.rotation)
    }
    for (const id of rest) rotById.set(id, allowed[0] ?? 0)
    push(individualFromMaps(order, rotById))
  }

  const defaultRot = (p: PreparedPart) =>
    p.variants.find((v) => v.rotation === (allowed[0] ?? 0))?.rotation ??
    p.variants[0]?.rotation ??
    0

  // 2–8 deterministic heuristic seeds
  const seeds: string[][] = [
    orderBy(parts, (p) => p.area), // largest-area-first
    orderBy(parts, metricLongEdge), // longest-edge-first
    orderBy(parts, metricWidth), // width-first
    orderBy(parts, metricHeight), // height-first
    orderBy(parts, metricPerimeter), // perimeter-first
    orderBy(parts, metricCompact), // compactness-first
    holeAwareOrder(parts), // hole-aware
  ]

  for (const order of seeds) {
    push({
      order,
      rotations: rotationsForOrder(order, byId, allowed, defaultRot),
    })
    push({
      order,
      rotations: rotationsForOrder(order, byId, allowed, (p) =>
        bestFitRotation(p, true),
      ),
    })
    push({
      order,
      rotations: rotationsForOrder(order, byId, allowed, (p) =>
        bestFitRotation(p, false),
      ),
    })
  }

  const areaOrder = orderBy(parts, (p) => p.area)
  for (const rot of allowed.slice(0, 8)) {
    push({
      order: areaOrder,
      rotations: areaOrder.map(() => rot),
    })
  }

  // Random seeded diversity
  while (out.length < populationSize) {
    const order = rng.shuffle(ids)
    const rotations = order.map(() => rng.pick(allowed))
    push({ order, rotations })
    if (seen.size > populationSize * 10) break
  }

  while (out.length < populationSize && out.length > 0) {
    const base = cloneIndividual(out[rng.int(out.length)]!)
    const order = rng.shuffle(base.order)
    const map = new Map(base.order.map((id, i) => [id, base.rotations[i]!]))
    push(individualFromMaps(order, map))
  }

  return out.slice(0, populationSize)
}

/** Distinct seed individuals for multi-start (first N unique heuristics). */
export function multiStartSeeds(
  parts: PreparedPart[],
  allowedRotations: number[],
  baselineResult: NestingSuccess | null,
  count: number,
  rng: Rng,
): Individual[] {
  const pop = createInitialPopulation(
    parts,
    allowedRotations,
    baselineResult,
    Math.max(count * 3, count),
    rng,
  )
  return pop.slice(0, count)
}
