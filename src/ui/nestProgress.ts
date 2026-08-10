import type { NestingSuccess, NestProgress, OptimizationLevel } from '../nesting'
import { isBetterScore, scoreNestingResult } from '../nesting'

/** UI-facing nest progress phase (observability only). */
export type NestUiPhase =
  | 'preparing'
  | 'blf'
  | 'optimize'
  | 'completed'
  | 'stopping'
  | 'cancelled'
  | 'error'

export type NestUiProgress = {
  visible: boolean
  jobId: string | null
  phase: NestUiPhase
  /** Headline under NESTING / OPTIMIZE label. */
  title: string
  /** 0–100 from engine `ratio` (never invented). */
  percent: number
  /** Secondary lines: parts / sheet / start / gen. */
  detail: string
  /** Tertiary status from engine message or phase hint. */
  statusLine?: string
  optimizationLevel?: OptimizationLevel | string
  /** Soft pulse while waiting on cancel (keeps last %). */
  awaitingStop: boolean
  /** Wall-clock job start (UI); elapsed derived from this + engine elapsedMs. */
  startedAtMs?: number
  /** Last known elapsed from engine progress (ms). */
  elapsedMs?: number
  /** 1-based iteration index for this job (Stage 10F). */
  iteration?: number
  /** True when this completed result is the best so far. */
  isBest?: boolean
  /** Final summary fields (completed / cancelled-with-result). */
  summary?: {
    placedCount: number
    partCount: number
    unplacedCount: number
    sheetCount: number
    utilization: number
    elapsedMs: number
    note?: string
  }
  errorMessage?: string
}

export function percentFromRatio(ratio: number | undefined): number {
  if (ratio == null || !Number.isFinite(ratio)) return 0
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100)
}

function levelLabel(level?: string): string {
  if (!level) return ''
  if (level === 'fast') return 'Fast'
  if (level === 'balanced') return 'Balanced'
  if (level === 'deep') return 'Deep'
  return level
}

/** Existing fitness only — no new scoring. */
export function isBetterNestResult(
  candidate: NestingSuccess,
  currentBest: NestingSuccess,
): boolean {
  return isBetterScore(
    scoreNestingResult(candidate),
    scoreNestingResult(currentBest),
  )
}

function partsLine(p: NestProgress): string | null {
  if (p.placedCount != null && p.partCount != null) {
    return `Parça ${p.placedCount} / ${p.partCount}`
  }
  if (p.partCount != null) return `Parça 0 / ${p.partCount}`
  return null
}

function sheetLine(p: NestProgress): string | null {
  if (p.sheetCount != null && p.sheetCount > 0) {
    return `Tabaka ${p.sheetCount}`
  }
  return null
}

export function nestUiFromEngineProgress(
  p: NestProgress,
  activeJobId: string | null,
  prev?: NestUiProgress | null,
): NestUiProgress | null {
  if (activeJobId != null && p.jobId != null && p.jobId !== activeJobId) {
    return null
  }

  const percent = percentFromRatio(p.ratio)
  const level = p.optimizationLevel
  const parts = partsLine(p)
  const sheet = sheetLine(p)
  const startedAtMs = prev?.startedAtMs
  const elapsedMs = p.elapsedMs ?? prev?.elapsedMs
  const iteration = prev?.iteration

  if (p.phase === 'prepare') {
    return {
      visible: true,
      jobId: p.jobId ?? activeJobId,
      phase: 'preparing',
      title: 'Nesting hazırlanıyor',
      percent,
      detail: parts ?? '…',
      statusLine: p.message ?? 'Hazırlanıyor…',
      optimizationLevel: level,
      awaitingStop: false,
      startedAtMs,
      elapsedMs,
      iteration,
    }
  }

  if (p.phase === 'seed') {
    return {
      visible: true,
      jobId: p.jobId ?? activeJobId,
      phase: 'blf',
      title: 'BLF yerleşimi',
      percent,
      detail: [parts, sheet].filter(Boolean).join('\n') || '…',
      statusLine: p.message ?? 'Yerleşim aranıyor…',
      optimizationLevel: level,
      awaitingStop: false,
      startedAtMs,
      elapsedMs,
      iteration,
    }
  }

  if (p.phase === 'optimize') {
    const start =
      p.multiStartIndex != null && p.multiStartCount != null
        ? `Start ${p.multiStartIndex} / ${p.multiStartCount}`
        : null
    const gen =
      p.generation != null
        ? p.multiStartCount != null
          ? `Generation ${p.generation}`
          : `Generation ${p.generation}`
        : null
    const lvl = levelLabel(level)
    return {
      visible: true,
      jobId: p.jobId ?? activeJobId,
      phase: 'optimize',
      title: lvl ? `${lvl} optimization` : 'Optimize',
      percent,
      detail: [start, gen, parts, sheet].filter(Boolean).join('\n') || '…',
      statusLine: p.message ?? 'Aday pozisyonlar değerlendiriliyor…',
      optimizationLevel: level,
      awaitingStop: false,
      startedAtMs,
      elapsedMs,
      iteration,
    }
  }

  return {
    visible: true,
    jobId: p.jobId ?? activeJobId,
    phase: 'completed',
    title: 'Nest tamamlandı',
    percent: percentFromRatio(p.ratio ?? 1),
    detail: parts ?? '…',
    statusLine: p.message,
    optimizationLevel: level,
    awaitingStop: false,
    startedAtMs,
    elapsedMs,
    iteration,
  }
}

