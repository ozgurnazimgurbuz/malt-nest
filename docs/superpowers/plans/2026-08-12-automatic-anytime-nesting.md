# Automatic Anytime Nesting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace user-selected optimization modes with one anytime nesting policy that publishes a fast exact-validated seed, improves it monotonically, and stops on convergence.

**Architecture:** Keep the existing BLF/NFP geometry and worker boundary. Add a small convergence controller and bounded beam search, then orchestrate seed placement, simplified ranking, exact replay, and adaptive destroy/repair in a new automatic optimizer. Remove the unused evolutionary population machinery after all callers move to the automatic engine.

**Tech Stack:** TypeScript 6, Vitest, Web Workers, existing Clipper2 geometry backend, existing BLF/NFP placement and canonical scoring.

---

## File Structure

- Create `src/nesting/optimization/convergence.ts`: deterministic evaluation and wall-clock stopping policy.
- Create `src/nesting/optimization/convergence.test.ts`: focused stopping-policy checks with an injected clock.
- Create `src/nesting/optimization/beamSearch.ts`: bounded distinct-order neighbor generation and ranking.
- Create `src/nesting/optimization/beamSearch.test.ts`: beam-width, deduplication, and move checks.
- Create `src/nesting/optimization/automaticOptimizer.ts`: anytime orchestration and exact champion publication.
- Create `src/nesting/optimization/automaticOptimizer.test.ts`: seed-first, monotonic champion, fallback, convergence, cancellation, and determinism checks.
- Modify `src/nesting/placement/blf.ts`: reuse prepared parts and add per-part exact retry for simplified candidate generation.
- Modify `src/nesting/placement/blf.test.ts`: prove exact retry only occurs after simplified placement failure.
- Modify `src/nesting/optimization/destroyRepair.ts`: expose one bounded repair candidate and operator identity so the orchestrator can adapt weights.
- Modify `src/nesting/optimization/destroyRepair.test.ts`: check bounded, valid repair moves and weight updates.
- Modify `src/nesting/request.ts`, `src/nesting/types.ts`, `src/nesting/core/validate.ts`: remove mode/time-limit production settings after automatic routing is ready and construct one free-rotation automatic request.
- Modify `src/state/types.ts`, `src/state/defaults.ts`, `src/state/index.ts`, `src/ui/SettingsPanel.tsx`: remove optimization selection.
- Modify `src/App.tsx`, `src/ui/nestProgress.ts`, `src/ui/nestProgress.test.ts`: remove mode labels and show automatic phases.
- Replace `src/nesting/engines/evolutionaryEngine.ts` with `automaticEngine.ts`; modify worker, engine, and index files to route execution through `runAutomaticNest` and use automatic engine IDs.
- Modify request, validation, worker, fixture, integration, and benchmark tests that construct `NestingSettings` directly.
- Delete `src/nesting/optimization/geneticOptimizer.ts`, `presets.ts`, `population.ts`, `crossover.ts`, and `selection.ts` after callers and relevant behavior tests migrate.

