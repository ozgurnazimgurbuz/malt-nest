import type { GeometryPart, Point } from '../../geometry'
import { signedArea } from '../../geometry'
import type { NestingSettings, OptimizationLevel } from '../types'

export type RotationMode = 'orthogonal' | 'balanced' | 'deep'

export const ORTHOGONAL_ANGLES = [0, 90, 180, 270]
export const BALANCED_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]

function normDeg(a: number): number {
  return ((a % 360) + 360) % 360
}

function uniqSorted(angles: number[]): number[] {
  const set = new Set(angles.map((a) => Math.round(normDeg(a) * 1000) / 1000))
  return [...set].sort((a, b) => a - b)
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
    // Also opposite edge alignment
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
    // Prefer upright AABB for elongated parts
    const b = part.boundingBox
    if (b.width > b.height * 1.25 || b.height > b.width * 1.25) {
      out.push(0, 90)
    }
    void signedArea
  }
  // Small perturbations around orthogonal
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
  if (settings.allowArbitraryRotation && settings.rotationMode === 'deep') {
    return adaptiveAnglesFromParts(parts, 28)
  }
  const mode = settings.rotationMode ?? 'orthogonal'
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