export function nestUiPreparing(
  jobId: string,
  partCount: number,
  level: OptimizationLevel | string,
  iteration?: number,
): NestUiProgress {
  return {
    visible: true,
    jobId,
    phase: 'preparing',
    title: 'Nesting hazırlanıyor',
    percent: 0,
    detail: `Parça 0 / ${partCount}`,
    statusLine: 'Hazırlanıyor…',
    optimizationLevel: level,
    awaitingStop: false,
    startedAtMs: performance.now(),
    elapsedMs: 0,
    iteration,
  }
}

export function nestUiStopping(prev: NestUiProgress | null): NestUiProgress {
  return {
    visible: true,
    jobId: prev?.jobId ?? null,
    phase: 'stopping',
    title: 'Durduruluyor…',
    percent: prev?.percent ?? 0,
    detail: prev?.detail ?? 'En iyi sonuç bekleniyor',
    statusLine: 'Mevcut en iyi sonuç uygulanıyor…',
    optimizationLevel: prev?.optimizationLevel,
    awaitingStop: true,
    startedAtMs: prev?.startedAtMs,
    elapsedMs: prev?.elapsedMs,
    iteration: prev?.iteration,
  }
}

export function nestUiCompleted(
  jobId: string | null,
  result: NestingSuccess,
  opts?: { note?: string; iteration?: number; isBest?: boolean },
): NestUiProgress {
  const { placedCount, partCount, unplacedCount, sheetCountUsed } =
    result.statistics
  const unplaced =
    unplacedCount > 0 ? ` · ${unplacedCount} yerleşmedi` : ''
  return {
    visible: true,
    jobId,
    phase: 'completed',
    title: '✓ Nest tamamlandı',
    percent: 100,
    detail: `${placedCount} / ${partCount} parça yerleşti${unplaced}`,
    awaitingStop: false,
    iteration: opts?.iteration,
    isBest: opts?.isBest,
    summary: {
      placedCount,
      partCount,
      unplacedCount,
      sheetCount: sheetCountUsed,
      utilization: result.utilization,
      elapsedMs: result.calculationTimeMs,
      note: opts?.note,
    },
  }
}

export function nestUiCancelledBest(
  jobId: string | null,
  result: NestingSuccess,
  opts?: { iteration?: number; isBest?: boolean },
): NestUiProgress {
  const base = nestUiCompleted(jobId, result, {
    note: 'Mevcut en iyi sonuç uygulandı',
    iteration: opts?.iteration,
    isBest: opts?.isBest,
  })
  return {
    ...base,
    phase: 'cancelled',
    title: 'Mevcut en iyi sonuç uygulandı',
  }
}

export function nestUiCancelledPlain(
  jobId: string | null,
  message: string,
  prev: NestUiProgress | null,
): NestUiProgress {
  return {
    visible: true,
    jobId,
    phase: 'cancelled',
    title: message,
    percent: prev?.percent ?? 0,
    detail: prev?.detail ?? '',
    statusLine: prev?.statusLine,
    optimizationLevel: prev?.optimizationLevel,
    awaitingStop: false,
    startedAtMs: prev?.startedAtMs,
    elapsedMs: prev?.elapsedMs,
    iteration: prev?.iteration,
  }
}

export function nestUiError(
  jobId: string | null,
  message: string,
): NestUiProgress {
  return {
    visible: true,
    jobId,
    phase: 'error',
    title: 'Nesting hatası',
    percent: 0,
    detail: message,
    awaitingStop: false,
    errorMessage: message,
  }
}

/** Apply engine progress only when jobId matches (stale guard). */
export function applyEngineProgress(
  prev: NestUiProgress | null,
  p: NestProgress,
  activeJobId: string | null,
): NestUiProgress | null {
  if (activeJobId != null && p.jobId != null && p.jobId !== activeJobId) {
    return prev
  }
  if (prev?.phase === 'stopping' && activeJobId === prev.jobId) {
    const next = nestUiFromEngineProgress(p, activeJobId, prev)
    if (!next) return prev
    return {
      ...next,
      phase: 'stopping',
      title: 'Durduruluyor…',
      statusLine: 'Mevcut en iyi sonuç uygulanıyor…',
      awaitingStop: true,
    }
  }
  return nestUiFromEngineProgress(p, activeJobId, prev) ?? prev
}
