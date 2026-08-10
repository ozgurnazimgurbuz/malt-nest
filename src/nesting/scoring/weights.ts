export type ScoreWeights = {
  sheet: number
  waste: number
  compactness: number
  cut: number
  unplaced: number
}

export type ScoreBreakdown = {
  sheetPenalty: number
  wastePenalty: number
  compactnessPenalty: number
  cutPenalty: number
  unplacedPenalty: number
  total: number
}

/** Default weights — material first, compactness last. Documented for Stage 9. */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  /** Prefer fewer sheets (very strong). */
  sheet: 1_000_000,
  /** Prefer less unused area on used sheets. */
  waste: 1.5,
  /** Prefer tighter used bounding box — must not overpower waste/sheets. */
  compactness: 0.15,
  cut: 0,
  /** Hard fail: unplaced parts dominate. */
  unplaced: 10_000_000,
}

export function combineScore(
  parts: Omit<ScoreBreakdown, 'total'>,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): ScoreBreakdown {
  const total =
    weights.sheet * parts.sheetPenalty +
    weights.waste * parts.wastePenalty +
    weights.compactness * parts.compactnessPenalty +
    weights.cut * parts.cutPenalty +
    weights.unplaced * parts.unplacedPenalty
  return { ...parts, total }
}
