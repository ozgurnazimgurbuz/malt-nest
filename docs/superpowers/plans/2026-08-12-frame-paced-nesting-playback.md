# Frame-Paced Nesting Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display every canonical nesting attempt on its own browser frame while keeping worker computation and worker transport fully batched.

**Architecture:** Replace batch-to-React trace updates with one job-scoped imperative playback controller. The controller keeps ordered batch offsets, compact commit deltas, paint-safe draining, and cancellation; the existing canvas overlay attaches as its sink and draws both the current part and fading trail without per-attempt React renders. React state changes only when the displayed sheet changes, a placement commits, or the job lifecycle changes.

**Tech Stack:** TypeScript 6, React 19, Web Workers, Canvas 2D, `requestAnimationFrame`, Vitest/happy-dom, Vite.

---

Use `@superpowers:test-driven-development` for every production change. Apply the high-frequency rendering guidance from `@vercel-react-best-practices`: keep transient frame data outside App state, use functional state updates for job-scoped UI changes, and avoid layout reads inside the animation loop.

## File Map

- Modify `src/ui/liveNestTrace.ts`: replace receipt-time batch state with the job-scoped playback controller and compact live-view state helpers.
- Modify `src/ui/liveNestTrace.test.ts`: prove frame ordering, commit compaction, paint-safe drain, cancellation, stale-job isolation, and state updates.
- Modify `src/ui/index.ts`: export the revised playback/state API.
- Modify `src/rendering/NestAttemptTrail.tsx`: make the existing single canvas the imperative playback sink; draw both the current outline and fading anchors.
- Modify `src/rendering/NestPreview.tsx`: pass the playback controller to the canvas and remove the React/SVG current-ghost path.
- Modify `src/rendering/NestPreview.test.ts`: verify canvas attachment, frame-by-frame drawing, and no inactive canvas overhead.
- Modify `src/index.css`: remove the obsolete attempt SVG layer; retain one pointer-events-free canvas overlay.
- Modify `src/App.tsx`: create/cancel one controller per traced job, enqueue callbacks synchronously, and await normal drain before applying completion.
- Modify `src/App.test.ts`: cover exact frame playback, commit ordering, completion waiting, immediate invalidation, and zero App re-renders for same-sheet attempts.
- Modify `src/ui/Workspace.tsx`: render compact committed placements and pass the active controller to `NestPreview`.

No nesting algorithm, worker protocol, batching limit, candidate order, or scoring file changes are required. `src/nesting/worker/attemptBatcher.ts` remains the transport optimization.

### Task 1: Build the job-scoped frame playback controller

**Files:**
- Modify: `src/ui/liveNestTrace.ts:1-77`
- Modify: `src/ui/liveNestTrace.test.ts:1-101`
- Modify: `src/ui/index.ts:14-24`

- [ ] **Step 1: Replace the batch-state tests with failing controller tests**

Stub `requestAnimationFrame` with a FIFO callback array so each test explicitly advances browser frames:

```ts
const frames: FrameRequestCallback[] = []

beforeEach(() => {
  frames.length = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => vi.unstubAllGlobals())

function nextFrame(now: number) {
  const callback = frames.shift()
  expect(callback).toBeTypeOf('function')
  callback!(now)
}
```

Add a fake sink implementing the desired public contract:

```ts
const shown: Array<[number, number]> = []
const commits: Placement[][] = []
const sink: LiveNestPlaybackSink = {
  renderAttempt(value, displayedAtMs) {
    shown.push([value.sequence, displayedAtMs])
    return true
  },
  renderCommit(_placements, _sheetIndex, _displayedAtMs) {
    return true
  },
  renderIdle() {
    return false
  },
  clear: vi.fn(),
}
```

Write these focused cases:

