# Stage 10E — Dense Concave Minkowski Optimization

## ROOT CAUSE

Clipper `minkowskiDiffD` builds **|A|×|B| quads** then boolean-unions them (`Minkowski.ts`). Cost is dominated by vertex product, not decomposition (decomp is fallback only; primary path is `minkowski-clipper`).

On Demo.svg, spacing offset used `JoinType.Round` with **miswired args**: 6th parameter was `precision=3`, so `arcTolerance` stayed **0** → Clipper densified round corners (**110 → 241 verts**). Then 241×110 ≈ 26k quads → **~1.5 s** per `part-12×part-8` call.

| Internal step (110×110, baseline) | ms |
| --- | ---: |
| offset (+5mm Round) | ~5 |
| path build | ~0 |
| **minkowskiDiffD** | **~1600** |
| convert/normalize | ~0.3 |

Convex decomp fallback unused on success path (would be worse: ~239×108 pieces).

## CHANGE

1. **`clipperInflate` → `JoinType.Miter` (miterLimit=4)** — stops Round arc densification; offset verts stay ≈ input (110→~108). Miter flares at sharp corners (≥ Round) → spacing envelope stays conservative; final `solidsCollide(..., spacing)` still enforces gap.
2. **`simplifyRingForMinkowski`** before `minkowskiDiffD`: exact collinear strip + closed-ring **RDP ε=0.5 mm** when verts > 32 (Hausdorff budget ≪ 5 mm spacing). Covered by `minkowskiSimplify.test.ts`.
3. NFP cache **not** used as the main fix (Stage 10D: ≤11.7% / ~0.6 s).

## BEFORE → AFTER (Demo.svg, 2050×3050, gap 5, margin 10, orthogonal, FAST)

| metric | baseline | after |
| --- | ---: | ---: |
| BLF wall | **36.15 s** | **6.69 s** |
| NFP time | 29.48 s | 2.08 s |
| Minkowski | 456 · 29407 ms | 456 · 2037 ms |
| part-12↔part-8 NFP | 4934 ms | 419 ms |
| micro 12@180×8@90 | ~1510 ms | ~130 ms |
| placed | 16/16 | 16/16 |
| sheets | 1 | 1 |
| util | 6.70% | 6.70% |

Intermediate opts: Round+arcTol ≈18.8 s → Miter ≈12.0 s → Miter+RDP0.5 ≈6.7 s.

## ACCURACY CHECK

- Pairwise `solidsCollide(a, b, 5)` false on final nest
- 16/16 placed, 1 sheet, util 6.70% (same headline as baseline)
- Stage 6/7 geometry + BLF unit tests green
- RDP: max edge deviation ≤ 0.5 mm on synthetic dense ring

## Options A–H (evaluation)

| | Option | Verdict |
| --- | --- | --- |
| A | Better convex decomp | N/A — not on hot path |
| B | Fewer verts | **Done** (Miter + RDP) |
| C | Collinear simplify | **Done** (exact strip + RDP) |
| D | Fewer Minkowski pairs | Indirect via fewer verts (Clipper still n×m) |
| E | Smaller Clipper union input | **Done** (fewer quads) |
| F | Rotation transform reuse | Skipped — low repeat within one BLF |
| G | Exact convex path | Already used when both convex |
| H | Hybrid concave NFP | Not needed after B/C |

## Remaining (not this stage)

After Minkowski cut, **collision/candidate** time (~4 s) is a larger share of the ~6.7 s BLF (edgeVertex returned because NFP boundaries are leaner). Separate follow-up if sub-3 s needed.

## Files

- `src/geometry/backend/clipperAdapter.ts` — Miter inflate + Minkowski pre-simplify
- `src/geometry/minkowskiSimplify.test.ts` — RDP tolerance check
- `docs/benchmarks/stage-10e-minkowski-profile.md` — pre-opt internal profile
- `docs/benchmarks/stage-10e-after-opt2.md` / `stage-10e-after-opt3.md` — step benches