### Task 1: Remove the User Optimization Mode

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/state/defaults.ts`
- Modify: `src/state/index.ts`
- Modify: `src/ui/SettingsPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/nesting/request.ts`
- Modify: `src/nesting/request.test.ts`
- Modify: `src/nesting/types.ts`

- [ ] **Step 1: Write the failing user-settings test**

Change the production request test to build `NestSettings` without
`optimizationLevel` and assert automatic free rotation remains enabled. Keep
the engine-only compatibility fields until Task 7 replaces the legacy
optimizer, so every intermediate commit still builds:

```ts
it('builds one automatic free-rotation request', () => {
  const request = toNestingRequest([part], DEFAULT_SHEET, DEFAULT_NEST)
  expect(request.settings.rotationMode).toBe('free')
  expect(request.settings.allowedRotations).toEqual(coarseFreeAngles())
})
```

- [ ] **Step 2: Run the boundary tests and verify they fail**

Run: `npm test -- --run src/nesting/request.test.ts`

Expected: FAIL because `DEFAULT_NEST` and `NestSettings` still require the mode.

- [ ] **Step 3: Remove the mode from user-facing settings**

Make `NestSettings` contain only `gapMm`, `marginMm`, `allowPartInPart`, `seed`,
and `deterministic`. Delete `UiOptimizationLevel` and
`OPTIMIZATION_OPTIONS`. Remove the Optimization `<select>` from
`SettingsPanel`.

Until Task 7 replaces the legacy optimizer, `toNestingRequest` supplies fixed
internal compatibility values `optimizationLevel: 'fast'` and
`timeLimitMs: 5_000`. They are not user settings and are deleted with the
legacy optimizer in Task 8.
Keep `rotationMode: 'free'`, the coarse angle list, arbitrary rotation, and
pack bias.

`App.handleAutoNest` also supplies the fixed internal `'fast'` label to the
legacy `nestUiPreparing` signature until Task 7 removes that argument. It must
not read an optimization level from `NestSettings`.

- [ ] **Step 4: Update direct test fixtures mechanically**

Remove `optimizationLevel` only from user `NestSettings` literals. Do not
change engine `NestingSettings` fixtures yet.

- [ ] **Step 5: Run boundary and type checks**

Run: `npm test -- --run src/nesting/request.test.ts`

Expected: PASS.

Run: `npx tsc -b --pretty false`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/state src/ui/SettingsPanel.tsx src/App.tsx src/nesting/request.ts src/nesting/request.test.ts src/nesting/types.ts
git commit -m "refactor: remove nesting optimization modes"
```

### Task 2: Retry Failed Simplified Placements with Exact Candidates

**Files:**
- Modify: `src/nesting/placement/blf.ts`
- Modify: `src/nesting/placement/blf.test.ts`

- [ ] **Step 1: Write the failing exact-fallback test**

Extract the existing dense-contact fixture helper in `blf.test.ts`, then add a
case whose simplified boundary omits the only usable contact. Run BLF with:

```ts
const result = runBottomLeftNest(request, {
  nfpFidelity: 'simplified',
  exactFallback: true,
})

expect(result.status).toBe('ok')
if (result.status !== 'ok') return
expect(result.statistics.unplacedCount).toBe(0)
expect(result.placements).toEqual(exact.placements)
```

Also assert a fixture that succeeds through simplified candidates does not
invoke the exact retry by passing a test-only `onExactFallback` observer.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run src/nesting/placement/blf.test.ts`

Expected: FAIL because `exactFallback` and the observer do not exist.

- [ ] **Step 3: Add the minimal BLF fallback**

Extend `BlfOptions`:

```ts
exactFallback?: boolean
/** Diagnostic observer used by tests/profiling. */
onExactFallback?: (partId: string) => void
/** Internal optimizer reuse; must correspond to this request. */
preparedParts?: PreparedPart[]
```

In `findEntryPlacement`, try the configured fidelity first. If it returns null
and `options.exactFallback && !exactNfp`, notify the observer and repeat the
same variant/depth with `exactNfp: true`. Do not retry after abort and do not
change already accepted simplified placements.

In `runBottomLeftNest`, `placeWithOrderUnchecked`, and
`placeWithPlanUnchecked`, use `options.preparedParts` instead of calling
`prepareParts` when supplied. Sorting must happen in the automatic optimizer;
the internal methods must not mutate the supplied array.

- [ ] **Step 4: Run placement and geometry tests**

Run: `npm test -- --run src/nesting/placement/blf.test.ts src/geometry/geometry.stage7.test.ts src/geometry/minkowskiSimplify.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/nesting/placement/blf.ts src/nesting/placement/blf.test.ts
git commit -m "feat: retry failed quick placements exactly"
```

### Task 3: Add the Convergence Controller

**Files:**
- Create: `src/nesting/optimization/convergence.ts`
- Create: `src/nesting/optimization/convergence.test.ts`

- [ ] **Step 1: Write failing stopping-policy tests**

Cover abort, mandatory-order completion, deterministic non-improvement limit,
champion reset, twice-seed-time stagnation with a 100 ms floor, and the
non-deterministic 5-second safety ceiling. Use an injected numeric `nowMs`; do
not use timers.

```ts
const state = createConvergenceState({
  partCount: 10,
  deterministic: false,
  startedAtMs: 0,
})
recordFirstChampion(state, 40)
expect(shouldStop(state, 119, false)).toBe(false)
expect(shouldStop(state, 140, false)).toBe(true)
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- --run src/nesting/optimization/convergence.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure controller**

