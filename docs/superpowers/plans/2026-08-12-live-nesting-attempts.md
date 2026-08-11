# Live Nesting Attempt Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the canonical BLF placement search as a live current-part ghost with a fading attempt trail while the existing debug switch is enabled.

**Architecture:** Add an optional, observation-only attempt callback at the BLF candidate-validation seam. The worker batches compact records and the UI keeps trace state separate from the canonical nesting result, rendering committed placements with the existing preview plus a canvas trail and one SVG ghost.

**Tech Stack:** TypeScript 6, React 19, Web Workers, SVG, Canvas 2D, Vitest/happy-dom, Vite.

---

## File Map

- Modify `src/nesting/types.ts`: public attempt, batch, and canonical-progress marker types.
- Modify `src/nesting/engine.ts`: optional batch callback on engine runs.
- Modify `src/nesting/placement/blf.ts`: observe actual candidate verdicts without changing placement order.
- Modify `src/nesting/optimization/geneticOptimizer.ts`: enable attempts only for the Stage-1 canonical BLF pass.
- Modify `src/nesting/engines/blfEngine.ts`: adapt direct-engine attempts to the public batch callback.
- Modify `src/nesting/engines/evolutionaryEngine.ts`: forward the direct-engine attempt callback.
- Create `src/nesting/worker/attemptBatcher.ts`: pure ordered batching helper.
- Create `src/nesting/worker/attemptBatcher.test.ts`: batching and final-flush tests.
- Modify `src/nesting/worker/nestWorker.ts`: opt-in batching and worker attempt messages.
- Modify `src/nesting/worker/client.ts`: request tracing and forward matching-job batches.
- Modify `src/nesting/worker/client.test.ts`: protocol, stale-job, and opt-in tests.
- Create `src/ui/liveNestTrace.ts`: pure UI trace state transitions and fade-window pruning.
- Create `src/ui/liveNestTrace.test.ts`: ordering, stale-job, and bounded-retention tests.
- Modify `src/App.tsx`: trace lifecycle, partial committed result, and active-sheet following.
- Modify `src/App.test.ts`: debug gating, partial results, stale attempts, sheet following, and cleanup.
- Create `src/rendering/NestAttemptTrail.tsx`: one Canvas 2D fading trail.
- Modify `src/rendering/NestPreview.tsx`: render placement arrays plus the latest attempt ghost.
- Create `src/rendering/NestPreview.test.tsx`: committed layout and ghost rendering tests.
- Modify `src/ui/Workspace.tsx`: select the live preview while debug nesting runs.
- Modify `src/index.css`: canvas, ghost, and verdict styles.
- Modify `src/nesting/index.ts` and `src/ui/index.ts`: export new public/shared types.

### Task 1: Define and emit canonical BLF attempt records

**Files:**
- Modify: `src/nesting/types.ts:135-170`
- Modify: `src/nesting/index.ts:22-45`
- Modify: `src/nesting/placement/blf.ts:48-85,305-395,410-535,623-735`
- Test: `src/nesting/placement/blf.test.ts`

- [ ] **Step 1: Write the failing BLF observation test**

Add a regression near the existing placement-progress tests:

```ts
it('emits ordered candidate verdicts without changing the result', () => {
  const req = request([
    rectPart('a', 0, 0, 0, 6, 6),
    rectPart('b', 1, 0, 0, 6, 6),
  ])
  req.sheets = [{ widthMm: 10, heightMm: 10, marginMm: 0, quantity: 1 }]
  const attempts: NestAttempt[] = []

  const traced = runBottomLeftNest(req, {
    onAttempt: (attempt) => attempts.push(attempt),
  })
  const plain = runBottomLeftNest(req)

  expect(attempts.length).toBeGreaterThan(0)
  expect(attempts.map(({ sequence }) => sequence)).toEqual(
    attempts.map((_, index) => index),
  )
  expect(attempts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        partId: 'a',
        sheetIndex: 0,
        rotation: 0,
        verdict: 'accepted',
      }),
      expect.objectContaining({ verdict: 'rejected' }),
    ]),
  )
  expect(traced.status).toBe('ok')
  expect(plain.status).toBe('ok')
  if (traced.status !== 'ok' || plain.status !== 'ok') return
  expect({ ...traced, calculationTimeMs: 0 }).toEqual({
    ...plain,
    calculationTimeMs: 0,
  })
})

it('isolates telemetry callback failures from placement', () => {
  const req = request([rectPart('a', 0, 0, 0, 6, 6)])
  const plain = runBottomLeftNest(req)
  const traced = runBottomLeftNest(req, {
    onAttempt: () => { throw new Error('telemetry failed') },
    onAttemptFlush: () => { throw new Error('flush failed') },
  })

  expect(traced.status).toBe('ok')
  expect(plain.status).toBe('ok')
  if (traced.status !== 'ok' || plain.status !== 'ok') return
  expect({ ...traced, calculationTimeMs: 0 }).toEqual({
    ...plain,
    calculationTimeMs: 0,
  })
})
```

