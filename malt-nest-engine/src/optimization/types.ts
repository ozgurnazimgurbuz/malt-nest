import type { OrderingStrategy } from '../ordering'
import type { NestResult } from '../nest'
import type { RotationPolicy } from '../rotation'

export type EvaluationMode = 'fast' | 'full'

export type OrderingEval = {
  readonly strategy: OrderingStrategy
  readonly order: readonly string[]
  readonly rotationMode: EvaluationMode
  readonly placed: number
  readonly unplaced: number
  readonly sheets: number
  readonly utilization: number
  readonly waste: number
  readonly packedBoundsMm2: number
  readonly runtimeMs: number
  readonly nfpCount: number
  readonly candidateCount: number
  readonly cacheHits: number
  readonly cacheMisses: number
  readonly nest: NestResult
}

export type RankingRow = {
  readonly strategy: OrderingStrategy
  readonly fastRank: number | null
  readonly fullRank: number | null
}

export type MultiStartDiagnostics = {
  readonly fastTotalRuntimeMs: number
  readonly fullTotalRuntimeMs: number
  readonly totalNfp: number
  readonly totalCandidates: number
  readonly totalCacheHits: number
  readonly totalCacheMisses: number
  readonly ranking: readonly RankingRow[]
  readonly baselinePreserved: boolean
  readonly fullShortlist: readonly OrderingStrategy[]
}

export type MultiStartResult = {
  readonly baseline: OrderingEval
  readonly fastCandidates: readonly OrderingEval[]
  readonly fullCandidates: readonly OrderingEval[]
  readonly best: OrderingEval
  readonly diagnostics: MultiStartDiagnostics
}

export type MultiStartConfig = {
  readonly gap: number
  readonly maxSheets?: number
  /** Override FAST rotation (default orthogonal). */
  readonly fastRotation?: RotationPolicy
  /** Override FULL rotation (default free, baselineFloor false). */
  readonly fullRotation?: RotationPolicy
  /** Strategies for FAST sweep (default BASE_ORDERING_STRATEGIES). */
  readonly strategies?: readonly OrderingStrategy[]
}
