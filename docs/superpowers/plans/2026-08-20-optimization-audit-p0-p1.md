# Nesting Audit P0/P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production Malt Nest optimizer deadline-aware, bounded in free-angle work, more selective in placement validation, and independently safe to export.

**Architecture:** Keep the current TypeScript/Clipper geometry and single-worker façade. Add one cooperative deadline passed through the optimizer and BLF, replace only the automatic terminal sweep with bounded geometry-guided refinement, rank a bounded candidate pool before exact validation, and use a small per-sheet uniform-grid broad phase. Preserve explicit `freeAngleDepth: 'full'` as an opt-in diagnostic API. Remove repeated suffix replay from the default path and replace it with a bounded future-fit estimate.

**Tech Stack:** TypeScript, React/Vite, Vitest, clipper2-ts.

---

### Task 1: Add failing deadline and bounded-terminal tests

**Files:**
- Modify: `src/nesting/types.ts`
- Modify: `src/nesting/optimization/automaticOptimizer.test.ts`
- Modify: `src/nesting/placement/blf.test.ts`
- Modify: `src/nesting/optimization/rotations.test.ts`

- [x] Add tests for a request budget, automatic terminal work not requesting `full`, and BLF returning its last valid snapshot after deadline expiry.
- [x] Run the focused tests and confirm the new assertions fail for the current implementation.
- [x] Keep explicit direct `freeAngleDepth: 'full'` coverage unchanged.

### Task 2: Implement the cooperative deadline

**Files:**
- Create: `src/nesting/optimization/deadline.ts`
- Modify: `src/nesting/types.ts`
- Modify: `src/nesting/core/validate.ts`
- Modify: `src/nesting/request.ts`
- Modify: `src/nesting/optimization/convergence.ts`
- Modify: `src/nesting/optimization/automaticOptimizer.ts`
- Modify: `src/nesting/placement/blf.ts`
- Modify: `src/nesting/nfp/candidates.ts`

- [x] Add a positive finite `timeLimitMs` request setting with the existing 5 s production default.
- [x] Pass one clock-compatible deadline through automatic evaluations and BLF loops.
- [x] Check it at part, orientation, candidate, NFP-boundary, and stock-search checkpoints.
- [x] Return the last exact-valid result as `bestSoFar` on expiry/cancellation.
- [x] Run focused tests and typecheck.

### Task 3: Replace automatic exhaustive terminal rotation

**Files:**
- Modify: `src/nesting/optimization/rotations.ts`
- Modify: `src/nesting/placement/blf.ts`
- Modify: `src/nesting/optimization/automaticOptimizer.ts`
- Test: `src/nesting/optimization/rotations.test.ts`
- Test: `src/nesting/optimization/automaticOptimizer.test.ts`

- [x] Add bounded event-angle candidates from part edge orientations plus the existing orthogonal/coarse anchors.
- [x] Add an internal bounded terminal depth using local 1-degree refinement.
- [x] Route automatic finalist/repair work through that depth; leave explicit `full` for diagnostics only.
- [x] Remove full-grid stock-fit precomputation from the automatic path.
- [x] Verify no automatic call requests `full`.

### Task 4: Rank a bounded candidate pool before exact validation

**Files:**
- Modify: `src/nesting/placement/blf.ts`
- Add/modify: `src/nesting/placement/blf.test.ts`

- [x] Add a failing test where pack-bias order and envelope growth disagree.
- [x] Rank candidates by explicit pack bias, then incremental used envelope and stable coordinates.
- [x] Exact-check a bounded top pool, retain the best valid candidate, and fall back to the remaining candidates if the pool has no valid result.
- [x] Preserve attempt telemetry and exact placement validity.

### Task 5: Bound suffix lookahead and add sheet collision indexing

**Files:**
- Create: `src/geometry/collisionIndex.ts`
- Modify: `src/nesting/placement/blf.ts`
- Test: `src/geometry/collisionIndex.test.ts`
- Test: `src/nesting/placement/blf.test.ts`

- [x] Add a uniform-grid index for placed-solid AABBs with clone support for simulations.
- [x] Query only possible colliders before exact spacing/overlap checks.
- [x] Replace complete suffix replays with a bounded next-part fit/regret estimate; retain the existing exact matching/area guards.
- [x] Verify the existing 60-part shareable-stock timing test and all stock-assignment fixtures.

### Task 6: Harden cache keys and export validation

**Files:**
- Modify: `src/geometry/cache.ts`
- Modify: `src/export/validation/validateExport.ts`
- Modify: `src/export/svg/serialize.ts`
- Modify: `src/export/svg.export.test.ts`
- Modify: `src/nesting/types.ts` if request metadata is required

- [x] Canonicalize equivalent rotation values in NFP keys without rounding distinct valid angles.
- [x] Extend export validation with optional margin and spacing checks using the same exact solid predicates.
- [x] Retain request geometry metadata on results for export validation.
- [x] Add regression tests for margin and spacing violations.

### Task 7: Make repair rotation-aware and verify the full suite

**Files:**
- Modify: `src/nesting/optimization/destroyRepair.ts`
- Modify: `src/nesting/optimization/automaticOptimizer.ts`
- Modify: `src/nesting/optimization/destroyRepair.test.ts`

- [x] Add a bounded rotation mutation/removal operator using already prepared rotations.
- [x] Keep the current deterministic fallback and exact replay gate.
- [x] Run `npm test`, `npm run build`, and `npm run lint`.
- [x] Record benchmark-only research ideas (ML, GPU, WASM, persistent cache, multi-worker portfolio) as deferred until fixed-budget evidence justifies them.
