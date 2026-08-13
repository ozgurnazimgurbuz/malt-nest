# Tenth-Degree Free Rotation

Date: 2026-08-13
Status: Approved design

## Context

The active application already requests free rotation, but its automatic
optimizer uses 90-degree, 45-degree, and 15-degree grids for discovery and only
polishes selected angles locally to whole degrees. The standalone
`malt-nest-engine` package can search a complete circle, but its public default
is orthogonal and its free-search default ends at 1-degree resolution.

This design supersedes the rotation-refinement details in the automatic-anytime
nesting design. It keeps bounded discovery while removing discrete angles as a
final-result restriction in both engines.

## Goals

- Let final placement search choose any angle from 0.0 through 359.9 degrees in
  0.1-degree increments.
- Apply the behavior to the active application and the standalone engine.
- Keep fast coarse discovery so users still receive an early valid layout.
- Preserve exact containment, collision, spacing, stock, and part-in-part
  validation for published results.
- Preserve active-app cancellation and best-so-far behavior.

## Non-goals

- Do not claim a mathematically continuous or globally optimal nest; the search
  resolution is 0.1 degrees and the placement/order optimizer remains
  heuristic.
- Do not run 3,600 angles during every cheap ranking evaluation.
- Do not add UI controls, dependencies, optimizer abstractions, or a second
  rotation implementation.
- Do not add synchronous cancellation to the standalone package.

## Active Application

The current automatic flow remains progressive:

1. Build an initial exact-validated layout from orthogonal angles.
2. Rank orders and neighborhoods with the existing 45-degree and 15-degree
   grids and simplified candidate geometry.
3. Replay promising candidates with exact geometry.
4. Run an exhaustive exact 0.1-degree pass for the terminal champion and every
   member of the terminal beam, regardless of whether preceding local
   refinement improved the champion.
5. Publish the pass only when the existing canonical comparator proves it is
   better than the current champion.

The existing `full` free-angle placement depth will implement step 4. Its grid
changes from 360 whole-degree samples to 3,600 tenth-degree samples. Fixed-plan
finalists must route through the same full-angle evaluator; otherwise their
stored gene angle would bypass rotation search.

The full pass keeps only the best placement candidate for each part. Rotated
geometry is created lazily and is not retained as a 3,600-variant list.

Finalists are deduplicated by placement order because a full pass ignores their
stored rotation genes. After the terminal beam is processed, any repair result
that becomes the champion receives the same full pass before it can be the
completed result.

The empty-stock compatibility precheck must not reject a full-search entry from
its stored or whole-degree angle. For full passes it uses the same 0.1-degree
fit grid as placement, for both best-rotation and fixed-plan entries. Coarse
discovery retains its current cheaper compatibility checks.

Automatic convergence may end discovery, but it must not skip the mandatory
full passes for finalists already selected. An explicit abort may interrupt an
in-flight pass; in that case the worker returns the last exact-validated
champion, as it does today.

## Standalone Engine

The standalone engine changes two defaults:

- the public default rotation policy becomes `{ kind: 'free' }`; and
- free search's `finalStepDeg` becomes `0.1`.

Its existing free-angle cascade already streams an exhaustive final circle,
canonicalizes duplicate angles, evaluates real placement geometry, and keeps a
running best result. The existing 100,000-sample stage guard accepts the 3,600
sample default, so no new resource limiter is needed.

Callers may still explicitly request `none`, `fixed`, or `orthogonal`, or
override `finalStepDeg`. Explicit policies remain authoritative. The
standalone multi-start optimizer may continue using orthogonal angles for its
cheap FAST discovery phase; its FULL phase and the final free-placement path
use the 0.1-degree default.

The standalone API remains synchronous and has no cancellation signal today.
Cancellation remains a worker or process boundary concern; adding a callback
through the public API is separate work.

## Data Flow and Correctness

In both engines, candidate angles are normalized to the half-open range
`[0, 360)`, so 360 degrees is equivalent to 0 degrees. The default exact grid
contains exactly 3,600 unique values: 0.0, 0.1, ..., 359.9. The active engine
generates these values by integer index and canonicalizes to one decimal place;
it does not repeatedly add a floating-point step.

Every angle is evaluated through the applicable existing exact transformed
polygon, NFP, containment, collision, spacing, and scoring paths. No AABB-only
result can be published. Existing cache keys continue to include normalized
rotation, so sub-degree candidates do not alias whole-degree candidates.

If no tenth-degree candidate improves a layout, the previous exact-validated
champion remains unchanged. If a full pass is aborted, no partially evaluated
candidate replaces that champion.

## Performance

A full placement pass grows from 360 to 3,600 angle evaluations per part. This
cost is intentionally limited to exact finalists in the active app. Coarse
ranking remains unchanged, and the standalone search streams its final grid
instead of retaining all rotated shapes.

No new runtime promise is introduced. Benchmark timeouts may be raised only
where existing FULL benchmarks now exercise the new default; correctness tests
must not depend on wall-clock thresholds.

## Verification

Tests will prove:

1. the shared/default full grid contains exactly 3,600 unique normalized angles
   with endpoints 0.0 and 359.9;
2. the active BLF full path finds a fit whose valid angle is on a tenth degree
   but not a whole degree;
3. a fixed-plan finalist also performs full rotation search rather than using
   only its stored angle;
4. the empty-stock precheck admits a part that fits only at a tenth-degree
   angle, including through a fixed plan;
5. the terminal champion, each order-distinct terminal beam member, and each
   later repair champion receive a full pass even when local refinement does
   not improve;
6. aborting an active full pass returns the last exact-validated champion;
7. the standalone default policy is free and its default final step is 0.1;
8. standalone free search finds a tenth-degree-only optimum and evaluates the
   expected 3,600-angle default grid;
9. explicit fixed, orthogonal, and custom-step policies remain unchanged; and
10. both packages pass their focused tests, full suites, lint, type checks, and
   production builds.

Documentation describing whole-degree final search will be updated to 0.1
degrees. Relevant FULL benchmarks will use the new default; explicit coarse or
comparison configurations remain explicit.

## Acceptance Criteria

- The active app's completed automatic search is not restricted to fixed or
  whole-degree final rotations.
- The terminal champion, every order-distinct terminal beam member, and every
  subsequent repair champion are evaluated across 0.0 through 359.9 degrees at
  0.1-degree resolution with exact placement geometry unless explicitly
  aborted.
- Calling standalone `nest` without a rotation policy uses free 0.1-degree
  final search.
- Explicit restrictive rotation policies continue to be honored.
- Cancellation never publishes a partially evaluated layout.
