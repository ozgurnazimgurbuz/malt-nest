/**
 * Multi-term scoring model.
 * Conceptual:
 *   score = sheetPenalty + wastePenalty + compactnessPenalty + cutPenalty + unplacedPenalty
 * Lower score is better.
 */

export {
  combineScore,
  DEFAULT_SCORE_WEIGHTS,
  type ScoreBreakdown,
  type ScoreWeights,
} from './weights'
export { isBetterScore, scoreNestingResult } from './fitness'
