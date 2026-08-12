# Automatic Anytime Nesting

Date: 2026-08-12
Status: Approved design

## Context

The application exposes Fast, Balanced, and Deep optimization modes, but users
do not have enough information to choose between them. More importantly, the
current Fast run starts with an uncapped exhaustive free-angle BLF pass. On
dense polygons, that baseline can consume seconds before the nominal 500 ms
optimization budget is considered.

The engine already contains the useful pieces of an anytime optimizer: BLF/NFP
placement, deterministic order heuristics, cached evaluations, local search,
destroy/repair, worker execution, progress snapshots, simplified NFP geometry,
and exact collision validation. The redesign should compose these pieces into
one automatic policy rather than add another optimizer.

## Goals

- Remove optimization-mode selection from the user experience.
- Produce the first feasible layout as quickly as the geometry permits.
- Improve that layout continuously and publish only strictly better champions.
- Preserve exact containment, non-overlap, spacing, and part-in-part rules in
  every published result.
- Stop automatically when additional search is unlikely to repay its latency.
- Keep results reproducible when deterministic developer mode is enabled.

## Non-goals

- Do not promise a globally optimal layout; irregular nesting is combinatorial
  and practical exact methods do not scale to complex production instances.
- Do not add machine learning, GPU compute, a server solver, or a new geometry
  dependency.
- Do not rewrite BLF, scoring, worker transport, or the Clipper2 backend.
- Do not expose replacement tuning controls for the removed mode selector.

## User Experience

The settings panel no longer shows Fast, Balanced, or Deep. Starting a nest
launches one automatic run.

The first valid champion appears as soon as the seed pass completes. Later
champions replace it only when the existing canonical result comparator proves
they are better. Progress describes the active work, such as `Initial layout`,
`Trying orders`, `Improving layout`, and `Verifying result`; it does not expose
algorithmic modes.

STOP and input replacement retain the current best-so-far behavior. Export
always uses the most recently exact-validated champion.

## Algorithm

### 1. Prepare once

Normalize source geometry and prepare rotation variants once per request. Open
one nesting geometry session so every phase shares the existing NFP cache.

Rotation work is progressive:

1. orthogonal angles for the initial seed;
2. balanced angles for promising orders;
3. the existing coarse free-angle grid for improvement candidates; and
4. 5-degree then 1-degree refinement only around rotations in finalists.

The engine must not run an exhaustive 360-angle placement for every part as a
mandatory baseline.

### 2. Publish the seed champion

Run one area-descending BLF placement using simplified NFP candidate generation
and orthogonal rotations. Candidate acceptance still uses the existing exact
containment, collision, spacing, and stock checks. This produces a feasible
champion without waiting for exhaustive NFP boundaries.

If a simplified candidate set cannot place a part, retry that part with exact
NFP candidate generation before declaring it unplaced. This fallback protects
feasibility without imposing exact geometry cost on every successful placement.

### 3. Search promising orders

Use a bounded beam over placement order. The first layer consists of the
existing deterministic order candidates. Retain only the best distinct orders
after canonical scoring; a default beam width of four is internal and not a
user setting.

Expand a beam member with the smallest useful order moves already represented
in the codebase: adjacent swap, arbitrary swap, and remove/reinsert. Duplicate
orders are discarded through the existing individual key/cache. Every
evaluation starts with simplified NFP geometry and progressive rotations.

This replaces population creation, tournament selection, crossover, fixed
generations, multi-start presets, and mode-specific evolutionary parameters.

### 4. Improve the champion

Apply adaptive destroy/repair to the best beam results. Remove parts that
contribute most to the used bounds, sheet count, or failed placement suffix,
then reinsert them using the current placement heuristic. Small random
perturbations remain available to escape a local minimum.

Track improvement per operator. Prefer operators that recently produced a
better exact-validated champion, while occasionally trying every operator so a
temporarily weak strategy is not permanently excluded. This is a few weighted
counters, not a general optimization framework.

### 5. Verify before publishing

A search candidate may be ranked using simplified NFPs, but it becomes a
champion only after replaying its order and selected rotations through exact
geometry. The exact replay is the sole publication gate.

Finalists receive progressively finer rotation refinement. Refinement stops as
soon as it fails to improve the canonical score; the engine never polishes all
discarded candidates.

