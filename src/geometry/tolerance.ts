/**
 * Central numeric tolerance for geometry (millimeters).
 * Do not scatter ad-hoc epsilons — use geomEps() / configureGeometryTolerance().
 */

let epsMm = 1e-7

export type GeometryTolerance = {
  /** Absolute length epsilon in mm */
  epsilonMm: number
}

export function configureGeometryTolerance(next: Partial<GeometryTolerance>): void {
  if (next.epsilonMm != null && Number.isFinite(next.epsilonMm) && next.epsilonMm > 0) {
    epsMm = next.epsilonMm
  }
}

export function geomEps(): number {
  return epsMm
}

/** ClipperD precision required to preserve the configured length epsilon. */
export function clipperPrecision(): number {
  return Math.max(-8, Math.min(8, Math.ceil(-Math.log10(epsMm))))
}

export function nearlyZero(v: number, tol = epsMm): boolean {
  return Math.abs(v) <= tol
}

export function nearlyEqualNum(a: number, b: number, tol = epsMm): boolean {
  return Math.abs(a - b) <= tol
}

export type GeometryIssue = {
  code:
    | 'empty'
    | 'degenerate'
    | 'nan'
    | 'self_intersect_suspected'
    | 'offset_failed'
    | 'nfp_failed'
  message: string
}

export class GeometryError extends Error {
  readonly issues: GeometryIssue[]
  constructor(message: string, issues: GeometryIssue[] = []) {
    super(message)
    this.name = 'GeometryError'
    this.issues = issues
  }
}
