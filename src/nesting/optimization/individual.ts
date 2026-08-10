export type Individual = {
  /** Placement order (part ids, permutation). */
  order: string[]
  /** Rotation degrees aligned with `order`. */
  rotations: number[]
}

export function cloneIndividual(ind: Individual): Individual {
  return { order: ind.order.slice(), rotations: ind.rotations.slice() }
}

export function rotationMap(ind: Individual): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < ind.order.length; i++) {
    m.set(ind.order[i]!, ind.rotations[i] ?? 0)
  }
  return m
}

export function individualFromMaps(
  order: string[],
  rotById: Map<string, number>,
  fallback = 0,
): Individual {
  return {
    order: order.slice(),
    rotations: order.map((id) => rotById.get(id) ?? fallback),
  }
}

export function isValidIndividual(
  ind: Individual,
  partIds: readonly string[],
  allowedRotations: readonly number[],
): boolean {
  if (ind.order.length !== partIds.length) return false
  if (ind.rotations.length !== ind.order.length) return false
  const seen = new Set<string>()
  for (const id of ind.order) {
    if (seen.has(id)) return false
    seen.add(id)
  }
  for (const id of partIds) {
    if (!seen.has(id)) return false
  }
  const allowed = new Set(allowedRotations)
  for (const r of ind.rotations) {
    if (!allowed.has(r)) return false
  }
  return true
}

/** Deterministic cache key for an individual + relevant settings. */
export function individualKey(
  ind: Individual,
  settingsKey: string,
): string {
  return `${settingsKey}|${ind.order.join(',')}|${ind.rotations.join(',')}`
}

export function settingsCacheKey(input: {
  spacingMm: number
  marginMm: number
  sheetW: number
  sheetH: number
  quantity: number
  allowedRotations: number[]
}): string {
  return [
    input.spacingMm,
    input.marginMm,
    input.sheetW,
    input.sheetH,
    input.quantity,
    input.allowedRotations.join('/'),
  ].join(';')
}