## Automatic Termination

The run has no user-selected duration. It stops at the first condition that
holds:

1. the request is aborted;
2. every deterministic seed/order candidate has been evaluated and no exact
   champion improves during `max(64, 4 × partCount)` subsequent evaluations;
3. time since the last champion improvement exceeds twice the time required to
   produce the first champion, with a 100 ms minimum; or
4. a 5-second safety ceiling is reached.

The safety ceiling prevents pathological inputs from searching indefinitely;
it does not interrupt a single synchronous geometry operation already in
progress. Deterministic developer runs ignore time conditions and stop by the
evaluation limit, preserving repeatability.

These constants are internal defaults. They should change only from benchmark
evidence, not become user settings.

## Scoring and Correctness

Keep the existing canonical comparison and priority order. A candidate cannot
trade an unplaced part or additional sheet for cosmetic compactness. Equal
results do not trigger UI updates or reset convergence counters.

Every published champion must pass:

- all parts within their assigned sheet;
- no forbidden overlap;
- requested spacing;
- valid stock quantities;
- valid part-in-part placement when enabled; and
- the existing result consistency checks.

If exact replay fails, discard the candidate, preserve the previous champion,
and continue until the normal stopping rule applies.

## Architecture and Data Flow

1. The UI converts settings into a request without an optimization level.
2. The worker starts the automatic optimizer and owns its cancellation signal.
3. The optimizer prepares geometry and publishes the seed champion.
4. Beam search and destroy/repair evaluate candidates against the shared cache.
5. A promising candidate is replayed with exact geometry.
6. A strictly better validated result is emitted through the existing progress
   and best-so-far path.
7. The convergence controller stops the search and returns the current
   champion.

The public nesting engine contract and worker message shape remain unchanged
except for removing mode-specific progress data where no longer needed.

## Technology Decision

Implement the first version in the current TypeScript worker with Clipper2.
The measured problem is excessive exact work and search policy, not lack of a
new runtime.

After the automatic algorithm is benchmarked, move only the measured geometry
hot path to Rust or C++ WebAssembly if NFP generation and collision validation
still account for most runtime. Keep orchestration, scoring, cancellation, and
UI communication in TypeScript. Additional workers are deferred until one
worker's cache-aware search is measured and CPU parallelism is shown to improve
time-to-champion after transfer and duplicate-work costs.

CP-SAT/MIP is not the primary engine because its convenient no-overlap model is
axis-aligned rectangular packing, while exact irregular-polygon formulations
scale poorly on complex geometry. GPU/WebGPU and machine learning do not remove
the need for exact geometric validation.

## Failure Handling

- If the initial simplified pass fails, retry affected placements with exact
  candidate generation.
- If no complete layout exists, publish the best valid partial result using the
  current unplaced-part semantics.
- If a later candidate fails exact replay, discard only that candidate.
- If the worker fails, preserve the application's existing error behavior.
- On STOP, return the last exact-validated champion; never return an unverified
  search candidate.

## Verification

Tests will prove:

1. the seed champion is published before order and neighborhood search;
2. every published champion is strictly better than its predecessor;
3. simplified ranking cannot publish a candidate that fails exact replay;
4. exact fallback runs when simplified candidates leave a placeable part
   unplaced;
5. rotation refinement is restricted to finalists;
6. convergence stops non-deterministic runs and evaluation limits stop
   deterministic runs reproducibly;
7. STOP returns the latest exact-validated champion;
8. automatic results are never worse than the initial BLF champion;
9. UI and request construction expose no optimization selector; and
10. existing geometry, nesting, worker, lint, type-check, and production-build
    checks remain green.

Benchmark reporting will record first-champion latency, final latency, time of
each improvement, exact-replay cost, final score, placed count, sheet count,
and geometry hot-path share. Success is evaluated by the time-to-quality curve,
not final runtime alone.

## Acceptance Criteria

- Users start nesting without selecting an optimization mode.
- A feasible exact-validated result appears at the earliest completed seed.
- The displayed/exported result only improves during a run.
- Ordinary jobs finish when search converges rather than consuming a fixed
  preset duration.
- Dense inputs no longer pay for a mandatory exhaustive 360-angle baseline.
- Benchmarks show the new automatic policy reaches each old preset's final
  score in equal or less time on the repository fixture suite.
