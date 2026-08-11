import type { BoundingBox, Point, Shape } from '../geometry/types'
import type { GeometryTolerance } from '../geometry/tolerance'
import { DEFAULT_TOLERANCE } from '../geometry/tolerance'

/** Rectangular sheet in mm (future: non-rect via usable polygon). */
export type Sheet = {
  readonly width: number
  readonly height: number
  /** Inset from each edge (mm). */
  readonly margin: number
}

/** Usable axis-aligned region after margin inset. */
export type UsableRegion = {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/**
 * Immutable placement: shape + rotation + translation applied.
 *
 * Transform order (documented in docs/placement.md):
 *   1. Translate by −centroid (local origin at centroid)
 *   2. Rotate by `rotationDeg` (CCW in SVG axes)
 *   3. Translate so centroid lands at `position`
 *
 * `position` is therefore the **world-space centroid** of the placed shape.
 */
export type Placement = {
  readonly shapeId: string
  readonly position: Point
  readonly rotationDeg: number
  readonly geometry: Shape
  readonly bounds: BoundingBox
}

export type PlacementConfig = {
  /** Minimum clearance between part solids (mm). Not baked into geometry. */
  readonly gap: number
  readonly tolerance?: GeometryTolerance
}

export const DEFAULT_PLACEMENT_CONFIG: PlacementConfig = {
  gap: 0,
  tolerance: DEFAULT_TOLERANCE,
}

export type ValidationReason =
  | 'ok'
  | 'invalid-geometry'
  | 'outside-sheet'
  | 'collision'
  | 'gap-violation'

export type PlacementValidationResult = {
  readonly valid: boolean
  readonly reason: ValidationReason
  /** Optional detail for debugging. */
  readonly detail?: string
}