Use this state shape:

```ts
export type ConvergenceState = {
  deterministic: boolean
  startedAtMs: number
  firstChampionMs: number | null
  lastImprovementMs: number | null
  evaluations: number
  evaluationsSinceImprovement: number
  evaluationLimit: number
  requiredOrdersComplete: boolean
}
```

Set `evaluationLimit = Math.max(64, partCount * 4)`. `recordEvaluation`
increments both counters; `recordChampion` resets only
`evaluationsSinceImprovement`; `recordFirstChampion` initializes both champion
times. `markRequiredOrdersComplete` resets `evaluationsSinceImprovement` so the
limit applies only to subsequent search. `shouldStop` checks abort first. Before
required orders complete, deterministic runs continue, while non-deterministic
runs may stop on either twice-seed-time stagnation or the 5,000 ms safety
ceiling. Afterward, both modes also stop after `evaluationLimit` consecutive
non-improving evaluations. Deterministic mode ignores all wall-clock
conditions. Total `evaluations` is diagnostic and never a stopping condition.

- [ ] **Step 4: Run the focused tests**

Run: `npm test -- --run src/nesting/optimization/convergence.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/nesting/optimization/convergence.ts src/nesting/optimization/convergence.test.ts
git commit -m "feat: add automatic nesting convergence policy"
```

### Task 4: Add a Bounded Order Beam

**Files:**
- Create: `src/nesting/optimization/beamSearch.ts`
- Create: `src/nesting/optimization/beamSearch.test.ts`
- Modify: `src/nesting/optimization/mutation.ts`

- [ ] **Step 1: Write failing beam tests**

Test that `expandOrder` returns valid permutations containing adjacent swap,
arbitrary swap, and remove/reinsert moves; that duplicates are removed by
`individualKey`; and that `selectBeam(candidates, 4)` returns at most four
canonically best distinct candidates.

```ts
const next = expandOrder(sample, createRng(7))
expect(next.every((item) => isValidIndividual(item, ids, rotations))).toBe(true)
expect(new Set(next.map((item) => item.order.join(','))).size).toBe(next.length)
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run src/nesting/optimization/beamSearch.test.ts`

Expected: FAIL because `beamSearch.ts` does not exist.

- [ ] **Step 3: Implement the smallest bounded beam helpers**

Reuse `swapMutation` and `insertionMutation`; add an adjacent-swap helper only
if neither seeded mutation produces it deterministically. `expandOrder` should
return at most three neighbors. `selectBeam` sorts with
`compareNestingResults`, removes duplicate individual keys, and slices to the
requested width. Keep the beam width at the call site rather than introducing
configuration.

- [ ] **Step 4: Run beam and mutation tests**

Run: `npm test -- --run src/nesting/optimization/beamSearch.test.ts src/nesting/optimization/optimizer.test.ts`

Expected: PASS for mutation/beam tests; legacy evolutionary cases may remain
until Task 6 migration.

- [ ] **Step 5: Commit**

```bash
git add src/nesting/optimization/beamSearch.ts src/nesting/optimization/beamSearch.test.ts src/nesting/optimization/mutation.ts
git commit -m "feat: add bounded nesting order beam"
```

### Task 5: Make Destroy/Repair Adaptive and Incremental

**Files:**
- Modify: `src/nesting/optimization/destroyRepair.ts`
- Create: `src/nesting/optimization/destroyRepair.test.ts`

- [ ] **Step 1: Write failing operator-selection tests**

Define four internal operators: random removal, bounds contributors, parts on
the least-efficient extra sheet, and the failed/unplaced suffix. Test weighted
selection with a deterministic RNG, valid repaired permutations, and reward
only when exact champion scoring improves.

```ts
const state = createRepairState()
rewardRepairOperator(state, 'bounds')
expect(state.weights.bounds).toBeGreaterThan(state.weights.random)
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm test -- --run src/nesting/optimization/destroyRepair.test.ts`

Expected: FAIL because incremental repair state does not exist.

- [ ] **Step 3: Replace the deadline loop with one bounded proposal API**

Export:

