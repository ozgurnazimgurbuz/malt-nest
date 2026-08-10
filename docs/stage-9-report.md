# Stage 9 Final Report — Advanced Nesting Optimization

**Date:** 2026-08-10  
**Status:** Complete (STOP — do not start Stage 10)  
**Verification:** 146/146 tests, oxlint clean, `tsc -b` + Vite production build OK, dev server on :5175

---

## 1. Stage 8 baseline

Permanent record: `docs/benchmarks/stage-9-baseline.md`  
Stage 7/8 fixture suite preserved; Stage 8 engine numbers frozen before Stage 9 optimizer work.

## 2. Stage 9 architecture

```
SVG → GeometryPart[] → Worker (evolutionary)
  → multi-start seeds → GA (shared eval cache)
  → local search → optional destroy/repair
  → best-so-far ≥ BLF baseline
Main thread: progress / cancel / final NestingResult
```

Key modules:

- `optimization/rotations.ts` — angle strategies
- `optimization/population.ts` — heuristic + multi-start seeds
- `optimization/geneticOptimizer.ts` — multi-start GA + phases
- `optimization/localSearch.ts` / `destroyRepair.ts`
- `scoring/weights.ts` + `scoring/SCORE.md`
- `geometry/fabFixtures.ts` — fab A–J

## 3. Rotation strategy

| Mode | Angles |
| --- | --- |
| Orthogonal (default / FAST UI) | 0 / 90 / 180 / 270 |
| Balanced | 45° steps |
| Deep | geometry-derived adaptive set (bounded ≤28) |

Engine accepts `rotationMode`, `angleStep` / `rotationStepDeg`, or `allowedRotationsExplicit`. No hard-coded lists in BLF/GA loops.

## 4. Initial population

Kept prior BLF + area/width/height/perimeter/random seeds; added longest-edge, compactness, hole-aware, multi-start distinct heuristics. Each seed produces a valid BLF placement plan.

## 5. Multi-start

| Preset | Starts | Local search | Destroy/repair | Budget |
| --- | ---: | --- | --- | ---: |
| Fast | 2 | yes | no | ~0.5s |
| Balanced | 4 | yes | yes | ~2s |
| Deep | 8 | yes | yes | ~10s |

Shared evaluation cache; distinct RNGs per start.

## 6. Local search

Bounded ops: swap, rotate gene, reverse segment, reinsert. Accept only official score improvements. Time-fraction limited unless `deterministic`.

## 7. Destroy / repair

LNS-style remove ~5–20% (adaptive), reorder/rotate, reinsert via BLF plan. Enabled on balanced/deep.

## 8. Score changes

Priority: unplaced → sheets → waste → compactness.

Weights: `unplaced=1e7`, `sheet=1e6`, `waste=1.5`, `compactness=0.15`.  
Breakdown: `{ unplacedPenalty, sheetPenalty, wastePenalty, compactnessPenalty, total }`.  
Docs: `src/nesting/scoring/SCORE.md`.

## 9. Multi-sheet

Sheet count dominated by score. Gene order/rotation explores packing that can reduce sheets (BLF fill order). No explicit “move part sheet 1↔2” operator beyond order edits + LNS; score prefers fewer sheets when material allows.

## 10. Part-in-part

Default `allowPartInPart=false`. When on: hole-aware seed + BLF hole placement. UI toggle.

## 11–14. Benchmarks / util / waste / runtime

See:

- `docs/benchmarks/stage-9-baseline.md`
- `docs/benchmarks/stage-9-fixtures-after.md`
- `docs/benchmarks/stage-9-after.md` (fab A–J)
- `docs/benchmarks/stage-9-comparison.md`
- `docs/benchmarks/stage-9-before-after.md`

**Findings (evidence over feature count):**

- Unplaced never increases; evo score ≤ BLF on all tested fixtures.
- Geometry suite: mostly compactness score wins at fixed 1 sheet / same util (sheets oversized vs parts).
- Fab A–J @ fast/500ms: sheets/waste often tied with BLF; score wins on B/G/I.
- Runtime: evolutionary ≈ budget; Worker bundle ~105KB.

Candidate quality: removed blind hard CAP that regressed circles to 4 sheets; dense rings now sample vertex pairs while keeping NFP boundary + edge contacts.

## 15. Worker performance

Expensive work stays in Worker. Progress throttled (~80ms): generation, bestScore, utilization, sheetCount, elapsedMs — no full geometry payloads.

## 16. Cancellation

STOP → abort signal → `cancelled` + `bestSoFar` valid result. Worker clears active id / abort flag. Regression in `optimizer.test.ts`.

## 17. Determinism

`seed` + optional `deterministic` (debug UI): generation/op limits only, ignore wall-clock truncation. Same seed ⇒ same placements under deterministic mode.

## 18. Tests

**146** tests (was 136 at Stage 8). New: Stage 9 rotations/local/LNS/determinism/spacing nest, fab A–J, cancel/determinism hardened.

## 19. Remaining limitations

- Fast budget often cannot beat BLF on sheet count for large fab sets.
- Cross-sheet moves are order-mediated, not explicit relocation search.
- Concave NFP still Clipper Minkowski (`exact: false`).
- Part-in-part not searched deeply in GA beyond hole-aware seed + BLF.
- Local-search moves not streamed to debug canvas (Worker-only); debug shows NFP candidates / selected / rejected.
- Pure wall-clock mode is not bit-identical across machines/JIT.

## 20. Recommended Stage 10

1. Remnants / offcut reuse  
2. Kerf compensation  
3. Common-line cutting (explicitly deferred)  
4. Cutting order / travel  
5. DXF export (explicitly deferred)  
6. Harder packing benchmarks + deeper budgets as default for production jobs  
7. Optional exact cross-sheet LNS when sheetPenalty dominates

---

## UI (Stage 9)

Optimization: Fast / Balanced / Deep  
Rotation: Orthogonal / Balanced / Deep  
Part-in-part: Off / On  
Debug: seed, deterministic budget, geom candidate overlay  

No DXF, no common-line, no auth/cloud/DB, no SVG export redesign.
