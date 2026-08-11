/**
 * Engine-level rotation policies (UI-independent).
 * Free-angle search lives in `search.ts` — not in the nest loop.
 */
export type AnglePrecision = {
  /** Canonical decimal places for cache keys / equality (degrees). */
  readonly decimals: number
}

export const DEFAULT_ANGLE_PRECISION: AnglePrecision = {
  decimals: 4,
}

/** Cascade config for `{ kind: 'free' }`. */
export type FreeAngleConfig = {
  readonly coarseStepDeg?: number
  readonly refineStepDeg?: number
  readonly finalStepDeg?: number
  /** How many best coarse angles seed refine (plus baselines/diversity). */
  readonly coarseTopK?: number
  /** Always retained as refine seeds (default [0]). */
  readonly baselineAnglesDeg?: readonly number[]
  /** Extra seeds spaced around the circle for diversity. */
  readonly diversityCount?: number
  /**
   * If true (default), nest() also runs orthogonal and keeps the better result.
   * Guard only — not a global optimizer.
   */
  readonly baselineFloor?: boolean
  readonly precision?: AnglePrecision
}

export const DEFAULT_FREE_ANGLE: Required<
  Omit<FreeAngleConfig, 'precision'>
> & { precision: AnglePrecision } = {
  coarseStepDeg: 15,
  refineStepDeg: 5,
  finalStepDeg: 1,
  coarseTopK: 3,
  baselineAnglesDeg: [0],
  diversityCount: 2,
  baselineFloor: true,
  precision: DEFAULT_ANGLE_PRECISION,
}

export type RotationPolicy =
  | { readonly kind: 'none' }
  | { readonly kind: 'fixed'; readonly anglesDeg: readonly number[] }
  | { readonly kind: 'orthogonal' }
  | { readonly kind: 'free'; readonly free?: FreeAngleConfig }

export const DEFAULT_ROTATION: RotationPolicy = { kind: 'orthogonal' }

export const ORTHOGONAL_ANGLES = [0, 90, 180, 270] as const
