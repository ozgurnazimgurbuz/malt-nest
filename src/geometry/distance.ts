import { solidsDistance, solidsOverlap, type Solid } from './collide'
import { geomEps } from './tolerance'

export type SeparationKind = 'overlap' | 'touching' | 'separated'

/**
 * Classify relationship of two solids with central tolerance.
 * touching: distance ≈ 0 and not overlapping interiors
 * separated: distance > 0
 */
export function classifySeparation(
  a: Solid,
  b: Solid,
): { kind: SeparationKind; distanceMm: number } {
  if (solidsOverlap(a, b)) {
    return { kind: 'overlap', distanceMm: 0 }
  }
  const d = solidsDistance(a, b)
  if (d <= geomEps() * 10) {
    return { kind: 'touching', distanceMm: 0 }
  }
  return { kind: 'separated', distanceMm: d }
}

/** True when solids respect minimum spacing (touching OK iff spacingMm ≈ 0). */
export function respectsSpacing(
  a: Solid,
  b: Solid,
  spacingMm: number,
): boolean {
  const { kind, distanceMm } = classifySeparation(a, b)
  if (kind === 'overlap') return false
  const need = Math.max(0, spacingMm)
  if (need <= geomEps()) return kind === 'touching' || kind === 'separated'
  return distanceMm + geomEps() >= need
}

export function distance(a: Solid, b: Solid): number {
  return solidsDistance(a, b)
}
