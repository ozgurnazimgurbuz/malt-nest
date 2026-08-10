import type { BoundingBox, GeometryPart } from '../geometry'
import type { ParserWarning } from '../svg/warnings'

export type SheetSettings = {
  widthMm: number
  heightMm: number
}

export type UiOptimizationLevel = 'fast' | 'balanced' | 'deep'

/** User-facing production parameters only (rotation/dayama are engine-owned). */
export type NestSettings = {
  gapMm: number
  marginMm: number
  optimizationLevel: UiOptimizationLevel
  allowPartInPart: boolean
  /** Developer/debug seed (deterministic). */
  seed: number
  /**
   * Developer: ignore wall-clock truncation; generation/op limits only.
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
