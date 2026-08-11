/**
 * Central numerical tolerance for Geometry Core.
 * Never hard-code epsilons elsewhere — pass or import DEFAULT_TOLERANCE.
 */
export type GeometryTolerance = {
  /** Absolute length / coordinate equality (mm). */
  abs: number
  /** Relative scale for near-equal comparisons: abs + rel * max(|a|,|b|). */
  rel: number
  /** Squared-length threshold for degenerate edges (mm²). */
  edgeMinLen2: number
  /** Curve → polyline flattening chord tolerance (mm). */
  curveTolerance: number
  /**
   * Clipper2 integer scale: world_mm * clipperScale → int64.
   * Higher = more precision, more overflow risk on large sheets.
   */
  clipperScale: number
}

export const DEFAULT_TOLERANCE: GeometryTolerance = {
  abs: 1e-9,
  rel: 1e-12,
  edgeMinLen2: 1e-24,
  curveTolerance: 0.25,
  clipperScale: 1000,
}

export function nearlyEqual(
  a: number,
  b: number,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  const d = Math.abs(a - b)
  if (d <= tol.abs) return true
  return d <= tol.rel * Math.max(Math.abs(a), Math.abs(b), 1)
}

export function nearlyZero(
  a: number,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  return nearlyEqual(a, 0, tol)
}
