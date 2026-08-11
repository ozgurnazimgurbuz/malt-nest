import type { GeometryPart, Point } from '../../geometry'
import { signedArea } from '../../geometry'
import type {
  NestingSettings,
  OptimizationLevel,
  RotationMode,
} from '../types'

export type { RotationMode }

export const ORTHOGONAL_ANGLES = [0, 90, 180, 270]
export const BALANCED_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]

/** Coarse free-angle grid: 0°, 15°, …, 345°. */
export const FREE_ANGLE_COARSE_STEP = 15
/** Mid refinement around a coarse winner. */
export const FREE_ANGLE_REFINE_RADIUS = 15
export const FREE_ANGLE_REFINE_STEP = 5
/** Final 1° polish around the mid winner. */
export const FREE_ANGLE_FINAL_RADIUS = 5
export const FREE_ANGLE_FINAL_STEP = 1

export function normDeg(a: number): number {
  const normalized = a % 360
  if (normalized === 0) return 0
  return normalized < 0 ? normalized + 360 : normalized
}

export function uniqSorted(angles: number[]): number[] {
  const set = new Set(angles.map(normDeg))
  return [...set].sort((a, b) => a - b)
}

/** Coarse free-angle candidates (24 angles). Gene / prepare set. */
export function coarseFreeAngles(
  step = FREE_ANGLE_COARSE_STEP,
): number[] {
  const out: number[] = []
  for (let a = 0; a < 360 - 1e-9; a += step) out.push(a)
  return out
}

/** Inclusive angular window around centers, normalized & unique. */
export function anglesAround(
  centers: readonly number[],
  radius: number,
  step: number,
): number[] {
  if (step <= 0 || radius < 0 || centers.length === 0) return []
  const out: number[] = []
  for (const c of centers) {
    for (let d = -radius; d <= radius + 1e-9; d += step) {
      out.push(normDeg(c + d))
    }
  }
  return uniqSorted(out)
}

/**
 * Refinement angle sets for medium/seed free search:
 * coarse → refine(±15°, 5°) around seeds → final(±5°, 1°) around seeds.
 */
export function freeAngleCascadeStages(seedCenters?: readonly number[]): {
  coarse: number[]
  refine: (centers: readonly number[]) => number[]
  final: (centers: readonly number[]) => number[]
} {
  return {
    coarse: seedCenters?.length
      ? uniqSorted([...seedCenters])
      : coarseFreeAngles(),
    refine: (centers) =>
      anglesAround(centers, FREE_ANGLE_REFINE_RADIUS, FREE_ANGLE_REFINE_STEP),
    final: (centers) =>
      anglesAround(centers, FREE_ANGLE_FINAL_RADIUS, FREE_ANGLE_FINAL_STEP),
  }
}

/** Edge direction angles (degrees) from a closed ring. */
export function edgeOrientationAngles(points: Point[], max = 12): number[] {
  if (points.length < 2) return []
  const scored: Array<{ ang: number; len: number }> = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI
    ang = normDeg(ang)
    scored.push({ ang, len })
    scored.push({ ang: normDeg(ang + 180), len })
  }
  scored.sort((a, b) => b.len - a.len)
  return uniqSorted(scored.slice(0, max * 2).map((s) => s.ang)).slice(0, max)
}

/**
 * Adaptive deep candidates from geometry (bounded).
 * Combines orthogonal + balanced + longest-edge orientations ± small deltas.
 */
export function adaptiveAnglesFromParts(
  parts: GeometryPart[],
  budget = 24,
): number[] {
  const out: number[] = [...ORTHOGONAL_ANGLES, ...BALANCED_ANGLES]
  for (const part of parts.slice(0, 40)) {
    const edges = edgeOrientationAngles(part.outer.points, 6)
    for (const e of edges) {
      out.push(e)
      out.push(normDeg(e + 5))
      out.push(normDeg(e - 5))
      out.push(normDeg(e + 15))
      out.push(normDeg(e - 15))
    }
    const b = part.boundingBox
    if (b.width > b.height * 1.25 || b.height > b.width * 1.25) {
      out.push(0, 90)
    }
    void signedArea
  }
  for (const a of ORTHOGONAL_ANGLES) {
    out.push(normDeg(a + 10), normDeg(a - 10))
  }
  return uniqSorted(out).slice(0, budget)
}

export function anglesForMode(
  mode: RotationMode,
  parts: GeometryPart[],
): number[] {
  switch (mode) {
    case 'balanced':
      return [...BALANCED_ANGLES]
    case 'deep':
      return adaptiveAnglesFromParts(parts, 28)
    case 'free':
      return coarseFreeAngles()
    case 'orthogonal':
    default:
      return [...ORTHOGONAL_ANGLES]
  }
}

/** Resolve final allowed angles from NestingSettings (single place). */
export function resolveAllowedAngles(
  settings: NestingSettings,
  parts: GeometryPart[],
): number[] {
  if (settings.allowRotation === false) {
    return [0]
  }
  if (settings.allowedRotationsExplicit?.length) {
    return uniqSorted(settings.allowedRotationsExplicit)
  }
  if (settings.rotationStepDeg && settings.rotationStepDeg > 0) {
    const step = settings.rotationStepDeg
    const out: number[] = []
    for (let a = 0; a < 360 - 1e-9; a += step) out.push(a)
    return out.length ? out : [0]
  }
  const mode: RotationMode = settings.rotationMode ?? 'orthogonal'
  if (mode === 'free') {
    return coarseFreeAngles()
  }
  if (settings.allowArbitraryRotation && mode === 'deep') {
    return adaptiveAnglesFromParts(parts, 28)
  }
  if (mode === 'orthogonal' && settings.allowedRotations.length) {
    return uniqSorted(settings.allowedRotations)
  }
  return anglesForMode(mode, parts)
}

export function defaultModeForLevel(level: OptimizationLevel): RotationMode {
  if (level === 'deep') return 'deep'
  if (level === 'balanced') return 'balanced'
  return 'orthogonal'
}

/** True when engine should run free-angle placement search. */
export function usesFreeAngleCascade(settings: NestingSettings): boolean {
  return (
    settings.allowRotation !== false &&
    settings.rotationMode === 'free' &&
    !settings.allowedRotationsExplicit?.length &&
    settings.rotationStepDeg == null
  )
}
