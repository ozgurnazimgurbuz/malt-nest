import type { BoundingBox, Point, Shape } from '../geometry/types'
import type { GeometryTolerance } from '../geometry/tolerance'
import type { Placement, Sheet } from '../placement/types'
import type { OrderingStrategy } from '../ordering'
import type { RotationPolicy } from '../rotation'

export type UnplacedReason =
  | 'too-large'
  | 'no-valid-placement'
  | 'invalid-geometry'

export type UnplacedPart = {
  readonly shapeId: string
  readonly reason: UnplacedReason
  readonly detail?: string
}

/** Placement tagged with sheet index (0-based). */
export type NestPlacement = Placement & {
  readonly sheetIndex: number
}

export type NestSheetResult = {
  readonly sheet: Sheet
  readonly sheetIndex: number
  readonly placements: readonly NestPlacement[]
}

export type NestMetrics = {
  readonly sheetCount: number
  readonly placedCount: number
  readonly unplacedCount: number
  /** Sum of placed part areas (mm²). */
  readonly usedPartArea: number
  /** sheetCount × sheet.width × sheet.height (mm²). */
  readonly sheetArea: number
  /** usedPartArea / sheetArea (0 if sheetArea=0). */
  readonly utilization: number
  /** 1 − utilization. */
  readonly waste: number
  /**
   * Sum of per-sheet used AABB areas (mm²). A metric only — not a quality score.
   */
  readonly packedBoundsMm2: number
  /** Union AABB of all placements per sheet (for debug). */
  readonly sheetPackedBounds: readonly (BoundingBox | null)[]
}

export type NestDiagnostics = {
  readonly nfpComputeCount: number
  readonly validationCount: number
  readonly candidateCount: number
  readonly rejectedCandidates: number
  readonly anglesEvaluated?: number
  readonly cacheHits?: number
  readonly cacheMisses?: number
  readonly baselineFloorApplied?: boolean
  readonly baselineFloorKept?: 'free' | 'orthogonal'
  readonly freeAngleAttempt?: {
    placed: number
    sheets: number
    packedBoundsMm2: number
    runtimeMs: number
  }
  readonly orthogonalAttempt?: {
    placed: number
    sheets: number
    packedBoundsMm2: number
    runtimeMs: number
  }
  /** Per-part summaries when debug=true. */
  readonly parts?: readonly NestPartDiag[]
}

export type NestPartDiag = {
  readonly shapeId: string
  readonly sheetIndex: number | null
  readonly rotationDeg: number | null
  readonly position: Point | null
  readonly candidateCount: number
  readonly rejectedCandidates: number
  readonly rejectionReasons: Readonly<Record<string, number>>
}

export type NestConfig = {
  readonly gap: number
  readonly ordering?: OrderingStrategy
  readonly rotation?: RotationPolicy
  /** Cap on sheets created (default: parts.length). */
  readonly maxSheets?: number
  readonly debug?: boolean
  readonly tolerance?: GeometryTolerance
}

export type NestResult = {
  readonly sheets: readonly NestSheetResult[]
  readonly placements: readonly NestPlacement[]
  readonly unplaced: readonly UnplacedPart[]
  readonly metrics: NestMetrics
  readonly runtimeMs: number
  readonly diagnostics: NestDiagnostics
  readonly config: {
    readonly gap: number
    readonly ordering: OrderingStrategy
    readonly rotation: RotationPolicy
  }
}

export type NestInput = {
  readonly parts: readonly Shape[]
  readonly sheet: Sheet
  readonly config: NestConfig
}
