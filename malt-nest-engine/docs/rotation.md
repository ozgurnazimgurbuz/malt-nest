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
| Final | **±5° @ 1°** around seeds/best | Fine polish |

### Top-K / safety (anti legacy bias)

Seeds for refine are **not** only coarse winners:

1. **baseline angles** (default `[0]`) — always kept, even if that exact angle failed  
2. **coarseTopK** best *valid* placements by real score  
3. **diversityCount** extra valid angles farthest on the circle  

Coarse score is a **pruning hint**, not final quality. Final pick uses full placement eval.

## Candidate evaluation (per angle)

1. Rotate about centroid  
2. Inner NFP (sheet) + Outer NFP (placed, gap)  
3. Free-region candidates  
4. `validatePlacement`  
5. Score: valid → min Y → min X → min packed AABB → min angle  

## NFP cache

Session `Map` keyed by  
`kind|stationaryId|orbitingId|canon(rotA)|canon(rotB)|gap`  
Diagnostics: `cacheHits` / `cacheMisses`.

## Baseline floor

When `free.baselineFloor !== false` (default **true**):

1. Run free cascade  
2. Run orthogonal  
3. Keep better by: placed↓ → sheets↑ → packedBounds↑  

If free is worse, orthogonal wins. Guard only — not a GA.

## Determinism

Same parts + sheet + policy → same angles and placements. No randomness.

## UI independence

Engine accepts `rotation: { kind: 'free' }` with **no UI**. UI may later send the same policy object.

## Limitations

- Discrete 1° floor by default (configurable `finalStepDeg`)  
- Candidate vertices may miss continuous optima  
- Demo oversized AABB parts still need geometry/sheet changes or denser angles  
- Baseline floor doubles work when enabled  