```ts
export type RepairOperator = 'random' | 'bounds' | 'sheet' | 'unplaced'
export type RepairState = { weights: Record<RepairOperator, number> }

export function proposeRepair(
  start: Individual,
  allowedRotations: readonly number[],
  result: NestingSuccess,
  preparedById: ReadonlyMap<string, PreparedPart>,
  rng: Rng,
  state: RepairState,
): { individual: Individual; operator: RepairOperator }
```

Use each `SheetResult.usedBounds` plus its placements to identify parts whose
`x + rotationDimensions(part, rotation).width` or
`y + rotationDimensions(part, rotation).height` touches the sheet's current
`maxX` or `maxY`. The `sheet` operator removes parts from the used sheet with
the lowest part-area/utilized-area ratio. The `unplaced` operator moves
`result.unplacedPartIds` and the order entries immediately before them toward
the front. Fall back to random removal when an operator has no candidates.
Keep weights small integers, increment the winning operator by one, and decay
all weights by halving when any reaches 16. This avoids a new adaptive-search
framework.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- --run src/nesting/optimization/destroyRepair.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/nesting/optimization/destroyRepair.ts src/nesting/optimization/destroyRepair.test.ts
git commit -m "refactor: make nesting repair incremental"
```

### Task 6: Implement the Automatic Anytime Orchestrator

**Files:**
- Create: `src/nesting/optimization/automaticOptimizer.ts`
- Create: `src/nesting/optimization/automaticOptimizer.test.ts`
- Modify: `src/nesting/optimization/orderSearch.ts`
- Modify: `src/nesting/optimization/orderSearch.test.ts`
- Modify: `src/nesting/placement/blf.ts`
- Modify: `src/nesting/placement/blf.test.ts`

- [ ] **Step 1: Write failing seed and champion tests**

Add tests proving:

- the first `bestSoFar` is emitted during `seed` before `optimize`;
- emitted champions are strictly improving under `compareNestingResults`;
- the final result is never worse than the first champion;
- exact replay rejection does not replace the champion;
- deterministic mode produces identical placements and evaluation count;
- abort returns the current exact champion; and
- convergence ends a non-deterministic run with an injected clock.

Expose only diagnostic options needed for deterministic tests:

```ts
export type AutomaticOptions = {
  onProgress?: (progress: NestProgress) => void
  onAttempt?: (attempt: NestAttempt) => void
  onAttemptFlush?: () => void
  signal?: AbortSignal
  seed?: number
  deterministic?: boolean
  now?: () => number
  onEvaluation?: (info: {
    kind: 'rank' | 'exact'
    elapsedMs: number
    improved: boolean
  }) => void
}
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm test -- --run src/nesting/optimization/automaticOptimizer.test.ts`

Expected: FAIL because `runAutomaticNest` does not exist.

- [ ] **Step 3: Implement prepare and seed publication**

In `runAutomaticNest`, validate the request, prepare parts once with
`sortByArea: true`, and pass the same `preparedParts` array to every BLF call.
Run area-descending BLF first; that call opens the shared geometry session:

```ts
{
  freeAngleDepth: 'orthogonal',
  nfpFidelity: 'simplified',
  exactFallback: true,
  preparedParts,
  engineId: 'automatic-blf-v1',
}
```

Replay the resulting order/rotations with exact NFP fidelity before calling it
the first champion. Exact replay uses the fixed selected rotations—no angle
refinement yet. Call `recordFirstChampion(convergence, now())`, then emit that
champion immediately through `onProgress`.

Add `freeAngleDepth: 'orthogonal'` to BLF as a direct evaluation of
`ORTHOGONAL_ANGLES`; do not change the existing `quick` meaning.

- [ ] **Step 4: Implement deterministic order beam**

Build every existing deterministic order candidate, evaluate it with simplified
NFP and balanced angles, keep the four distinct best candidates, then call
`markRequiredOrdersComplete`. Call `shouldStop` between order candidates:
non-deterministic runs return the current champion immediately on stagnation or
the safety ceiling, while deterministic runs finish the required candidate set.

Run explicit beam layers. For each layer, expand every current beam member with
the three bounded order moves, evaluate the children, and call
`selectBeam([...beam, ...children], 4)`. Compare the ordered individual keys of
the selected beam with the prior layer. The beam is stable when the key list is
unchanged; otherwise run another layer. Call `recordEvaluation` after every
completed child and `shouldStop` between children. If convergence stops beam
expansion, return the current champion immediately. Transition to finalist
refinement only when the beam stabilizes normally.

- [ ] **Step 5: Implement exact champion consideration**

Centralize publication:

```ts
function considerExact(candidate: Individual): void {
  const replay = placeWithPlanUnchecked(request, candidate, {
    nfpFidelity: 'exact',
    preparedParts,
  })
  if (replay.status !== 'ok') return
  if (!isBetterNestingResult(replay, champion)) return
  champion = replay
  recordChampion(convergence, now())
  emitChampion(champion)
}
```

Only call exact replay for a simplified candidate that beats the simplified
score of the current champion or enters the four-member beam.

- [ ] **Step 6: Add finalist rotation refinement**

Add `freeAngleDepth: 'refine'` to BLF. For a plan variant, `refine` evaluates
only the existing ±15-degree/5-degree window around its selected rotation;
`seed` continues through the existing ±5-degree/1-degree final window. For the
champion and remaining beam members, replay `refine` first. Only if that
improves the champion, replay `seed` around the refined rotations. Stop
refinement for a candidate after its first non-improving stage. Cover the new
depth with one focused `blf.test.ts` assertion.

Run this refinement immediately after normal beam stabilization. Extract it as
`refineFinalist(individual)` so later repair champions use the same path. Check
convergence before each finalist; if it is satisfied, return immediately.

- [ ] **Step 7: Add incremental adaptive repair**

After beam finalist refinement, repeatedly call `proposeRepair` on the current
champion gene, rank the proposal cheaply, and exact-replay promising proposals.
Reward the operator only when exact replay produces a new champion. When a
repair proposal becomes the champion, call `refineFinalist` immediately before
the next repair proposal. Check convergence and abort between proposals; when
either stops the loop, return the current champion without another phase.

- [ ] **Step 8: Run automatic optimizer tests**

Run: `npm test -- --run src/nesting/optimization/automaticOptimizer.test.ts src/nesting/optimization/orderSearch.test.ts src/nesting/placement/blf.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/nesting/optimization/automaticOptimizer.ts src/nesting/optimization/automaticOptimizer.test.ts src/nesting/optimization/orderSearch.ts src/nesting/optimization/orderSearch.test.ts src/nesting/placement/blf.ts src/nesting/placement/blf.test.ts
git commit -m "feat: add automatic anytime nesting"
```

### Task 7: Route Engines, Worker, and Progress Through Automatic Nesting

**Files:**
- Create: `src/nesting/engines/automaticEngine.ts`
- Delete: `src/nesting/engines/evolutionaryEngine.ts`
- Modify: `src/nesting/worker/nestWorker.ts`
- Modify: `src/nesting/worker/client.ts`
- Modify: `src/nesting/worker/client.test.ts`
- Modify: `src/nesting/engine.ts`
- Modify: `src/nesting/index.ts`
- Modify: `src/App.tsx`
- Modify: `src/ui/nestProgress.ts`
- Modify: `src/ui/nestProgress.test.ts`

- [ ] **Step 1: Write failing worker/progress tests**

Update worker tests to expect automatic engine IDs and monotonic `bestSoFar`
retention. Update UI progress tests to expect these mode-free mappings:

```ts
expect(seed.title).toBe('İlk yerleşim')
expect(search.title).toBe('Yerleşim iyileştiriliyor')
expect(search.detail).not.toMatch(/Start|Generation|Fast|Balanced|Deep/)
```

Change `nestUiPreparing` to accept `(jobId, partCount, iteration?)`.

- [ ] **Step 2: Run worker and progress tests and verify they fail**

Run: `npm test -- --run src/nesting/worker/client.test.ts src/ui/nestProgress.test.ts`

Expected: FAIL on old evolutionary routing and mode labels.

- [ ] **Step 3: Route direct and worker engines to `runAutomaticNest`**

Create the direct `AutomaticNestingEngine` and use IDs
`automatic-blf-v1` and `automatic-worker-v1`. Update the worker call without
time-limit or generation options. Preserve attempt batching, abort behavior,
stale-job checks, and best-so-far retention unchanged.

- [ ] **Step 4: Remove mode-specific progress presentation**

Ignore legacy `generation`, `multiStartIndex`, `multiStartCount`, and
`optimizationLevel` progress fields in the UI. Map phases to `Initial layout`,
`Trying orders`, `Improving layout`, and `Verifying result` messages supplied
by the automatic optimizer. Update `App.handleAutoNest` so it does not read or
pass a level. The internal fields remain until their last producer is deleted
in Task 8.

- [ ] **Step 5: Run worker, UI, and App tests**

Run: `npm test -- --run src/nesting/worker/client.test.ts src/ui/nestProgress.test.ts src/App.test.tsx`

Expected: PASS. If `src/App.test.tsx` does not exist, run the existing UI test
files returned by `rg --files src | rg 'App|SettingsPanel|nestProgress'`.

Run: `npx tsc -b --pretty false`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/nesting/engines src/nesting/worker src/nesting/engine.ts src/nesting/index.ts src/App.tsx src/ui/nestProgress.ts src/ui/nestProgress.test.ts
git commit -m "refactor: route nesting through automatic optimizer"
```

