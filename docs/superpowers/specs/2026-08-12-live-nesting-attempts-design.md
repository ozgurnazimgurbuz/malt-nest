# Live Nesting Attempt Visualization

Date: 2026-08-12
Status: Approved design

## Context

The application currently reports aggregate nesting progress and only renders a
completed result. Candidate translations tested inside the BLF placement loop
never leave the worker, so rejected positions cannot be inspected while the
engine runs. The static geometry debug preview computes illustrative candidates
on the main thread; it is not a trace of the active nesting job.

## Goals

- In the existing **Nest / geom debug** mode, show the placement search while it
  runs.
- Draw the current candidate as a moving part outline.
- Draw attempted positions as a short fading trail.
- Show accepted placements as the canonical partial layout grows.
- Follow the sheet currently being tested.
- Preserve placement decisions and normal-mode performance.

## Non-goals

- Do not visualize GA individuals, discarded optimizer orders, suffix stock
  simulations, or local-search internals.
- Do not retain or export a complete historical trace.
- Do not add rejection-reason diagnostics.
- Do not change scoring, candidate order, collision checks, or final results.

## User Experience

Tracing is opt-in through the existing debug switch. During the canonical BLF
pass, the workspace switches to a live nest preview:

- committed parts are solid blue;
- the latest candidate is a yellow ghost outline;
- a rejected candidate flashes red;
- an accepted candidate flashes green before becoming committed;
- recent attempt anchors remain as a fading trail;
- the preview automatically follows the active sheet; and
- the existing progress card remains above the preview.

Attempts remain ordered, but the engine is not paced to the display. When the
worker evaluates several candidates between browser frames, they are drawn
together in the trail and only the newest candidate is the moving ghost.

On completion, cancellation, error, input replacement, or settings change, the
ghost and trail are cleared. A completed or retained best result continues to
use the existing result and export paths.

## Attempt Scope

The default evolutionary engine always runs a Stage-1 canonical BLF baseline.
That pass is the source of live attempt telemetry. Evolutionary population
evaluations, order trials, local search, repair, Stage-2 finalist trials, and
recursive stock suffix simulations do not emit telemetry because their layouts
are provisional and would make the preview jump between unrelated states.

Within the traced BLF pass, regular candidate translations and rotations tested
for the current part are included. A candidate is recorded immediately after
the existing placement validator returns, so the trace observes rather than
changes the canonical decision.

## Data Model

A compact attempt record contains only:

- monotonically increasing sequence number;
- part ID;
- sheet index;
- translation `x` and `y`;
- rotation in degrees; and
- verdict: `rejected` or `accepted`.

The record does not contain polygons, NFPs, collision geometry, or full nesting
results. Source part geometry already exists in the UI and is transformed with
the existing placement helpers.

## Engine and Worker Flow

1. `NestingRunOptions` receives an optional attempt-batch callback.
2. The worker request receives a boolean indicating whether attempt tracing is
   enabled; callbacks themselves never cross the worker boundary.
3. `runEvolutionaryNest` passes the observer only to its Stage-1 BLF baseline.
4. The observer is called from the existing candidate validation loop in
   `tryPlaceOnSheet` after each verdict is known.
5. The worker preserves ordering and batches compact records by count or a short
   elapsed interval before posting a dedicated attempt message.
6. The worker flushes the final partial batch before completion or cancellation.
7. The client adds the active job ID and forwards only matching-job batches.

Attempt telemetry remains completely absent when debug mode is disabled.

## UI State and Rendering

The live trace is separate from `nestResult`, which remains the canonical source
for best-result retention and export.

`App` owns the active trace lifecycle and retains the newest partial
`bestSoFar` snapshot received through normal progress events. `Workspace` uses
that snapshot as the live committed layout while calculating.

`NestPreview` is reused for the sheet and committed parts. A canvas overlay
draws attempt anchors efficiently and expires them after a short time window.
The latest attempt is also rendered as a transformed SVG ghost so its actual
part shape and rotation remain legible. The trail storage is time-bounded and
old entries are removed as they fade.

The active sheet index follows incoming attempt batches while a job runs. User
sheet selection resumes after the trace finishes.

## Lifecycle and Failure Handling

- Every batch is associated with the active job ID.
- Batches from stale or replaced jobs are ignored.
- Trace state is reset by the same invalidation paths that abort nesting.
- A worker failure clears the live overlay before showing the existing error
  state.
- STOP preserves the existing best-so-far behavior and clears transient trace
  data once the cancellation result is applied.
- Rendering or telemetry failures must not abort or alter nesting.

## Performance Constraints

- No per-attempt `postMessage` calls.
- No full geometry or result cloning in attempt messages.
- No React/SVG node per trail point; the trail uses one canvas.
- No polling and no artificial delay/backpressure.
- No observer allocation or batching work when debug mode is disabled.
- Visible history is bounded by fade time rather than total attempts.

## Verification

Tests will prove:

1. Candidate records preserve validation order, coordinates, rotation, sheet,
   and accepted/rejected verdicts.
2. Enabling tracing does not change the placement result.
3. The evolutionary engine traces only the Stage-1 canonical BLF pass.
4. The worker batches and flushes attempt records without reordering them.
5. Client and App stale-job guards reject old batches.
6. Debug-off runs produce no attempt telemetry.
7. The UI renders committed parts, the latest ghost, and fading trail data on
   the active sheet.
8. Multi-sheet attempts switch the live preview sheet.
9. Completion, STOP, error, file replacement, and settings changes clear the
   transient trace.
10. Existing tests, lint, type checking, and production build remain green.

## Acceptance Criteria

- With debug enabled, a user can see the current part move through canonical
  attempted positions and see recent attempts fade behind it.
- The live view follows the tested sheet and shows committed placements.
- With debug disabled, the application behaves as before.
- The same request and seed produce the same final result with tracing enabled
  and disabled.
