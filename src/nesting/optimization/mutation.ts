import type { Individual } from './individual'
import { cloneIndividual } from './individual'
import type { Rng } from './rng'

export function swapMutation(ind: Individual, rng: Rng): Individual {
  const out = cloneIndividual(ind)
  const n = out.order.length
  if (n < 2) return out
  const i = rng.int(n)
  let j = rng.int(n - 1)
  if (j >= i) j += 1
  const to = out.order[i]!
  out.order[i] = out.order[j]!
  out.order[j] = to
  const tr = out.rotations[i]!
  out.rotations[i] = out.rotations[j]!
  out.rotations[j] = tr
  return out
}

export function insertionMutation(ind: Individual, rng: Rng): Individual {
  const out = cloneIndividual(ind)
  const n = out.order.length
  if (n < 2) return out
  const from = rng.int(n)
  let to = rng.int(n - 1)
  if (to >= from) to += 1
  const [id] = out.order.splice(from, 1)
  const [rot] = out.rotations.splice(from, 1)
  out.order.splice(to, 0, id!)
  out.rotations.splice(to, 0, rot!)
  return out
}

export function rotationMutation(
  ind: Individual,
  rng: Rng,
  allowed: readonly number[],
): Individual {
  const out = cloneIndividual(ind)
  if (!out.order.length || allowed.length === 0) return out
  const i = rng.int(out.order.length)
  const current = out.rotations[i]!
  if (allowed.length === 1) {
    out.rotations[i] = allowed[0]!
    return out
  }
  let next = rng.pick(allowed)
  let guard = 0
  while (next === current && guard++ < 8) next = rng.pick(allowed)
  out.rotations[i] = next
  return out
}

export function mutateIndividual(
  ind: Individual,
  rng: Rng,
  allowed: readonly number[],
  mutationRate: number,
): Individual {
  let cur = ind
  if (rng.chance(mutationRate)) cur = swapMutation(cur, rng)
  if (rng.chance(mutationRate)) cur = insertionMutation(cur, rng)
  if (rng.chance(mutationRate)) cur = rotationMutation(cur, rng, allowed)
  return cur
}