### Task 8: Remove Legacy Evolutionary Machinery and Migrate Benchmarks

**Files:**
- Delete: `src/nesting/optimization/geneticOptimizer.ts`
- Delete: `src/nesting/optimization/presets.ts`
- Delete: `src/nesting/optimization/population.ts`
- Delete: `src/nesting/optimization/crossover.ts`
- Delete: `src/nesting/optimization/selection.ts`
- Modify: `src/nesting/optimization/optimizer.test.ts`
- Modify: `src/nesting/optimization/stage9.test.ts`
- Modify: `src/nesting/optimization/benchmark.ts`
- Modify: `src/geometry/fabFixtures.ts`
- Modify: `src/geometry/fabFixtures.test.ts`
- Modify: `src/geometry/fixtures.ts`
- Modify: `src/geometry/fixtures.test.ts`
- Modify: `src/nesting/optimization/freeAngle.demo.compare.test.ts`
- Modify: `src/nesting/optimization/freeAngle.orderDepth.profile.test.ts`
- Modify: `src/nesting/types.ts`
- Modify: `src/nesting/request.ts`
- Modify: `src/nesting/request.test.ts`
- Modify: `src/nesting/core/validate.ts`
- Modify: `src/nesting/core/validate.test.ts`
- Modify: `src/nesting/placement/blf.ts`
- Modify: `src/ui/nestProgress.ts`
- Modify: `src/ui/nestProgress.test.ts`
- Create: `docs/benchmarks/automatic-anytime-baseline.json`

