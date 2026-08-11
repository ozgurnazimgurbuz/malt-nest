import type { AnglePrecision } from './types'
import { DEFAULT_ANGLE_PRECISION } from './types'

/**
 * Normalize to [0, 360). 360→0, negatives wrap, non-finite→0.
 * Does not snap to precision — use `canonicalizeAngle` for cache keys.
 */
export function normalizeDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  let d = deg % 360
  if (d < 0) d += 360
  if (d >= 360 - 1e-12) return 0
  return d
}

/** Snap to precision grid after normalize — deterministic cache / equality. */
export function canonicalizeAngle(
  deg: number,
  precision: AnglePrecision = DEFAULT_ANGLE_PRECISION,
): number {
  const n = normalizeDeg(deg)
  const f = 10 ** precision.decimals
  let c = Math.round(n * f) / f
  if (c >= 360 || c < 0) c = 0
  // 360° ≡ 0° after snap
  if (Math.abs(c - 360) < 10 ** -precision.decimals) c = 0
  return c
}

export function anglesEqual(
  a: number,
  b: number,
  precision: AnglePrecision = DEFAULT_ANGLE_PRECISION,
): boolean {
  return canonicalizeAngle(a, precision) === canonicalizeAngle(b, precision)
}