```ts
it('displays every attempt from one batch on a distinct frame', () => {
  const playback = createLiveNestPlayback('job-1', callbacks(commits))
  playback.attach(sink)
  playback.enqueueAttempts({
    jobId: 'job-1',
    attempts: [attempt(0), attempt(1), attempt(2)],
  })

  expect(shown).toEqual([])
  nextFrame(16)
  expect(shown).toEqual([[0, 16]])
  nextFrame(32)
  expect(shown).toEqual([[0, 16], [1, 32]])
  nextFrame(48)
  expect(shown).toEqual([[0, 16], [1, 32], [2, 48]])
})

it('keeps batches and compact commit deltas in callback order', () => {
  const playback = createLiveNestPlayback('job-1', callbacks(commits))
  playback.attach(sink)
  playback.enqueueAttempts({ jobId: 'job-1', attempts: [attempt(0)] })
  playback.enqueueCommit('job-1', success([placement('a')]))
  playback.enqueueAttempts({ jobId: 'job-1', attempts: [attempt(1)] })
  playback.enqueueCommit(
    'job-1',
    success([placement('a'), placement('b')]),
  )

  nextFrame(16) // attempt 0
  nextFrame(32) // commit a
  nextFrame(48) // attempt 1
  nextFrame(64) // commit b

  expect(shown.map(([sequence]) => sequence)).toEqual([0, 1])
  expect(commits).toEqual([[placement('a')], [placement('b')]])
})
```

In the same test, spy on `sink.renderCommit` and assert the second marker receives
`[placement('b')]`, its sheet index, and that frame's timestamp. Add a separate
cross-sheet case where an attempt is shown on sheet 0 and the following compact
commit targets sheet 1; the sink must receive sheet 1 before the live-view commit
callback records the sheet change.

Also add tests that:

- ignore batches and commits with a different job ID;
- call the sheet callback only when the displayed sheet actually changes;
- pass a cross-sheet commit's delta and target sheet to the sink before the
  React live-view callback runs;
- leave `seal()` pending after the final event frame and resolve it on the next RAF;
- resolve `seal()` immediately when no event was ever queued;
- make `cancel()` clear the sink, cancel RAF, discard queued events, and resolve a waiter;
- release the drain rather than throw when a sink callback fails; and
- keep `LiveNestTrace` placement updates append-only and ignore stale job updates.

- [ ] **Step 2: Run the tests and verify the new API is missing**

Run:

```bash
npx vitest run src/ui/liveNestTrace.test.ts --reporter=verbose
```

Expected: FAIL because `createLiveNestPlayback`, `LiveNestPlaybackSink`, and the revised trace helpers do not exist.

- [ ] **Step 3: Implement the minimal controller in the existing trace module**

Replace receipt-time `trail/current` state with these public shapes:

```ts
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

export type LiveNestTrace = {
  jobId: string
  sheetIndex: number
  placements: Placement[]
  playback: LiveNestPlayback
}
```

Use one queue containing batch nodes with a read offset and compact commit nodes:

```ts
type QueueItem =
  | { kind: 'attempts'; attempts: NestAttempt[]; index: number }
  | { kind: 'commit'; placements: Placement[] }
```

The controller must follow this loop, without `shift()` or batch flattening:

```ts
const step = (now: number) => {
  frame = null
  if (!sink || cancelled) return

  // Entering a later RAF proves the prior event survived one paint.
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
      if (sheetIndex != null) displayedSheet = sheetIndex
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
```

Implementation details required for correctness and memory:

- Store queued nodes in an array plus `head`; set consumed slots to `undefined` and reset the array when fully drained.
- Keep a `Set<string>` of committed part IDs. `enqueueCommit` synchronously filters the snapshot to unseen placements and queues only that delta; never retain a full `NestingSuccess`.
- Queue an empty commit marker too, because it clears the preceding ghost.
- Ignore enqueue calls after seal/cancel and ignore mismatched job IDs.
- Request RAF only when a sink is attached and no frame is already pending.
- Detaching the sink cancels only the scheduled RAF; queued data remains available for a replacement sink.
- `seal()` resolves immediately for a never-used empty stream, otherwise only after the first empty RAF following the final event.
- `cancel()` is idempotent and always settles the drain promise.

Add state helpers that do not touch frame data:

```ts
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
  if (placements.length === 0 && sheetIndex == null) return state
  return {
    ...state,
    placements: [...state.placements, ...placements],
    sheetIndex: sheetIndex ?? state.sheetIndex,
  }
}
```

Update `src/ui/index.ts` to export only the revised functions and types; remove `appendLiveAttempts`, `applyLiveCommitted`, `pruneLiveAttempts`, and `TimedNestAttempt`.

- [ ] **Step 4: Run the controller tests and verify green**

Run:

```bash
npx vitest run src/ui/liveNestTrace.test.ts --reporter=dot
```

Expected: PASS with every batch record observed on a separate explicit frame.

- [ ] **Step 5: Commit the controller**

