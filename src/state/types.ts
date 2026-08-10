import type { BoundingBox, GeometryPart } from '../geometry'
import type { ParserWarning } from '../svg/warnings'

export type RotationAngle = 0 | 90 | 180 | 270

export type SheetSettings = {
  widthMm: number
  heightMm: number
}

export type UiOptimizationLevel = 'fast' | 'balanced' | 'deep'
export type UiRotationMode = 'orthogonal' | 'balanced' | 'deep'

export type NestSettings = {
  gapMm: number
  marginMm: number
  allowRotation: boolean
  rotationAngles: RotationAngle[]
  optimizationLevel: UiOptimizationLevel
  /** Orthogonal / balanced (45°) / deep adaptive candidates. */
  rotationMode: UiRotationMode
  allowPartInPart: boolean
  /** Developer/debug seed (deterministic). */
  seed: number
  /**
   * Developer: ignore wall-clock truncation; generation/op limits only.
   * Same seed ⇒ same result.
   */
  deterministic: boolean
  /** Prefer left (smaller x) when choosing among equal-validity candidates. */
  dayamaX: boolean
  /** Prefer smaller y when choosing among equal-validity candidates. */
  dayamaY: boolean
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
