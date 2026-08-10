import {
  individualFromMaps,
  rotationMap,
  type Individual,
} from './individual'
import type { Rng } from './rng'

/**
 * Order Crossover (OX) on permutation; rotations follow part ids.
 */
export function orderCrossover(
  parentA: Individual,
  parentB: Individual,
  rng: Rng,
): Individual {
  const n = parentA.order.length
  if (n === 0) return { order: [], rotations: [] }
  if (n === 1) {
    return {
      order: [parentA.order[0]!],
      rotations: [parentA.rotations[0]!],
    }
  }

  let i = rng.int(n)
  let j = rng.int(n)
  if (i > j) {
    const t = i
    i = j
    j = t
  }

  const childOrder: Array<string | null> = Array.from({ length: n }, () => null)
  const segment = new Set<string>()
  for (let k = i; k <= j; k++) {
    childOrder[k] = parentA.order[k]!
    segment.add(parentA.order[k]!)
  }

  let write = (j + 1) % n
  for (let k = 0; k < n; k++) {
    const candidate = parentB.order[(j + 1 + k) % n]!
    if (segment.has(candidate)) continue
    childOrder[write] = candidate
    write = (write + 1) % n
  }

  const order = childOrder.map((id, idx) => id ?? parentA.order[idx]!)
  const mapA = rotationMap(parentA)
  const mapB = rotationMap(parentB)
  const rotById = new Map<string, number>()
  for (const id of order) {
    // Inherit rotation from A if in crossed segment source, else B, else A
    if (segment.has(id) && mapA.has(id)) rotById.set(id, mapA.get(id)!)
    else if (mapB.has(id)) rotById.set(id, mapB.get(id)!)
    else rotById.set(id, mapA.get(id) ?? 0)
  }
  return individualFromMaps(order, rotById)
}