```bash
git add src/ui/liveNestTrace.ts src/ui/liveNestTrace.test.ts src/ui/index.ts
git commit -m "feat: add frame-paced nesting playback"
```

### Task 2: Make the existing canvas the only per-frame renderer

**Files:**
- Modify: `src/rendering/NestAttemptTrail.tsx:1-91`
- Modify: `src/rendering/NestPreview.tsx:1-141`
- Modify: `src/rendering/NestPreview.test.ts:1-222`
- Modify: `src/index.css:1056-1102`

- [ ] **Step 1: Write failing canvas playback tests**

Extend the Canvas 2D mock with the methods used for a compound outline:

```ts
const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  setLineDash: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  globalAlpha: 1,
}
```

Render `NestPreview` with `playback`, enqueue two attempts in one transport batch, and manually run two RAF callbacks. Assert:

- the canvas exists as soon as playback is supplied;
- no `.nest-preview__attempt-svg` node exists;
- the first frame draws one ghost outline;
- the second frame draws the second ghost rather than jumping directly to it; and
- switching the next attempt to another sheet clears previous-sheet trail anchors before drawing;
- a commit on another sheet clears the old-sheet trail before that commit frame
  draws and before Workspace switches sheets.

Keep the existing regression that no attempt canvas is mounted when `playback` is absent.

- [ ] **Step 2: Run the rendering test and verify it fails**

Run:

```bash
npx vitest run src/rendering/NestPreview.test.ts --reporter=verbose
```

Expected: FAIL because `NestPreview` still accepts React-owned `attempts/current` and the canvas does not attach to playback.

- [ ] **Step 3: Convert `NestAttemptTrail` into an imperative playback sink**

Keep the existing component and CSS class; change its props to:

```ts
type Props = {
  playback: LiveNestPlayback
  parts: GeometryPart[]
  sheetWidth: number
  sheetHeight: number
}
```

Inside its single effect:

- acquire the 2D context once; call `playback.cancel()` if unavailable;
- cache `{ part, origin }` by part ID once;
- retain only local `trail`, `current`, and `activeSheet` variables;
- attach one `LiveNestPlaybackSink` to the controller;
- do not call `requestAnimationFrame` in the component; and
- keep `ResizeObserver` only for backing-buffer size changes.

Timestamp and prune trail entries at display time:

```ts
type DisplayedAttempt = {
  attempt: NestAttempt
  displayedAtMs: number
}

renderAttempt(attempt, displayedAtMs) {
  if (activeSheet !== attempt.sheetIndex) {
    trail.length = 0
    activeSheet = attempt.sheetIndex
  }
  trail.push({ attempt, displayedAtMs })
  current = attempt
  return draw(displayedAtMs)
}

renderCommit(_placements, sheetIndex, now) {
  current = null
  if (sheetIndex != null && activeSheet !== sheetIndex) {
    trail.length = 0
    activeSheet = sheetIndex
  }
  return draw(now)
}

renderIdle(now) {
  current = null
  return draw(now)
}
```

`draw(now)` must compact the trail in place, render red/green anchors, and then draw the current part as a yellow compound outline. Transform points directly while tracing the Canvas path—rotate around the cached `partRotationOrigin`, add the attempt translation, then scale into CSS pixels. Do not call `applyPlacement` or allocate transformed rings per frame.

Use Canvas state rather than a second SVG layer:

```ts
context.save()
context.fillStyle = 'rgba(250, 204, 21, 0.12)'
context.strokeStyle = '#facc15'
context.lineWidth = 0.7
context.setLineDash([3, 2])
context.beginPath()
traceRing(part.outer.points, current)
for (const hole of part.holes) traceRing(hole.points, current)
context.fill('evenodd')
context.stroke()
context.restore()
```

All rendering exceptions must propagate to the controller, which cancels and releases the drain. Effect cleanup detaches the sink and disconnects the resize observer.

- [ ] **Step 4: Simplify `NestPreview` and CSS**

Replace `attempts/current` props with:

```ts
playback?: LiveNestPlayback | null
```

Render `NestAttemptTrail` only when `playback` exists. Delete current-geometry computation and the `.nest-preview__attempt-svg` element. Remove `.nest-preview__attempt-svg` and `.nest-preview__attempt-ghost` CSS; retain `.nest-attempt-trail` at `z-index: 2` above the committed SVG.