- [ ] **Step 1: Migrate behavior tests before deleting code**

Move still-relevant requirements—valid individuals, deterministic RNG,
canonical scoring, cancellation, baseline-not-lost, and free-angle
refinement—into `automaticOptimizer.test.ts` or their focused module tests.
Delete GA-specific crossover, tournament, population-size, generation, and
preset assertions rather than translating them.

- [ ] **Step 2: Capture the legacy comparison baseline before deletion**

Run every repository fabrication fixture through the current Fast, Balanced,
and Deep presets on the same machine, with one warm-up followed by three
measured runs per fixture/preset; record median elapsed time and the best
canonical result reached by all three runs. Write an immutable JSON array to
`docs/benchmarks/automatic-anytime-baseline.json`. Each row contains fixture
ID, preset, median elapsed time, and the complete canonical comparison tuple:
`unplacedCount`, `placedCount`, `sheetCountUsed`, `wasteMm2`, `utilization`, and
`packedBoundsMm2`. Do not round numeric values.

- [ ] **Step 3: Rename benchmark output and calls**

Rename `compareBlfVsEvolutionary` to `compareBlfVsAutomatic`, update fixture
rows from `'evolutionary'` to `'automatic'`, and report both first-champion and
final times when diagnostics are available. Historical benchmark markdown is
not rewritten; new results go to a new automatic benchmark document only when
`UPDATE_BENCHMARK_DOCS=1`.

- [ ] **Step 4: Delete unreferenced GA modules**

Use exact search before deletion:

```bash
rg -n "geneticOptimizer|presetForLevel|createInitialPopulation|orderCrossover|tournamentSelect|elitistSurvive" src
```

Expected: only files scheduled for deletion or migration. Delete the five
legacy modules after the search is clean.

