import { solidsCollideByDistance, type Solid } from './collide'
import {
  blfProfileRecordCollision,
  isBlfProfiling,
} from './debug/blfProfiler'

/**
 * Nesting collision with spacing.
 *
 * Clearance uses boundary-to-boundary distance (edges + vertices), not
 * vertex-only checks. Clipper geometric offset is applied in NFP construction
 * (`computeNfp` / `offsetSolid`) where it is cached — not on every collide
 * call (that regresses evolutionary performance).
 */
export function solidsCollide(
  a: Solid,
  b: Solid,
  spacingMm: number,
): boolean {
  if (!isBlfProfiling()) return solidsCollideByDistance(a, b, spacingMm)
  const t0 = performance.now()
  try {
    return solidsCollideByDistance(a, b, spacingMm)
  } finally {
    blfProfileRecordCollision(performance.now() - t0)
  }
}