- [ ] **Step 5: Run rendering and controller tests**

Run:

```bash
npx vitest run src/rendering/NestPreview.test.ts src/ui/liveNestTrace.test.ts --reporter=dot
```

Expected: PASS; Canvas owns every transient frame and no React node represents the moving ghost.

- [ ] **Step 6: Commit the renderer**

```bash
git add src/rendering/NestAttemptTrail.tsx src/rendering/NestPreview.tsx src/rendering/NestPreview.test.ts src/index.css
git commit -m "feat: render every nesting attempt on canvas"
```

### Task 3: Wire ordered playback into App lifecycle

**Files:**
- Modify: `src/App.tsx:1-335,390-435`
- Modify: `src/App.test.ts:1-360`
- Modify: `src/ui/Workspace.tsx:1-186`
- Modify: `src/rendering/NestPreview.test.ts:150-222`

- [ ] **Step 1: Write failing App lifecycle regressions**

Add a RAF queue to `App.test.ts` and attach a fake sink through `mocks.workspaceProps.liveTrace.playback`.

Replace the old immediate-batch assertions with these behaviors:

```ts
it('plays one attempt per frame and applies the following commit afterward', async () => {
  // Load, enable debug, start a pending run, and attach a fake sink.
  options.onAttempts({
    jobId,
    attempts: [attempt(0, 0), attempt(1, 1)],
  })
  options.onProgress({
    phase: 'seed',
    ratio: 0.5,
    attemptPass: 'canonical-blf',
    bestSoFar: result(),
  })

  expect(shown).toEqual([])
  nextFrame(16)
  expect(shown).toEqual([0])
  nextFrame(32)
  expect(shown).toEqual([0, 1])
  expect(mocks.workspaceProps!.liveTrace.placements).toEqual([])
  nextFrame(48)
  expect(mocks.workspaceProps!.liveTrace.placements).toHaveLength(1)
})
```

Add a normal-completion test:

```ts
it('keeps calculating until the final attempted position has painted', async () => {
  options.onAttempts({ jobId, attempts: [attempt(0)] })
  completed.resolve(result())
  await flush()

  expect(mocks.settingsProps!.nestResult).toBeNull()
  expect(mocks.workspaceProps!.calculating).toBe(true)
  nextFrame(16) // display final attempt
  await flush()
  expect(mocks.settingsProps!.nestResult).toBeNull()
  nextFrame(32) // paint acknowledgement / drain
  await flush()
  expect(mocks.settingsProps!.nestResult).not.toBeNull()
  expect(mocks.workspaceProps!.liveTrace).toBeNull()
})
```

Also update/add tests proving:

- stale job batches and non-canonical progress snapshots never enter playback;
- STOP, error, file replacement, settings changes, debug disable, and unmount cancel immediately;
- cancellation cannot later apply a queued frame;
- debug-off still passes no `onAttempts` callback;
- two same-sheet attempt frames call the canvas sink twice but do not cause two App/Workspace renders; and
- live committed placements and the displayed sheet remain separate from `nestResult` until drain.

- [ ] **Step 2: Run App tests and verify they fail for visual batching**

Run:

```bash
npx vitest run src/App.test.ts --reporter=verbose
```

Expected: FAIL because App still converts each entire batch into one React state update and clears the trace immediately on completion.

- [ ] **Step 3: Create and retain one controller per traced job**

In `App`, add:

```ts
const playbackRef = useRef<LiveNestPlayback | null>(null)
```

At the start of a traced run, create the controller before calling `nestAsync`:

```ts
const playback = traceEnabled
  ? createLiveNestPlayback(jobId, {
      onSheetIndex: (sheetIndex) => {
        setLiveTrace((current) =>
          applyLiveSheet(current, jobId, sheetIndex),
        )
      },
      onCommit: (placements, sheetIndex) => {
        setLiveTrace((current) =>
          applyLiveCommit(current, jobId, placements, sheetIndex),
        )
      },
    })
  : null

playbackRef.current = playback
setLiveTrace(playback ? startLiveNestTrace(jobId, playback) : null)
```

Send worker callbacks directly into that imperative stream, preserving worker-message order:

```ts
onAttempts: (batch) => {
  if (activeJobIdRef.current === jobId) playback.enqueueAttempts(batch)
}
```

For canonical progress only:

