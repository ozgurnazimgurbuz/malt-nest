import type { PreparedPart } from '../core/prepare'
import type { Rng } from './rng'

function metricWidth(p: PreparedPart): number {
  return p.maxWidth
}
function metricHeight(p: PreparedPart): number {
  return p.maxHeight
}
function metricPerimeter(p: PreparedPart): number {
  return p.perimeter
}
function metricBBoxArea(p: PreparedPart): number {
  return metricWidth(p) * metricHeight(p)
}
function metricLongEdge(p: PreparedPart): number {
  return Math.max(metricWidth(p), metricHeight(p))
}
function metricShortEdge(p: PreparedPart): number {
  return Math.min(metricWidth(p), metricHeight(p))
}
/** Higher → more irregular / concave relative to AABB fill. */
function metricComplexity(p: PreparedPart): number {
  const box = Math.max(1e-9, metricBBoxArea(p))
  const fill = p.area / box
  const peri = metricPerimeter(p)
  return peri * peri / Math.max(1e-9, p.area) + (1 - fill)
}

function orderBy(
  parts: PreparedPart[],
  score: (p: PreparedPart) => number,
  ascending = false,
): string[] {
  return parts
    .slice()
    .sort((a, b) => {
      const d = ascending ? score(a) - score(b) : score(b) - score(a)
      if (d !== 0) return d
      return a.partId.localeCompare(b.partId)
    })
    .map((p) => p.partId)
}

function holeAwareOrder(parts: PreparedPart[]): string[] {
  const hosts = parts.filter((p) => p.hasHoles)
  const rest = parts.filter((p) => !p.hasHoles)
  return [
    ...orderBy(hosts, (p) => p.area),
    ...orderBy(rest, (p) => p.area, true),
  ]
}

export type OrderCandidate = {
  name: string
  order: string[]
}

export type OrderCandidateOptions = {
  limit?: number
  includeRandom?: boolean
}

/**
 * Build every distinct deterministic candidate order used to seed the
 * automatic beam search.
 * An explicit limit remains available for profiling/diagnostic callers.
 */
export function buildOrderCandidates(
  parts: PreparedPart[],
  rng: Rng,
  limitOrOptions?: number | OrderCandidateOptions,
): OrderCandidate[] {
  if (parts.length === 0) return []
  const options =
    typeof limitOrOptions === 'number'
      ? { limit: limitOrOptions }
      : (limitOrOptions ?? {})
  const { limit } = options
  const out: OrderCandidate[] = []
  const seen = new Set<string>()

  const push = (name: string, order: string[]) => {
    const key = order.join(',')
    if (seen.has(key)) return
    seen.add(key)
    out.push({ name, order })
  }

  push('area_desc', orderBy(parts, (p) => p.area))
  push('perimeter_desc', orderBy(parts, metricPerimeter))
  push('hole_aware', holeAwareOrder(parts))
  push('area_asc', orderBy(parts, (p) => p.area, true))
  push('bbox_area_desc', orderBy(parts, metricBBoxArea))
  push('long_edge_desc', orderBy(parts, metricLongEdge))
  push('short_edge_desc', orderBy(parts, metricShortEdge))
  push('width_desc', orderBy(parts, metricWidth))
  push('height_desc', orderBy(parts, metricHeight))
  push('complexity_desc', orderBy(parts, metricComplexity))
  push('compact_fill_desc', orderBy(parts, (p) => p.area / Math.max(1e-9, metricBBoxArea(p))))

  if (options.includeRandom !== false) {
    const base = orderBy(parts, (p) => p.area)
    for (let i = 0; i < 5 && (limit == null || out.length < limit); i++) {
      push(`shuffle_${i}`, rng.shuffle(base))
    }
  }

  return limit == null ? out : out.slice(0, limit)
}
