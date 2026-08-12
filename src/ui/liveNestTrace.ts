import type {
  NestAttempt,
  NestAttemptBatch,
  NestingSuccess,
  Placement,
} from '../nesting'

export const ATTEMPT_FADE_MS = 800

export type LiveNestPlaybackSink = {
  renderAttempt(attempt: NestAttempt, displayedAtMs: number): boolean
  renderCommit(
    placements: Placement[],
    sheetIndex: number | undefined,
    displayedAtMs: number,
  ): boolean
  renderIdle(displayedAtMs: number): boolean
  clear(): void
}

export type LiveNestPlayback = {
  enqueueAttempts(batch: NestAttemptBatch): void
  enqueueCommit(jobId: string, snapshot: NestingSuccess): void
  attach(sink: LiveNestPlaybackSink): () => void
  seal(): Promise<void>
  cancel(): void
}

export type LiveNestPlaybackCallbacks = {
  onSheetIndex(sheetIndex: number): void
  onCommit(placements: Placement[], sheetIndex: number | undefined): void
}

export type LiveNestTrace = {
  jobId: string
  sheetIndex: number
  placements: Placement[]
  playback: LiveNestPlayback
}

type QueueItem =
  | { kind: 'attempts'; attempts: NestAttempt[]; index: number }
  | { kind: 'commit'; placements: Placement[] }

type StreamEvent =
  | { kind: 'attempt'; attempt: NestAttempt }
  | { kind: 'commit'; placements: Placement[] }

export function createLiveNestPlayback(
  jobId: string,
  callbacks: LiveNestPlaybackCallbacks,
): LiveNestPlayback {
  let queue: Array<QueueItem | undefined> = []
  let head = 0
  let sink: LiveNestPlaybackSink | null = null
  let frame: number | null = null
  let displayedSheet = 0
  let needsPaint = false
  let everQueued = false
  let sealed = false
  let cancelled = false
  let settled = false
  const committedPartIds = new Set<string>()
  let resolveDrain: () => void
  const drain = new Promise<void>((resolve) => {
    resolveDrain = resolve
  })

  const settle = () => {
    if (settled) return
    settled = true
    resolveDrain()
  }

  const hasQueuedEvents = () => head < queue.length

  const releaseConsumedQueue = () => {
    if (head !== queue.length) return
    queue = []
    head = 0
  }

  const takeNextEvent = (): StreamEvent | undefined => {
    const item = queue[head]
    if (!item) return undefined

    if (item.kind === 'commit') {
      queue[head] = undefined
      head += 1
      releaseConsumedQueue()
      return item
    }

    const attempt = item.attempts[item.index]
    item.index += 1
    if (item.index === item.attempts.length) {
      queue[head] = undefined
      head += 1
      releaseConsumedQueue()
    }
    return { kind: 'attempt', attempt }
  }

  const schedule = () => {
    if (!sink || cancelled || frame !== null) return
    frame = requestAnimationFrame(step)
  }

  const cancel = () => {
    if (cancelled) return
    cancelled = true
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    queue = []
    head = 0
    committedPartIds.clear()
    const currentSink = sink
    sink = null
    try {
      currentSink?.clear()
    } catch {
      // Observation failures must not affect nesting.
    }
    settle()
  }

  function step(now: number) {
    frame = null
    if (!sink || cancelled) return

    needsPaint = false
    const event = takeNextEvent()
    let trailVisible = false

    try {
      if (event?.kind === 'attempt') {
        if (event.attempt.sheetIndex !== displayedSheet) {
          displayedSheet = event.attempt.sheetIndex
          callbacks.onSheetIndex(displayedSheet)
        }
        trailVisible = sink.renderAttempt(event.attempt, now)
        needsPaint = true
      } else if (event?.kind === 'commit') {
        const sheetIndex = event.placements.at(-1)?.sheetIndex
        trailVisible = sink.renderCommit(event.placements, sheetIndex, now)
        callbacks.onCommit(event.placements, sheetIndex)
        if (sheetIndex !== undefined) displayedSheet = sheetIndex
        needsPaint = true
      } else {
        trailVisible = sink.renderIdle(now)
      }
    } catch {
      cancel()
      return
    }

    if (sealed && !hasQueuedEvents() && !needsPaint) settle()
    else if (hasQueuedEvents() || needsPaint || trailVisible) schedule()
  }

  return {
    enqueueAttempts(batch) {
      if (sealed || cancelled || batch.jobId !== jobId || batch.attempts.length === 0) {
        return
      }
      queue.push({ kind: 'attempts', attempts: batch.attempts, index: 0 })
      everQueued = true
      schedule()
    },
    enqueueCommit(commitJobId, snapshot) {
      if (sealed || cancelled || commitJobId !== jobId) return
      const placements: Placement[] = []
      for (const placement of snapshot.placements) {
        if (committedPartIds.has(placement.partId)) continue
        committedPartIds.add(placement.partId)
        placements.push(placement)
      }
      queue.push({ kind: 'commit', placements })
      everQueued = true
      schedule()
    },
    attach(nextSink) {
      if (cancelled) return () => undefined
      sink = nextSink
      if (hasQueuedEvents() || needsPaint || (sealed && !settled)) schedule()
      return () => {
        if (sink !== nextSink) return
        if (frame !== null) cancelAnimationFrame(frame)
        frame = null
        sink = null
      }
    },
    seal() {
      if (sealed || cancelled) return drain
      sealed = true
      if (!everQueued) settle()
      else schedule()
      return drain
    },
    cancel,
  }
}

export function startLiveNestTrace(
  jobId: string,
  playback: LiveNestPlayback,
): LiveNestTrace {
  return { jobId, sheetIndex: 0, placements: [], playback }
}

export function applyLiveSheet(
  state: LiveNestTrace | null,
  jobId: string,
  sheetIndex: number,
): LiveNestTrace | null {
  if (!state || state.jobId !== jobId || state.sheetIndex === sheetIndex) {
    return state
  }
  return { ...state, sheetIndex }
}

export function applyLiveCommit(
  state: LiveNestTrace | null,
  jobId: string,
  placements: Placement[],
  sheetIndex?: number,
): LiveNestTrace | null {
  if (!state || state.jobId !== jobId) return state
  if (placements.length === 0 && sheetIndex === undefined) return state
  return {
    ...state,
    placements: [...state.placements, ...placements],
    sheetIndex: sheetIndex ?? state.sheetIndex,
  }
}
