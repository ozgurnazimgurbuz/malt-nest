import type { GeometryPart } from '../geometry'
import type { NestSettings as UiNestSettings, SheetSettings as UiSheetSettings } from '../state'

/** @deprecated Prefer NestingRequest — kept for façade compatibility. */
export type NestInput = {
  parts: GeometryPart[]
  sheet: UiSheetSettings
  settings: UiNestSettings
}

export type SheetDefinition = {
  widthMm: number
  heightMm: number
  marginMm: number
  /** How many identical sheets are available (multi-sheet). */
  quantity: number
  /** Optional remnant / offcut identifier (roadmap). */
  remnantId?: string | null
}

export type RotationMode = 'orthogonal' | 'balanced' | 'deep' | 'free'

/**
 * Engine-facing settings. UI NestSettings maps into this in the façade.
 * Future fields (grain, kerf, priority) stay optional until implemented.
 */
export type NestingSettings = {
  spacingMm: number
  /** Explicit allowed angles in degrees (e.g. 0/90/180/270). */
  allowedRotations: number[]
  /**
   * When set, overrides rotationMode / allowedRotations for the engine.
   * Used by tests / developer settings.
   */
  allowedRotationsExplicit?: number[] | null
  /** When set, generate angles 0..360 by this step. */
  rotationStepDeg?: number | null
  allowArbitraryRotation: boolean
  /** Rotation candidate strategy (orthogonal / balanced / deep adaptive). */
  rotationMode?: RotationMode
  /** UI mirror: whether rotation is enabled at all. */
  allowRotation?: boolean
  /** Seed for search RNG (reproducible runs). */
  seed?: number
  /** When true, stop by evaluation-count convergence only. */
  deterministic?: boolean
  /** Future: kerf compensation (mm). */
  kerfMm?: number
  /**
   * Allow placing a part inside another part's hole (part-in-part).
   * Default false.
   */
  allowPartInPart?: boolean
  /**
   * Stage 10B: BLF profiler (console). Off by default — zero cost when false.
   */
  profileBlf?: boolean
  /**
   * Prefer vertical sheet edges (smaller x). Internal BLF pack bias; not a UI toggle.
   * Sort/tie-break only — does not change NFP/collision geometry.
   */
  dayamaX?: boolean
  /**
   * Prefer horizontal sheet edges (smaller y). Internal BLF pack bias; not a UI toggle.
   * Sort/tie-break only — does not change NFP/collision geometry.
   */
  dayamaY?: boolean
}

export type NestingRequest = {
  parts: GeometryPart[]
  sheets: SheetDefinition[]
  settings: NestingSettings
}

export type Placement = {
  partId: string
  sheetIndex: number
  x: number
  y: number
  /** Degrees, counter-clockwise. */
  rotation: number
}

export type NestAttemptVerdict = 'rejected' | 'accepted'

export type NestAttempt = Placement & {
  sequence: number
  verdict: NestAttemptVerdict
}

export type NestAttemptBatch = {
  attempts: NestAttempt[]
  jobId?: string
}

/** @deprecated Use Placement. */
export type NestPlacement = Placement

export type SheetResult = {
  sheetIndex: number
  widthMm: number
  heightMm: number
  placedCount: number
  utilization: number
  wasteMm2: number
  usedBounds: {
    minX: number
    minY: number
    maxX: number
    maxY: number
  } | null
}

export type NestingStatistics = {
  partCount: number
  placedCount: number
  unplacedCount: number
  sheetCountUsed: number
  totalPartAreaMm2: number
  totalSheetAreaMm2: number
  overallUtilization: number
  overallWasteMm2: number
}

export type NestingSuccess = {
  status: 'ok'
  placements: Placement[]
  sheets: SheetResult[]
  unplacedPartIds: string[]
  utilization: number
  wasteMm2: number
  calculationTimeMs: number
  statistics: NestingStatistics
  engineId: string
}

export type NestingNotImplemented = {
  status: 'not_implemented'
  message: string
}

export type NestingCancelled = {
  status: 'cancelled'
  message: string
  bestSoFar?: NestingSuccess | null
}

export type NestingResult = NestingSuccess | NestingNotImplemented | NestingCancelled

export type NestProgressPhase =
  | 'prepare'
  | 'seed'
  | 'optimize'
  | 'finalize'

export type NestProgress = {
  /** 0..1 — real engine progress (do not invent in UI). */
  ratio: number
  phase: NestProgressPhase
  activity?: 'initial' | 'orders' | 'beam' | 'refine' | 'repair' | 'verify'
  bestScore?: number
  bestUtilization?: number
  sheetCount?: number
  elapsedMs?: number
  message?: string
  /** Parts placed so far / total in current phase. */
  placedCount?: number
  partCount?: number
  unplacedCount?: number
  /** Latest valid best (for STOP / hard-terminate fallback). */
  bestSoFar?: NestingSuccess
  /** Identifies progress snapshots from the traced canonical placement pass. */
  attemptPass?: 'canonical-blf'
  jobId?: string
}
