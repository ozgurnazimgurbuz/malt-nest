export type ConvergenceState = {
  deterministic: boolean
  startedAtMs: number
  firstChampionMs: number | null
  lastImprovementMs: number | null
  evaluations: number
  evaluationsSinceImprovement: number
  evaluationLimit: number
  requiredOrdersComplete: boolean
}

export function createConvergenceState({
  partCount,
  deterministic,
  startedAtMs,
}: {
  partCount: number
  deterministic: boolean
  startedAtMs: number
}): ConvergenceState {
  if (!Number.isSafeInteger(partCount) || partCount < 0) {
    throw new RangeError('Part count must be a nonnegative safe integer')
  }

  return {
    deterministic,
    startedAtMs,
    firstChampionMs: null,
    lastImprovementMs: null,
    evaluations: 0,
    evaluationsSinceImprovement: 0,
    evaluationLimit: Math.max(64, partCount * 4),
    requiredOrdersComplete: false,
  }
}

export function recordFirstChampion(state: ConvergenceState, nowMs: number): void {
  if (state.firstChampionMs !== null) return
  state.firstChampionMs = nowMs
  state.lastImprovementMs = nowMs
}

export function recordEvaluation(state: ConvergenceState): void {
  state.evaluations++
  state.evaluationsSinceImprovement++
}

export function recordChampion(state: ConvergenceState, nowMs: number): void {
  state.lastImprovementMs = nowMs
  state.evaluationsSinceImprovement = 0
}

export function markRequiredOrdersComplete(state: ConvergenceState): void {
  state.requiredOrdersComplete = true
  state.evaluationsSinceImprovement = 0
}

export function shouldStop(
  state: ConvergenceState,
  nowMs: number,
  aborted: boolean,
): boolean {
  if (aborted) return true

  if (state.deterministic) {
    return (
      state.requiredOrdersComplete &&
      state.evaluationsSinceImprovement >= state.evaluationLimit
    )
  }

  if (nowMs - state.startedAtMs >= 5_000) return true

  if (
    state.firstChampionMs !== null &&
    state.lastImprovementMs !== null &&
    nowMs - state.lastImprovementMs >=
      Math.max(100, 2 * (state.firstChampionMs - state.startedAtMs))
  ) {
    return true
  }

  return (
    state.requiredOrdersComplete &&
    state.evaluationsSinceImprovement >= state.evaluationLimit
  )
}