Use a sheet/part fixture that deterministically produces at least one rejected
candidate before the final result. If the two-square fixture does not, add one
stationary blocker rather than weakening the rejected-verdict assertion.

- [ ] **Step 2: Run the test and verify the missing API failure**

Run:

```bash
npx vitest run src/nesting/placement/blf.test.ts -t "emits ordered candidate verdicts" --reporter=verbose
```

Expected: FAIL because `NestAttempt` and `BlfOptions.onAttempt` do not exist.

- [ ] **Step 3: Add the compact attempt types**

Add to `src/nesting/types.ts`:

```ts
export type NestAttemptVerdict = 'rejected' | 'accepted'

export type NestAttempt = {
  sequence: number
  partId: string
  sheetIndex: number
  x: number
  y: number
  rotation: number
  verdict: NestAttemptVerdict
}

export type NestAttemptBatch = {
  attempts: NestAttempt[]
  jobId?: string
}
```

Export these types from `src/nesting/index.ts`.

- [ ] **Step 4: Instrument only the existing verdict seam**

Add `onAttempt?: (attempt: NestAttempt) => void` and
`onAttemptFlush?: () => void` to `BlfOptions`. In `placeSequence`, create one
sequence counter and wrappers that isolate all telemetry failures:

```ts
let attemptSequence = 0
const emitAttempt = options.onAttempt
  ? (attempt: Omit<NestAttempt, 'sequence'>) => {
      try {
        options.onAttempt?.({ sequence: attemptSequence++, ...attempt })
      } catch {
        // Debug telemetry must never alter nesting.
      }
    }
  : undefined
const flushAttempts = () => {
  try {
    options.onAttemptFlush?.()
  } catch {
    // Debug telemetry must never alter nesting.
  }
}
```

Thread the optional wrapper through `findEntryPlacement`, `pickBestVariant`,
`evaluateAngles`, and `tryPlaceOnSheet`. Immediately after the existing
`isValidPlacement` call, emit exactly one verdict:

```ts
const valid = isValidPlacement(world, sheet, spacingMm)
onAttempt?.({
  partId: variant.partId,
  sheetIndex: sheet.index,
  x: t.x,
  y: t.y,
  rotation: variant.rotation,
  verdict: valid ? 'accepted' : 'rejected',
})
if (valid) {
  accepted = { x: t.x, y: t.y }
  break
}
```

Give `findEntryPlacement` an explicit observer argument with no default value.
Pass `emitAttempt` from the main `tryOn` path, but pass `undefined` from every
`simulateFuturePlaced` call so suffix stock simulations remain silent.

Do not emit a second event from `commit`, and do not modify candidate order or
collision validation. Call `flushAttempts()` after each main-loop part and
before normal/cooperative-cancellation returns so sparse tails are delivered.

- [ ] **Step 5: Run focused BLF tests**

Run:

```bash
npx vitest run src/nesting/placement/blf.test.ts --reporter=dot
```

