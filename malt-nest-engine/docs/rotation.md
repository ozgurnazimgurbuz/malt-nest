# Free-Angle Rotation (ETAP 5)

UI-independent rotation. Nesting calls **RotationSearch**; it does not embed a giant `for (angle)` monolith.

## Rotation model

```ts
RotationPolicy =
  | { kind: 'none' }
  | { kind: 'fixed'; anglesDeg: number[] }
  | { kind: 'orthogonal' }          // [0,90,180,270]
  | { kind: 'free'; free?: FreeAngleConfig }
```

`Placement.position` remains **world centroid**. Pipeline unchanged: `T(−C) → R(θ) → T(P)`.

## Angle normalization

- `normalizeDeg`: map to `[0, 360)`; `360≡0`; negatives wrap.
- `canonicalizeAngle`: snap with `AnglePrecision.decimals` (default **4**) for cache keys / equality.
- No hard-coded epsilons outside `AnglePrecision` / `GeometryTolerance`.

## Free-angle cascade

| Stage | Default | Role |
|-------|---------|------|
| Coarse | step **15°** | Full-circle sample + baselines |
| Refine | **±15° @ 5°** around seeds | Local densify |
| Final | full circle @ **0.1°** | Exhaustive configured-resolution coverage (3,600 normalized samples) |

### Top-K / safety (anti legacy bias)

Seeds for refine are **not** only coarse winners:

1. **baseline angles** (default `[0]`) — always kept, even if that exact angle failed  
2. **coarseTopK** best *valid* placements by real score  
3. **diversityCount** extra valid angles farthest on the circle  

Coarse score is a **search-order hint**, not a final quality gate. The final
stage evaluates the complete circle at `finalStepDeg`, so narrow feasible
intervals cannot be discarded with the coarse survivors.

## Candidate evaluation (per angle)

1. Rotate about centroid  
2. Inner NFP (sheet) + Outer NFP (placed, gap)  
3. Free-region candidates  
4. `validatePlacement`  
5. Score: valid → min Y → min X → min packed AABB → min angle  

## NFP cache

Session LRU bounded by 512 entries and 100,000 retained NFP points, keyed by a
fixed-size geometry/topology digest, canonical poses, gap, and tolerance.
Identical geometry with distinct public IDs shares pose-equivalent entries.
Diagnostics: `cacheHits` / `cacheMisses`.

## Baseline floor

When `free.baselineFloor !== false` (default **true**):

1. Run free cascade  
2. Run orthogonal  
3. Keep better by: placed↓ → sheets↑ → utilization↓ → packedBounds↑

If free is worse, orthogonal wins. Guard only — not a GA.
The returned config remains the caller's free policy, and work counters/runtime
aggregate both attempts.

Steps must be finite and positive at the configured canonical precision;
`coarseTopK`/`diversityCount` are nonnegative safe integers, baseline angles are
finite, and precision decimals must fit the safe `[0, 360)` numeric grid. The
final grid is streamed and only the running best placement score is retained.
Each of the three stages is bounded at 100,000 samples (with refinement's
worst-case count checked up front), so an exact 100,000-sample final grid may
still use small bounded coarse/refine overhead. Caller-requested `0.01°`
remains supported (36,000 final samples); configurations whose individual
stage exceeds the resource bound are rejected before placement/NFP work.

## Determinism

Same parts + sheet + policy → same angles and placements. No randomness.

## UI independence

Engine accepts `rotation: { kind: 'free' }` with **no UI**. UI may later send the same policy object.

## Limitations

- Discrete 0.1° default (3,600 normalized samples; configurable `finalStepDeg`; finer grids cost more)
- Candidate vertices may miss continuous optima  
- Demo oversized AABB parts still need geometry/sheet changes or denser angles  
- Baseline floor doubles work when enabled  
