export const DEFAULT_NESTING_TIME_LIMIT_MS = 5_000

export type DeadlineClock = () => number

/** Small cooperative wall-clock budget shared by optimizer and placement. */
export class NestingDeadline {
  readonly deadlineAtMs: number
  private readonly now: DeadlineClock
  private readonly signal?: AbortSignal

  constructor(
    budgetMs = DEFAULT_NESTING_TIME_LIMIT_MS,
    now: DeadlineClock = () => performance.now(),
    signal?: AbortSignal,
  ) {
    this.now = now
    this.signal = signal
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
      throw new RangeError('Nesting time limit must be positive and finite')
    }
    const startedAtMs = now()
    if (!Number.isFinite(startedAtMs)) {
      throw new RangeError('Deadline start time must be finite')
    }
    this.deadlineAtMs = startedAtMs + budgetMs
  }

  expired(): boolean {
    return this.signal?.aborted === true || this.now() >= this.deadlineAtMs
  }

  remainingMs(): number {
    return Math.max(0, this.deadlineAtMs - this.now())
  }
}