Expected: PASS, including exact equality between traced and untraced results.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/nesting/types.ts src/nesting/index.ts src/nesting/placement/blf.ts src/nesting/placement/blf.test.ts
git commit -m "feat: expose canonical BLF placement attempts"
```

### Task 2: Restrict evolutionary tracing to the Stage-1 canonical pass

**Files:**
- Modify: `src/nesting/optimization/geneticOptimizer.ts:25-60,155-190`
- Modify: `src/nesting/engines/blfEngine.ts:8-20`
- Modify: `src/nesting/engines/evolutionaryEngine.ts:8-25`
- Modify: `src/nesting/engine.ts:10-19`
- Test: `src/nesting/optimization/optimizer.test.ts`

- [ ] **Step 1: Write the failing scope test**

Add a deterministic test comparing evolutionary telemetry with its direct BLF
baseline:

```ts
it('traces only the Stage-1 canonical BLF pass', () => {
  const request = req([
    rect('a', 0, 30, 20),
    rect('b', 1, 25, 25),
    rect('c', 2, 15, 40),
  ], { deterministic: true, timeLimitMs: 60_000 })
  const baseline: NestAttempt[] = []
  const evolved: NestAttempt[] = []
  const canonicalSnapshots: NestingSuccess[] = []

  runBottomLeftNest(request, { onAttempt: (attempt) => baseline.push(attempt) })
  runEvolutionaryNest(request, {
    deterministic: true,
    maxGenerations: 1,
    onAttempt: (attempt) => evolved.push(attempt),
    onProgress: (progress) => {
      if (progress.attemptPass === 'canonical-blf' && progress.bestSoFar) {
        canonicalSnapshots.push(progress.bestSoFar)
      }
    },
  })

  expect(evolved).toEqual(baseline)
  expect(canonicalSnapshots.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run src/nesting/optimization/optimizer.test.ts -t "traces only the Stage-1" --reporter=verbose
```

Expected: FAIL because `EvolutionaryOptions.onAttempt` is missing.

- [ ] **Step 3: Forward the observer only to the baseline**

Add `attemptPass?: 'canonical-blf'` to `NestProgress`. Add
`onAttempt?: (attempt: NestAttempt) => void` and `onAttemptFlush?: () => void`
to `EvolutionaryOptions`, and pass both only here:

```ts
const baselineRaw = runBottomLeftNest(request, {
  signal: options.signal,
  onAttempt: options.onAttempt,
  onAttemptFlush: options.onAttemptFlush,
  // existing free-angle/progress options remain unchanged
})
```

In the existing baseline progress wrapper, set
`attemptPass: 'canonical-blf'`. Do not set that marker on order-search,
optimization, or finalization events even when they reuse the `seed` phase.

Do not pass it to `placeWithPlanUnchecked`, order trials, local search, repair,
or Stage-2 `placeWithOrderUnchecked` calls.

Add `onAttempts?: (batch: NestAttemptBatch) => void` to
`NestingRunOptions`. For the direct (non-worker) engine adapters, wrap each
attempt in a one-item batch:

```ts
onAttempt: options?.onAttempts
  ? (attempt) => {
      try {
        options.onAttempts?.({ attempts: [attempt], jobId: options.jobId })
      } catch {
        // Observation only.
      }
    }
  : undefined
```

This direct adapter is for tests/non-browser callers; worker batching is added
in Task 3.

- [ ] **Step 4: Run focused engine tests**

Run:

```bash
npx vitest run src/nesting/optimization/optimizer.test.ts src/nesting/placement/blf.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/nesting/engine.ts src/nesting/engines/blfEngine.ts src/nesting/engines/evolutionaryEngine.ts src/nesting/optimization/geneticOptimizer.ts src/nesting/optimization/optimizer.test.ts
git commit -m "feat: scope live attempts to canonical optimization pass"
```

### Task 3: Batch and transport attempt records through the worker

**Files:**
- Create: `src/nesting/worker/attemptBatcher.ts`
- Create: `src/nesting/worker/attemptBatcher.test.ts`
- Modify: `src/nesting/worker/nestWorker.ts:1-40`
- Modify: `src/nesting/worker/client.ts:65-105,125-145`
- Modify: `src/nesting/worker/client.test.ts`

- [ ] **Step 1: Write failing batcher tests**

Create `src/nesting/worker/attemptBatcher.test.ts` with tests for count flush,
order preservation, explicit final flush, and emit-failure isolation. The
disabled path is a worker/client test because no batcher should be created:

```ts
it('preserves order and flushes the final partial batch', () => {
  const batches: NestAttempt[][] = []
  const batcher = createAttemptBatcher(
    (attempts) => batches.push(attempts),
    { maxSize: 2 },
  )
  batcher.push(attempt(0))
  batcher.push(attempt(1))
  batcher.push(attempt(2))
  batcher.flush()

  expect(batches.flat().map(({ sequence }) => sequence)).toEqual([0, 1, 2])
  expect(batches.every((batch) => batch.length <= 2)).toBe(true)
})

it('does not propagate transport failures', () => {
  const batcher = createAttemptBatcher(() => { throw new Error('post failed') })
  expect(() => {
    batcher.push(attempt(0))
    batcher.flush()
  }).not.toThrow()
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run src/nesting/worker/attemptBatcher.test.ts --reporter=verbose
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure batcher**

Create a small helper with a default of 256 records. Partial batches are flushed
explicitly at BLF part/pass boundaries; worker timers cannot run during the
synchronous nesting call:

```ts
export function createAttemptBatcher(
  emit: (attempts: NestAttempt[]) => void,
  options: {
    maxSize?: number
  } = {},
) {
  const maxSize = options.maxSize ?? 256
  let pending: NestAttempt[] = []

  const flush = () => {
    if (pending.length === 0) return
    const batch = pending
    pending = []
    try {
      emit(batch)
    } catch {
      // Debug transport must never alter nesting.
    }
  }

  return {
    push(attempt: NestAttempt) {
      pending.push(attempt)
      if (pending.length >= maxSize) flush()
    },
    flush,
  }
}
```

- [ ] **Step 4: Write failing worker-client protocol tests**

Extend `client.test.ts` to assert:

```ts
it('opts into worker tracing and forwards only matching attempt batches', async () => {
  vi.stubGlobal('Worker', FakeWorker)
  const received: NestAttemptBatch[] = []
  const pending = new WorkerNestingEngine().nest(request, {
    jobId: 'job-1',
    onAttempts: (batch) => received.push(batch),
  })

  expect(FakeWorker.latest?.messages[0]).toMatchObject({ traceAttempts: true })
  FakeWorker.latest?.onmessage?.({
    data: { type: 'attempts', requestId: 'other', attempts: [attempt(0)] },
  } as MessageEvent)
  FakeWorker.latest?.onmessage?.({
    data: { type: 'attempts', requestId: 'job-1', attempts: [attempt(1)] },
  } as MessageEvent)
  FakeWorker.latest?.onmessage?.({
    data: { type: 'completed', requestId: 'job-1', result: fallbackResult },
  } as MessageEvent)

  await pending
  expect(received).toEqual([{ attempts: [attempt(1)], jobId: 'job-1' }])
})
```

Also assert a run without `onAttempts` posts `traceAttempts: false`.
Add a case where `onAttempts` throws, followed by a normal completed worker
message; the nesting promise must still resolve successfully.

- [ ] **Step 5: Implement worker batching and client forwarding**

Change worker messages to:

```ts
export type WorkerInMessage = {
  type: 'nest'
  requestId: string
  request: NestingRequest
  traceAttempts: boolean
}

export type WorkerOutMessage =
  | { type: 'attempts'; requestId: string; attempts: NestAttempt[] }
  // existing variants
```

In `nestWorker.ts`, create the batcher only when requested and pass
`batcher.push` plus `batcher.flush` to `runEvolutionaryNest`. Flush once more
after a normal return and before posting `completed`, and in `catch` before
posting `error`. The attempt callback must not exist when tracing is disabled.
Do not wait on flush during client STOP: STOP deliberately hard-terminates the
worker, so only its not-yet-posted partial batch may be lost.

In `client.ts`, handle matching `attempts` messages before completion:

```ts
if (msg.type === 'attempts') {
  try {
    options?.onAttempts?.({ attempts: msg.attempts, jobId: requestId })
  } catch {
    // UI telemetry is observation-only.
  }
  return
}
```

Include `traceAttempts: options?.onAttempts != null` in the start message.

- [ ] **Step 6: Run worker tests**

Run:

```bash
npx vitest run src/nesting/worker/attemptBatcher.test.ts src/nesting/worker/client.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/nesting/worker/attemptBatcher.ts src/nesting/worker/attemptBatcher.test.ts src/nesting/worker/nestWorker.ts src/nesting/worker/client.ts src/nesting/worker/client.test.ts
git commit -m "feat: batch nesting attempts across worker boundary"
```

### Task 4: Add bounded live-trace UI state and App lifecycle

**Files:**
- Create: `src/ui/liveNestTrace.ts`
- Create: `src/ui/liveNestTrace.test.ts`
- Modify: `src/ui/index.ts`
- Modify: `src/App.tsx:45-110,175-300,350-390`
- Modify: `src/App.test.ts`

- [ ] **Step 1: Write failing pure state tests**

Create tests for start, ordered append, explicit fade pruning, stale job
rejection, partial result update, and clear. Use an 800 ms fade window:

```ts
it('appends matching batches in order and prunes expired trail entries', () => {
  const started = startLiveNestTrace('job-1')
  const first = appendLiveAttempts(
    started,
    { jobId: 'job-1', attempts: [attempt(0), attempt(1)] },
    100,
  )
  const next = appendLiveAttempts(
    first,
    { jobId: 'job-1', attempts: [attempt(2)] },
    950,
  )

  expect(next.trail.map(({ sequence }) => sequence)).toEqual([2])
  expect(next.current?.sequence).toBe(2)
  expect(next.sheetIndex).toBe(attempt(2).sheetIndex)
})

it('expires the trail and current ghost without needing another batch', () => {
  const state = appendLiveAttempts(
    startLiveNestTrace('job-1'),
    { jobId: 'job-1', attempts: [attempt(0)] },
    100,
  )
  const expired = pruneLiveAttempts(state, 901)

  expect(expired.trail).toEqual([])
  expect(expired.current).toBeNull()
})

it('ignores a stale job batch', () => {
  const state = startLiveNestTrace('job-1')
  expect(
    appendLiveAttempts(state, { jobId: 'old', attempts: [attempt(0)] }, 0),
  ).toBe(state)
})
```

- [ ] **Step 2: Run the state tests and verify they fail**

Run:

```bash
npx vitest run src/ui/liveNestTrace.test.ts --reporter=verbose
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal trace state**

Use these shapes and constants:

```ts
export const ATTEMPT_FADE_MS = 800

export type TimedNestAttempt = NestAttempt & { receivedAtMs: number }

export type LiveNestTrace = {
  jobId: string
  trail: TimedNestAttempt[]
  current: TimedNestAttempt | null
  sheetIndex: number
  committed: NestingSuccess | null
}
```

`appendLiveAttempts` must use the functional-state input, reject mismatched job
IDs, preserve batch order, stamp records with the supplied `now`, remove records
older than `ATTEMPT_FADE_MS`, and select the batch's last record as current.
`applyLiveCommitted` must accept only a matching job and replace `committed`.
`pruneLiveAttempts` must remove expired records and clear `current` when its
record has expired.

- [ ] **Step 4: Write failing App lifecycle tests**

Extend the existing mocked App suite with:

1. Debug off: `nestAsync` options have no `onAttempts` callback.
2. Debug on: `onAttempts` exists and Workspace receives a live trace.
3. A matching attempt batch updates `current` and `sheetIndex`.
4. `p.bestSoFar` updates `committed` without replacing `nestResult`.
5. A stale job batch is ignored.
6. completion, STOP result, error, file replacement, and settings change clear
   the trace.

Use the callbacks captured from `mocks.nestAsync.mock.calls[0]![1]`:

```ts
act(() => mocks.settingsProps!.onNestDebug(true))
act(() => mocks.settingsProps!.onAutoNest())
const options = mocks.nestAsync.mock.calls[0]![1]
act(() => options.onAttempts({ jobId: options.jobId, attempts: [attempt(0)] }))
expect(mocks.workspaceProps!.liveTrace.current.sequence).toBe(0)
expect(mocks.workspaceProps!.liveTrace.sheetIndex).toBe(0)
```

- [ ] **Step 5: Integrate trace state in App**

Add `liveTrace` state. At run start, capture `const traceEnabled = nestDebug` and
start a trace only when enabled. Supply `onAttempts` only under that condition.

Inside normal progress handling, retain `p.bestSoFar` only when the explicit
Stage-1 marker is present. Later order-search events also use `seed`, so phase
alone is insufficient:

```ts
if (
  traceEnabled &&
  p.attemptPass === 'canonical-blf' &&
  p.bestSoFar
) {
  setLiveTrace((prev) => applyLiveCommitted(prev, jobId, p.bestSoFar))
}
```

Append batches with `performance.now()`. Do not assign live snapshots to
`nestResultRef`, `bestResultRef`, or export state. Clear the trace in
`invalidateNestingState`, terminal success/cancellation/error paths, and when
the debug switch is turned off.

Add one `useEffect` keyed by the oldest trail timestamp. It schedules a single
timeout for that record's expiry, calls `pruneLiveAttempts`, and cancels the
timeout when the trail/job changes. This guarantees invisible history is
removed even after the Stage-1 attempt stream stops.

Pass `liveTrace` to Workspace. Do not mutate `nestSheetIndex`; the live sheet is
held separately so normal user selection resumes after the run.

- [ ] **Step 6: Run state and App tests**

Run:

```bash
npx vitest run src/ui/liveNestTrace.test.ts src/App.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/ui/liveNestTrace.ts src/ui/liveNestTrace.test.ts src/ui/index.ts src/App.tsx src/App.test.ts
git commit -m "feat: manage live nesting trace lifecycle"
```

### Task 5: Render the live committed layout, ghost, and canvas trail

**Files:**
- Create: `src/rendering/NestAttemptTrail.tsx`
- Modify: `src/rendering/NestPreview.tsx`
- Create: `src/rendering/NestPreview.test.tsx`
- Modify: `src/ui/Workspace.tsx:20-150`
- Modify: `src/index.css:1056-1110`

- [ ] **Step 1: Write the failing NestPreview test**

Use happy-dom, mock Canvas 2D methods, and render one committed placement plus
one rejected current attempt:

```ts
// @vitest-environment happy-dom
it('renders committed placements and the current attempted part separately', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(
    <NestPreview
      sheet={{ widthMm: 100, heightMm: 100 }}
      marginMm={0}
      parts={[partA, partB]}
      placements={[placementA]}
      attempts={[{ ...attemptB, receivedAtMs: performance.now() }]}
      current={{ ...attemptB, receivedAtMs: performance.now() }}
    />,
  ))

  expect(container.querySelectorAll('.nest-preview__outer')).toHaveLength(1)
  expect(container.querySelector('.nest-preview__attempt-ghost')).not.toBeNull()
  expect(container.querySelector('.nest-attempt-trail')).not.toBeNull()
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run src/rendering/NestPreview.test.tsx --reporter=verbose
```

Expected: FAIL because live-attempt props and the trail component do not exist.

- [ ] **Step 3: Implement one Canvas trail**

`NestAttemptTrail` receives `attempts`, sheet dimensions, and fade duration. It
must:

- render one absolutely positioned `<canvas className="nest-attempt-trail">`;
- size its backing buffer from `clientWidth`, `clientHeight`, and
  `devicePixelRatio` using `ResizeObserver`;
- clear and redraw in `requestAnimationFrame` while any point is visible;
- scale candidate `x/y` from sheet coordinates into canvas pixels;
- use red for rejected and green for accepted; and
- compute alpha as `1 - age / ATTEMPT_FADE_MS`.

Cancel RAF and disconnect `ResizeObserver` during cleanup. Treat a missing Canvas
2D context as a no-op so telemetry rendering can never fail nesting.

- [ ] **Step 4: Extend NestPreview without fabricating a result**

Change `NestPreview` to receive `placements: Placement[]` instead of a complete
`NestingSuccess`. Keep the existing committed-part SVG loop unchanged apart from
reading that array.

Add optional `attempts` and `current`. Render `NestAttemptTrail` once. For the
current record, build a normal `Placement`, reuse `applyPlacement`, and draw its
outer/holes in a dedicated overlay SVG above the canvas:

```tsx
const currentPart = current ? partMap.get(current.partId) : undefined
const currentGeometry = currentPart && current
  ? applyPlacement(currentPart, {
      partId: current.partId,
      sheetIndex: current.sheetIndex,
      x: current.x,
      y: current.y,
      rotation: current.rotation,
    })
  : null
```

The ghost outline remains yellow; the corresponding trail anchor carries the
red/green verdict color. Render the ghost only when its sheet matches the
preview sheet. Filter `attempts` by `sheetIndex` before passing them to the
canvas so prior-sheet anchors cannot appear after auto-follow switches sheets.

- [ ] **Step 5: Select live versus final preview in Workspace**

Add `liveTrace?: LiveNestTrace | null`. Define:

```ts
const showLiveNest = calculating && nestDebug && liveTrace != null
const displayedSheet = showLiveNest ? liveTrace.sheetIndex : nestSheetIndex
const placements = showLiveNest
  ? (liveTrace.committed?.placements ?? [])
  : (nestResult?.placements ?? [])
```

Show the sheet frame when either a final nest or live trace exists. Pass the
live trail/current only in live mode. The standard sheet picker remains for a
final multi-sheet result and is hidden while auto-following live attempts.

- [ ] **Step 6: Add minimal styles**

Add:

```css
.nest-attempt-trail {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.nest-preview__attempt-ghost {
  fill: rgba(250, 204, 21, 0.12);
  stroke: #facc15;
  stroke-width: 0.7;
  stroke-dasharray: 3 2;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}
```

Use three explicit layers: the existing board/committed SVG at `z-index: 1`, the
trail canvas at `z-index: 2`, and a pointer-events-none ghost SVG at `z-index: 3`.
Give both SVG layers the same `viewBox` and `preserveAspectRatio` values.

- [ ] **Step 7: Run rendering, App, and progress tests**

Run:

```bash
npx vitest run src/rendering/NestPreview.test.tsx src/App.test.ts src/ui/nestProgress.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/rendering/NestAttemptTrail.tsx src/rendering/NestPreview.tsx src/rendering/NestPreview.test.tsx src/ui/Workspace.tsx src/index.css
git commit -m "feat: render live nesting attempt trail"
```

### Task 6: End-to-end verification and local browser check

**Files:**
- Modify only if a regression exposes a defect in the files above.

- [ ] **Step 1: Run the focused feature matrix**

Run:

```bash
npx vitest run \
  src/nesting/placement/blf.test.ts \
  src/nesting/optimization/optimizer.test.ts \
  src/nesting/worker/attemptBatcher.test.ts \
  src/nesting/worker/client.test.ts \
  src/ui/liveNestTrace.test.ts \
  src/ui/nestProgress.test.ts \
  src/rendering/NestPreview.test.tsx \
  src/App.test.ts \
  --reporter=dot
```

Expected: all focused tests pass.

- [ ] **Step 2: Run static and production checks**

Run:

```bash
npm run lint
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Run the complete root suite**

Run:

```bash
npm test -- --reporter=dot
```

Expected: all non-skipped tests pass; no benchmark documentation changes.

- [ ] **Step 4: Verify invariance and normal-mode overhead**

The focused traced-versus-untraced test already compares the complete semantic
result after normalizing calculation time. Run it with the BLF suite:

```bash
npx vitest run src/nesting/placement/blf.test.ts -t "emits ordered candidate verdicts" --reporter=dot
```

Confirm the debug-off path posts `traceAttempts: false` and allocates no batcher.

- [ ] **Step 5: Exercise the local UI**

With `npm run dev` running:

1. Upload a multi-part SVG.
2. Leave debug off, run nesting, and confirm behavior is unchanged.
3. Enable **Nest / geom debug** and run a new iteration.
4. Confirm the sheet preview appears immediately.
5. Confirm committed blue parts, yellow current ghost, red/green fading anchors,
   and active-sheet following.
6. Press STOP and confirm the transient overlay clears while best-so-far is kept.
7. Change a setting and confirm no stale ghost/trail remains.

- [ ] **Step 6: Commit any verification-only corrections**

If Step 1-5 required code corrections, stage only those exact files and commit:

```bash
git commit -m "fix: harden live nesting attempt lifecycle"
```

If no corrections were required, do not create an empty commit.