- [ ] **Step 5: Remove the last internal mode/time fields**

Delete `OptimizationLevel`, `optimizationLevel`, and `timeLimitMs` from
`NestingSettings`, request construction, validation, BLF progress, and all
direct request fixtures. Delete `generation`, `multiStartIndex`,
`multiStartCount`, and `optimizationLevel` from engine/UI progress types now
that their last producer is gone. Update the request test to assert the removed
properties are absent and remove the invalid-level validation test.

- [ ] **Step 6: Run optimizer and fixture tests**

Run: `npm test -- --run src/nesting/optimization src/geometry/fixtures.test.ts src/geometry/fabFixtures.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/nesting/optimization src/nesting/types.ts src/nesting/request.ts src/nesting/request.test.ts src/nesting/core/validate.ts src/nesting/core/validate.test.ts src/nesting/placement/blf.ts src/ui/nestProgress.ts src/ui/nestProgress.test.ts src/geometry/fabFixtures.ts src/geometry/fabFixtures.test.ts src/geometry/fixtures.ts src/geometry/fixtures.test.ts docs/benchmarks/automatic-anytime-baseline.json
git commit -m "refactor: remove legacy genetic optimizer"
```

### Task 9: Benchmark Time to Quality and Verify the Product

**Files:**
- Create: `docs/benchmarks/automatic-anytime-after.md`
- Modify: `src/geometry/fabFixtures.ts`
- Modify: `src/geometry/fabFixtures.test.ts`
- Modify: `src/nesting/optimization/automaticOptimizer.ts`
- Modify: `src/nesting/optimization/automaticOptimizer.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Add first-champion benchmark diagnostics**

Have the benchmark callback capture the timestamp and score of every strict
champion. Report part count, first-champion latency, final latency, each
improvement time/score, placed count, sheets, final score, exact replay time,
and geometry profiler share. Sum exact replay duration from the diagnostic
`onEvaluation` callback. For geometry share, profile the same fixture's initial
BLF seed with the existing `beginBlfProfiling`/`getBlfProfileSnapshot` API and
report `(clipper ms + collision ms) / seed wall ms`. Keep aggregation and file
generation in the benchmark helper/test, outside production control flow.

- [ ] **Step 2: Run the fixture benchmark**

Run: `UPDATE_BENCHMARK_DOCS=1 npm test -- --run src/geometry/fabFixtures.test.ts`

Expected: PASS and a generated `automatic-anytime-after.md` containing no empty
metrics.

- [ ] **Step 3: Compare against historical preset results**

Join the automatic champion timeline with
`automatic-anytime-baseline.json`. For every fixture and each old Fast, Balanced,
and Deep row, find the earliest automatic champion whose canonical comparison
tuple is no worse. Measure automatic runs with the same one-warm-up/three-sample method and
compare median time-to-score with median legacy elapsed time. The acceptance
table passes only when that champion exists and its median timestamp is no
greater than the old preset's median elapsed time. Also require the automatic
final result to place at least as many parts and use no more sheets.
If any row fails, keep Task 9 open and adjust only beam/convergence constants or
measured geometry hot paths; do not weaken the comparison or declare the
implementation complete.

Implement a benchmark-only `compareCanonicalMetrics` using the exact field
order and tolerances from `compareNestingResults`: unplaced count, sheet count,
waste, utilization, then packed bounds. Add a unit assertion that converting
two `NestingSuccess` fixtures to metrics gives the same ordering as
`compareNestingResults`; never compare the weighted `score.total` scalar for
this acceptance check.

- [ ] **Step 4: Update the README**

Remove Fast/Balanced/Deep instructions. State that nesting publishes an initial
valid layout, improves it automatically, and stops on convergence.

- [ ] **Step 5: Run complete verification**

Run: `npm test`

Expected: all tests PASS.

Run: `npm run lint`

Expected: exit 0.

Run: `npm run build`

Expected: TypeScript and Vite build exit 0.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 6: Commit**

```bash
git add src/geometry/fabFixtures.ts src/geometry/fabFixtures.test.ts src/nesting/optimization/automaticOptimizer.ts src/nesting/optimization/automaticOptimizer.test.ts docs/benchmarks/automatic-anytime-after.md README.md
git commit -m "docs: record automatic nesting benchmark"
```
