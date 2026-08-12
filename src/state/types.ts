import type { BoundingBox, GeometryPart } from '../geometry'
import type { ParserWarning } from '../svg/warnings'

export type SheetSettings = {
  widthMm: number
  heightMm: number
}

/** User-facing production parameters only (rotation/dayama are engine-owned). */
export type NestSettings = {
  gapMm: number
  marginMm: number
  allowPartInPart: boolean
  /** Developer/debug seed (deterministic). */
  seed: number
  /**
   * Developer: use evaluation-count convergence only.
   * Same seed ⇒ same result.
   */
  deterministic: boolean
}

export type SvgMeta = {
  fileName: string
  raw: string
  /** Document width in millimeters when resolvable. */
  width: number | null
  /** Document height in millimeters when resolvable. */
  height: number | null
  /** Real parsed GeometryPart count (Stage 2). */
  partCount: number
  parts: GeometryPart[]
  warnings: ParserWarning[]
  bounds: BoundingBox | null
  totalArea: number
}

export type AppStatus =
  | { kind: 'idle' }
  | { kind: 'info'; message: string }
  | { kind: 'error'; message: string }