```ts
if (p.attemptPass === 'canonical-blf' && p.bestSoFar) {
  playback?.enqueueCommit(jobId, p.bestSoFar)
}
```

Do not call React state from `onAttempts`.

- [ ] **Step 4: Make completion paint-safe and invalidation immediate**

Immediately after `nestAsync` returns and the active-job guard passes:

```ts
if (result.status === 'ok') {
  await playback?.seal()
  if (activeJobIdRef.current !== jobId) return
} else {
  playback?.cancel()
}
```

Then use the existing result handling unchanged. In `catch`, cancel before reporting the error. In `finally`, clear the trace only for the still-active job and clear `playbackRef` only when it still points to this run.

Call `playbackRef.current?.cancel()` in all immediate invalidation paths:

- component cleanup;
- `invalidateNestingState`;
- before replacing an existing run;
- `handleStopNest` (also clear `liveTrace` immediately); and
- disabling nest debug.

Delete the trail-expiry timeout effect; fade/pruning now belongs to the canvas sink and its sole RAF loop.

- [ ] **Step 5: Pass compact live state through Workspace**

Change the live placement selection to:

```ts
const placements = showLiveNest ? liveTrace.placements : nestResult!.placements
```

Pass only:

```tsx
playback={showLiveNest ? liveTrace.playback : null}
```

Remove `attempts/current` props. Keep the live sheet picker behavior and canonical result/export paths unchanged.

- [ ] **Step 6: Run the full focused feature matrix**

Run:

```bash
npx vitest run \
  src/ui/liveNestTrace.test.ts \
  src/rendering/NestPreview.test.ts \
  src/App.test.ts \
  src/nesting/worker/attemptBatcher.test.ts \
  src/nesting/worker/client.test.ts \
  src/nesting/placement/blf.test.ts \
  src/nesting/optimization/optimizer.test.ts \
  --reporter=dot
```

Expected: PASS. Existing worker batching and traced-versus-untraced result invariance must remain green.

- [ ] **Step 7: Commit lifecycle integration**

```bash
git add src/App.tsx src/App.test.ts src/ui/Workspace.tsx src/rendering/NestPreview.test.ts
git commit -m "fix: play nesting attempts without visual batching"
```

### Task 4: Verify correctness and browser performance

**Files:**
- Modify only if a failing check exposes a defect in the files above.

- [ ] **Step 1: Run static checks and production build**

Run:

```bash
npm run lint
npm run build
git diff --check
```

Expected: all commands exit 0; Vite builds the worker and browser bundle without warnings introduced by this feature.

- [ ] **Step 2: Run the complete repository suite**

Run:

```bash
npm test -- --reporter=dot
```

Expected baseline or better: 319 passed, 2 skipped, 0 failed. Confirm benchmark documentation is unchanged after the run.

- [ ] **Step 3: Run a local browser acceptance check**

Start the isolated worktree app on an unused port:

```bash
npm run dev -- --host 127.0.0.1 --port 5175
```

With a multi-part SVG loaded:

1. Enable **Nest / geom debug** and start nesting.
2. Confirm a batch containing multiple candidates visibly advances one position per display frame rather than jumping to the last one.
3. Confirm the current yellow outline and red/green anchors share one canvas overlay.
4. Confirm committed blue placements appear only after their preceding attempts.
5. Confirm normal completion waits for the final attempted outline to appear once.
6. Confirm STOP, debug disable, and a settings change clear the canvas immediately.
7. Confirm controls remain responsive while the worker computes and while a backlog replays.
8. Run again with debug off and confirm no canvas is mounted and completion timing is unchanged.

Use browser performance tooling to verify there is one active animation callback, no per-attempt App/SettingsPanel commit, and no growing retained `NestingSuccess` snapshot list.

- [ ] **Step 4: Rescan the final diff**

Run:

```bash
git status --short
git diff --stat main...HEAD
git diff --check main...HEAD
rg -n "receivedAtMs|appendLiveAttempts|applyLiveCommitted|pruneLiveAttempts|nest-preview__attempt-svg" src
```

Expected: only the planned playback files differ; the obsolete receipt-time and SVG-ghost paths have no matches.

- [ ] **Step 5: Commit only if verification required a correction**

If Steps 1-4 exposed and fixed a defect, stage only those exact files and commit:

```bash
git commit -m "fix: harden frame-paced nesting playback"
```

If no correction was required, do not create an empty commit.
