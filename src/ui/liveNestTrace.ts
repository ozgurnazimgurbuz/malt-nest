import type {
  NestAttempt,
  NestAttemptBatch,
  NestingSuccess,
} from '../nesting'

export const ATTEMPT_FADE_MS = 800

export type TimedNestAttempt = NestAttempt & { receivedAtMs: number }

export type LiveNestTrace = {
  jobId: string
  trail: TimedNestAttempt[]
  current: TimedNestAttempt | null
  sheetIndex: number
  committed: NestingSuccess | null
}

export function startLiveNestTrace(jobId: string): LiveNestTrace {
  return {
    jobId,
    trail: [],
    current: null,
    sheetIndex: 0,
    committed: null,
  }
}

export function appendLiveAttempts(
  state: LiveNestTrace | null,
  batch: NestAttemptBatch,
  now: number,
): LiveNestTrace | null {
  if (!state || batch.jobId !== state.jobId) return state
  if (batch.attempts.length === 0) return pruneLiveAttempts(state, now)

  const added = batch.attempts.map((attempt) => ({
    ...attempt,
    receivedAtMs: now,
  }))
  const current = added.at(-1)!
  return {
    ...state,
    trail: [...state.trail, ...added].filter(
      (attempt) => now - attempt.receivedAtMs < ATTEMPT_FADE_MS,
    ),
    current,
    sheetIndex: current.sheetIndex,
  }
}

export function applyLiveCommitted(
  state: LiveNestTrace | null,
  jobId: string,
  committed: NestingSuccess,
): LiveNestTrace | null {
  if (!state || state.jobId !== jobId) return state
  return { ...state, committed }
}

export function pruneLiveAttempts(
  state: LiveNestTrace | null,
  now: number,
): LiveNestTrace | null {
  if (!state) return state
  const trail = state.trail.filter(
    (attempt) => now - attempt.receivedAtMs < ATTEMPT_FADE_MS,
  )
  const current =
    state.current && now - state.current.receivedAtMs < ATTEMPT_FADE_MS
      ? state.current
      : null
  if (trail.length === state.trail.length && current === state.current) {
    return state
  }
  return { ...state, trail, current }
}
