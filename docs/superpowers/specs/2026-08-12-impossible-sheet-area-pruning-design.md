# Impossible-Sheet Material-Area Pruning

Date: 2026-08-12
Status: User-selected design
Amends: `2026-08-12-frame-paced-nesting-playback-design.md`

## Problem

Production profiling proved that Canvas playback is frame-cheap and responsive,
but the nesting worker can emit millions of attempts for existing sheets that
cannot contain the next part under any position or rotation. The canonical BLF
path and its future-stock simulations both enter `findEntryPlacement` without a
material-capacity check, so they perform angle, NFP, collision, and telemetry
work after placement is already mathematically impossible.

Lossless one-attempt-per-frame playback makes that redundant work visible as a
multi-hour queue. Dropping or sampling attempts would hide the cause and violate
the approved playback semantics.

## Selected Approach

Add one necessary-condition guard at the shared `findEntryPlacement` seam. Before
searching any rotation or candidate on a sheet, compare:

```
sum(net material area of placed parts) + net material area of candidate
    <= usable sheet area + conservative area tolerance
```

When the inequality is false, return no placement immediately. No attempt record
is emitted because no position was tried. Both production placement and suffix
simulation already route through this function, so no caller-specific guards or
new cache are needed.

The guard uses the validator's shared relative metadata tolerance rather than
copying its private `1e-6` contract. For a reported positive material area `a`,
the conservative validated lower bound is:

```
lower(a) = max(0, a - metadataRelativeTolerance * max(1, abs(a)))
```

For `n = placed parts + candidate`, let `lowerTotal` be the sum of these lower
bounds, `boundaryLength` be the sum of every outer and hole perimeter,
`ringCount` be the number of those outer and hole rings, and `w × h` be the
usable sheet rectangle. The active closed-polygon containment predicate admits
points up to `10 * geomEps()` from a boundary, which is the largest relevant
linear tolerance. Define `t = 10 * geomEps()`. The maximum admitted area is:

```
expandedSheetArea = (w + 2t) * (h + 2t)
collisionSlackMm2 = 2t * boundaryLength + PI * ringCount * t²
roundoffMm2 = 16 * Number.EPSILON * n
                * max(1, lowerTotal, expandedSheetArea + collisionSlackMm2)
```

The strict prune predicate is:

```
lowerTotal > expandedSheetArea + collisionSlackMm2 + roundoffMm2
```

Using the maximum `t` for `expandedSheetArea` is intentionally more conservative
than rectangular-sheet containment, which currently admits only `geomEps()`.
`collisionSlackMm2` covers the two-sided tolerance-width boundary band of every
outer and hole ring, including the host-hole boundary that part-in-part treats as
containment rather than a host collision. `roundoffMm2` prevents the comparison
itself from rejecting a capacity equality after floating-point summation. Every
term compared with material area is in square millimetres.

## Correctness

Every accepted part material lies inside the usable sheet rectangle, and accepted
part interiors do not overlap. Therefore their combined net material area cannot
exceed the usable sheet area, apart from the engine's documented numeric
tolerance. Rotation and translation preserve net area.

Holes do not invalidate the invariant. A host contributes only its outer area
minus its holes; a guest placed in a hole contributes its own material area. The
two materials remain disjoint, so their areas still add. The guard must use net
material area rather than outer-ring area, bounding-box area, or occupied bounds.

Requests already pass canonical geometry validation before BLF preparation. The
validator and BLF must share the metadata-relative-tolerance definition so the
accepted contract cannot drift. The guard is a rejection-only optimization: any
sheet that passes it follows the unchanged placement pipeline, candidate order,
scoring, and telemetry order.

## Scope

- Modify the active BLF implementation, its focused tests, and the validator's
  tolerance definition only as needed to share the existing contract.
- Put the guard before every rotation/NFP attempt inside `findEntryPlacement`.
- Preserve worker batching and the frame-paced browser queue unchanged.
- Preserve final nesting output and deterministic ordering.

## Non-goals

- Do not estimate free space from bounding boxes or other heuristics.
- Do not drop, sample, merge, or cap real placement attempts.
- Do not introduce worker backpressure or pause computation for animation.
- Do not add a second placement path, cache, or configurable threshold.

## Verification

Tests must first fail without the guard and then prove:

1. After an 8×8 part occupies a 10×10 sheet, a second 8×8 part produces no
   attempt on that sheet, opens the next available sheet, and the traced result
   remains identical to the untraced result.
2. A valid part-in-part case whose summed net material area fits the sheet is not
   pruned and still places both parts.
3. Margin-reduced usable area is used rather than gross sheet area.
4. Exact capacity is not pruned, and maximum validator-accepted area-metadata
   drift remains eligible.
5. A non-default `geomEps()` is converted through the stated boundary-area
   formula; a case just inside the allowance remains eligible and a case just
   beyond the complete allowance is pruned.
6. With a non-default epsilon, a host filling a sheet has a rectangular hole and
   a guest exceeds the hole width by no more than the containment tolerance. The
   existing part-in-part predicate accepts the near-boundary fit even though host
   net area plus guest area slightly exceeds exact sheet capacity; the area guard
   must not prune it.
7. A fixture that enters suffix simulation with an impossible existing sheet
   proves, through an existing geometry-call spy or equivalent observation, that
   candidate enumeration is skipped while placement count and order remain
   unchanged. No production-only diagnostic hook is added.
8. Existing BLF, attempt telemetry, validation, and nesting suites remain green.
9. The same 50-part/48-vertex production profile is repeated. Record worker
   completion, total attempts, peak playback backlog, drain time, RAF callback
   p95/p99, input latency, long tasks, and post-GC heap.

## Acceptance Criteria

- A sheet is skipped only when material area proves placement impossible.
- Skipped impossible sheets emit zero candidate attempts.
- Valid ordinary and part-in-part results are unchanged.
- Every candidate position that is actually tried is still transported and
  displayed on its own animation frame.
- The representative browser profile completes within the existing three-minute
  diagnostic threshold, or any remaining measured bottleneck is reported rather
  than hidden with attempt loss.
