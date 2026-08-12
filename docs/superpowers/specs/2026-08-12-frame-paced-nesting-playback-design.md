# Frame-Paced Nesting Attempt Playback

Date: 2026-08-12
Status: Approved design
Supersedes: The visual batching behavior in `2026-08-12-live-nesting-attempts-design.md`

## Problem

The worker emits every canonical BLF placement attempt, but the UI appends an
entire worker batch in one React update and selects only the batch's last record
as the current ghost. Trail anchors survive, but intermediate part positions are
never individually rendered. The animation therefore appears to jump between
batches instead of showing every tested position.

## Goals

- Display every canonical placement attempt in sequence for one browser frame.
- Preserve the existing full-speed worker computation and final nesting result.
- Keep committed placements, the current attempted part, and active-sheet
  following visually ordered.
- Avoid per-attempt worker messages and full-App React renders.
- Preserve immediate STOP, stale-job rejection, and debug-off performance.

## Non-goals

- Do not pace or modify the nesting algorithm itself.
- Do not visualize provisional optimizer branches or suffix simulations.
- Do not drop attempts to catch up with computation.
- Do not retain attempts after they have been displayed and faded.
- Do not change candidate order, placement decisions, or scoring.

## Selected Approach

Worker messages remain count-batched because batching minimizes structured-clone
and `postMessage` overhead. Visual playback is independent of transport: the
browser queues the records in message order and a single `requestAnimationFrame`
loop consumes exactly one attempt per frame.

Unbatched worker messages were rejected because they would flood the browser
event loop and React could still coalesce renders. Worker backpressure was
rejected because it would slow nesting to display speed and require an invasive
asynchronous engine rewrite.

## Data Flow

1. The canonical BLF pass emits ordered attempt records as it does today.
2. The worker transports compact records in ordered batches.
3. The browser appends each batch to a playback queue without flattening or
   copying the full backlog.
4. One animation frame consumes one attempt, makes it the visible current part,
   and adds its accepted/rejected anchor to the fading canvas trail.
5. Canonical committed-layout snapshots enter the same ordered stream after the
   attempt batches that precede them. They become visible only when playback
   reaches their marker.
6. The active sheet follows the attempt currently displayed, not the newest
   attempt already received from the worker.
7. Normal completion waits for the playback queue to drain before replacing the
   live view with the final result.

## Rendering and Performance

The animation loop and transient drawing remain localized to the preview. The
current outline and trail are drawn imperatively on Canvas 2D so a frame does not
re-render `App`, the settings panel, or the complete committed SVG layout.
Source part geometry is reused; attempt messages continue to contain only IDs,
transforms, sheet indices, sequence numbers, and verdicts.

The queue stores worker batches with read offsets rather than repeatedly calling
`shift`, flattening arrays, or copying consumed records. Fully consumed batches
are removed. There is one RAF loop and one resize observer while playback is
active. Debug-disabled runs create no observer, queue, worker telemetry, or
canvas animation work.

Showing every attempt while the worker runs at full speed necessarily permits a
temporary backlog. The backlog contains only compact attempt records and is
released continuously. No arbitrary cap is allowed because a cap would violate
the requirement to display every move.

## Lifecycle and Failure Handling

- A playback stream belongs to one job ID; stale batches and snapshots are
  ignored.
- Successful completion waits for the matching stream to drain.
- STOP, cancellation, error, file replacement, settings changes, debug disable,
  and component unmount cancel RAF, discard queued transient records, and resolve
  any drain waiter without applying stale UI state.
- A hidden browser tab naturally pauses RAF playback and resumes without losing
  attempts.
- Canvas or telemetry failures remain observation-only: they must release the
  playback wait and must never change, fail, or deadlock nesting.
- Existing best-result retention and export paths remain unchanged.

## Verification

Tests will prove:

1. Several records received in one transport batch are displayed on distinct
   animation frames in exact sequence order.
2. No attempt is duplicated or skipped across multiple batches.
3. A committed snapshot is applied only after all preceding attempts display.
4. The final result is withheld until normal playback drains.
5. STOP and all invalidation paths cancel playback immediately without stale
   frames or unresolved promises.
6. Active-sheet changes follow displayed attempts.
7. Debug-off runs retain the existing zero-telemetry path.
8. Traced and untraced nesting results remain semantically identical.
9. Rendering uses one RAF loop and does not cause per-attempt App-level React
   updates.
10. Focused tests, the full suite, lint, type checking/build, and local browser
    verification pass.

## Acceptance Criteria

- With debug enabled, every canonical tested position becomes the visible
  current part for one browser frame, even when it arrived in a larger worker
  batch.
- The trail and committed layout advance in the same order as those positions.
- Normal completion does not erase undisplayed attempts.
- The browser remains responsive and nesting computation stays in the worker at
  full speed.
- Debug-disabled behavior and final nesting output are unchanged.
