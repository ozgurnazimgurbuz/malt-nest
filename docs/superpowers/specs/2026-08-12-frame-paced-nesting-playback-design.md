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
3. One job-scoped imperative stream synchronously receives attempt batches and
   canonical progress markers from the worker callbacks. React effects are not
   used as stream ingress, so browser render scheduling cannot reorder events.
4. One animation frame consumes one stream event. For an attempt event, playback
   assigns `displayedAtMs` at consumption time, makes it the visible current
   part, and adds its accepted/rejected anchor to the fading canvas trail.
5. Canonical BLF snapshots are append-only. At ingress, each snapshot is reduced
   to only placements whose part IDs have not appeared in earlier canonical
   snapshots. The resulting compact commit delta enters the stream after the
   attempt batches that precede it and becomes visible only when playback reaches
   that marker. A commit-marker frame clears the preceding current ghost, applies
   the delta, and follows the last newly committed placement's sheet. An empty
   delta clears the ghost and retains the current sheet.
6. The active sheet follows the attempt currently displayed, not the newest
   attempt already received from the worker.
7. Normal completion seals the stream. Drain resolves only on a later animation
   frame after the final event was processed, guaranteeing that the last attempt
   survives a browser paint before the final result replaces it.

## Rendering and Performance

The animation loop and transient drawing remain localized to the preview. The
current outline and trail are drawn imperatively on Canvas 2D so a frame does not
re-render `App`, the settings panel, or the complete committed SVG layout.
Source part geometry is reused; attempt messages continue to contain only IDs,
transforms, sheet indices, sequence numbers, and verdicts.

The queue stores worker batches with read offsets rather than repeatedly calling
`shift`, flattening arrays, or copying consumed records. Fully consumed batches
are removed. Commit markers contain only newly committed placements, so a long
backlog retains O(attempts + parts) compact stream data rather than repeated
growing `NestingSuccess` snapshots. There is one RAF loop and one resize observer
while playback is active. Debug-disabled runs create no observer, queue, worker
telemetry, or canvas animation work.

Showing every attempt while the worker runs at full speed necessarily permits a
temporary backlog. The backlog contains only compact attempt records and is
released continuously. No arbitrary cap is allowed because a cap would violate
the requirement to display every move.

## Lifecycle and Failure Handling

- A playback stream belongs to one job ID; stale batches and snapshots are
  ignored.
- Successful completion seals the matching stream and waits for its paint-safe
  drain. An empty-but-unsealed stream remains open for later worker messages.
- STOP, cancellation, error, file replacement, settings changes, debug disable,
  and component unmount cancel RAF, discard queued transient records, and resolve
  any drain waiter without applying stale UI state.
- A hidden browser tab naturally pauses RAF playback and resumes without losing
  attempts.
- Canvas or telemetry failures remain observation-only: they cancel and release
  the playback wait and must never change, fail, or deadlock nesting.
- Existing best-result retention and export paths remain unchanged.

## Verification

Tests will prove:

1. Several records received in one transport batch are displayed on distinct
   animation frames in exact sequence order.
2. No attempt is duplicated or skipped across multiple batches.
3. Trail lifetime starts at `displayedAtMs`, so queued attempts cannot expire
   before their frame.
4. A compact committed-placement delta is applied on a later frame after all
   preceding attempts display; that frame clears the old ghost and follows the
   committed placement's sheet.
5. The final result is withheld until a frame after the final stream event.
6. STOP and all invalidation paths cancel playback immediately without stale
   frames or unresolved promises.
7. Active-sheet changes follow displayed attempts.
8. Debug-off runs retain the existing zero-telemetry path.
9. Traced and untraced nesting results remain semantically identical.
10. Rendering uses one RAF loop and does not cause per-attempt App-level React
   updates.
11. Focused tests, the full suite, lint, type checking/build, and local browser
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
