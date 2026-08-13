# Tenth-Degree Free Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both nesting engines use exact full-circle 0.1-degree final rotation search while preserving fast coarse discovery, explicit restrictive policies, and active-app cancellation.

**Architecture:** Reuse the active engine's existing `full` BLF depth and the standalone engine's existing streamed `searchFreeAngle` final stage. The active automatic optimizer continues cheap order discovery, then exact-replays each order-distinct terminal finalist at all 3,600 tenth-degree angles; the standalone package makes that same resolution and free rotation its defaults. No new optimizer, public tuning layer, or dependency is introduced.

**Tech Stack:** TypeScript 6, Vitest, React/Vite worker app, Clipper2 geometry, npm.

---

## Scope and File Map

Active application:

- Modify `src/nesting/optimization/rotations.ts`: own the canonical 3,600-angle grid.
- Modify `src/nesting/optimization/rotations.test.ts`: prove exact grid coverage.
- Modify `src/nesting/placement/blf.ts`: use the grid for full placement, fixed plans, and stock compatibility.
- Modify `src/nesting/placement/blf.test.ts`: prove tenth-degree fits through order, fixed-plan, and stock-lookahead paths.
- Modify `src/nesting/optimization/automaticOptimizer.ts`: schedule order-distinct mandatory full finalist passes without letting convergence skip them.
- Modify `src/nesting/optimization/automaticOptimizer.test.ts`: prove terminal, repair, deduplication, convergence, and cancellation behavior.

Standalone engine:

- Modify `malt-nest-engine/src/rotation/types.ts`: change the free-search step and public rotation defaults.
- Modify `malt-nest-engine/tests/rotation.free.test.ts`: prove default 3,600-angle search and tenth-degree optima.
- Modify `malt-nest-engine/tests/engine.regression.test.ts`: prove omitted rotation uses public free 0.1-degree behavior and keep unrelated expensive tests explicit.
- Modify `malt-nest-engine/tests/rotation.property.test.ts`: keep non-resolution property tests explicitly at 1 degree.
- Modify `malt-nest-engine/tests/optimization.core.test.ts`: keep routing tests cheap while preserving FAST-orthogonal/FULL-free assertions.
- Modify `malt-nest-engine/tests/rotation.bench.test.ts`: benchmark the actual 0.1-degree FULL default.
- Modify `malt-nest-engine/tests/rotation.demo.test.ts`: make the free demo consume the current default.

Documentation:

- Modify `docs/ETAP-0-nesting-rebuild.md`: describe the active full depth as 0.1 degree.
- Modify `malt-nest-engine/docs/rotation.md`: document the 3,600-angle default.
- Modify `malt-nest-engine/docs/nest.md`: document free rotation as the standalone default.
- Modify `malt-nest-engine/docs/optimization.md`: state that FULL inherits the 0.1-degree free default.

Do not touch the user's pre-existing changes in `.gitignore`, `src/svg/contours.ts`, or `src/svg/parseGeometry.test.ts`. Stage only files named by each task.

Apply @superpowers:test-driven-development to every behavior change: add one focused failing test, observe the expected failure, implement only enough to pass, then rerun the focused suite.

### Task 1: Canonical active-app 0.1-degree grid

**Files:**

- Modify: `src/nesting/optimization/rotations.ts:7-75`
- Test: `src/nesting/optimization/rotations.test.ts:1-40`

- [ ] **Step 1: Write the failing grid test**

Import `fullFreeAngles` and add:

```ts
it('builds the canonical 0.1° full-circle grid', () => {
  const angles = fullFreeAngles()

  expect(angles).toHaveLength(3_600)
  expect(new Set(angles).size).toBe(3_600)
  expect(angles[0]).toBe(0)
  expect(angles.at(-1)).toBe(359.9)
  expect(angles.every((angle) => angle === Number(angle.toFixed(1))))
    .toBe(true)
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- --run src/nesting/optimization/rotations.test.ts
```

Expected: FAIL because `fullFreeAngles` is not exported.

- [ ] **Step 3: Add the minimum integer-index grid helper**

In `rotations.ts`, keep the existing 1-degree local cascade constants unchanged and add:

```ts
export const FREE_ANGLE_FULL_STEP = 0.1

/** Exact finalist grid: 0.0°, 0.1°, …, 359.9°. */
export function fullFreeAngles(): number[] {
  const scale = 1 / FREE_ANGLE_FULL_STEP
  return Array.from({ length: 360 * scale }, (_, index) => index / scale)
}
```

Integer indexing avoids accumulated `0.1 + 0.1 + ...` drift.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- --run src/nesting/optimization/rotations.test.ts
```

Expected: all rotation-helper tests PASS.

- [ ] **Step 5: Commit only the grid change**

```bash
git add src/nesting/optimization/rotations.ts src/nesting/optimization/rotations.test.ts
git commit -m "feat: add tenth-degree rotation grid"
```

### Task 2: Full BLF search through every placement gate

**Files:**

- Modify: `src/nesting/placement/blf.ts:14-31,260-262,666-855,960-1039`
- Test: `src/nesting/placement/blf.test.ts:544-600,719-765`

- [ ] **Step 1: Change the direct full-search fixture to require a tenth-degree angle**

Update the existing exact-fit test from 37 degrees to 37.1 degrees:

```ts
it('full free-angle search finds an exact 37.1° fit', () => {
  const part = rectPart('bar', 0, 0, 0, 100, 1)
  const angle = 37.1
  const radians = (angle * Math.PI) / 180
  const width = 100 * Math.cos(radians) + Math.sin(radians)
  const height = 100 * Math.sin(radians) + Math.cos(radians)
  const result = runBottomLeftNest(
    request([part], {
      sheet: {
        widthMm: width + 1e-6,
        heightMm: height + 1e-6,
        marginMm: 0,
        quantity: 1,
      },
      settings: {
        rotationMode: 'free',
        allowRotation: true,
        allowArbitraryRotation: true,
      },
    }),
    { freeAngleDepth: 'full' },
  )

  expect(result.status).toBe('ok')
  if (result.status !== 'ok') return
  expect(result.placements).toHaveLength(1)
  expect([37.1, 142.9, 217.1, 322.9])
    .toContain(result.placements[0]?.rotation)
})
```

- [ ] **Step 2: Run the direct test and verify RED**

Run:

```bash
npm test -- --run src/nesting/placement/blf.test.ts -t "37.1"
```

Expected: FAIL because `full` currently evaluates only whole degrees.

- [ ] **Step 3: Route direct full search to `fullFreeAngles()`**

Import `fullFreeAngles` in `blf.ts` and replace only the `opts.depth === 'full'` call to `coarseFreeAngles(1)`:

```ts
if (opts.depth === 'full') {
  const ok = evaluateAngles(
    part,
    fullFreeAngles(),
    sheet,
    spacingMm,
    allowPartInPart,
    signal,
    bias,
    exactNfp,
    opts.onAttempt,
  )
  return ok[0] ?? null
}
```

Do not store variants: `evaluateAngles` already uses one-shot `createVariant` and truncates successful candidates to `keep = 1`.

- [ ] **Step 4: Rerun the direct test and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Add a failing fixed-plan full-search regression**

Use the same exact 37.1-degree sheet, but call:

```ts
const result = placeWithPlan(
  req,
  { order: ['bar'], rotations: [0] },
  { freeAngleDepth: 'full', nfpFidelity: 'exact' },
)

expect(result.status).toBe('ok')
if (result.status !== 'ok') return
expect([37.1, 142.9, 217.1, 322.9])
  .toContain(result.placements[0]?.rotation)
```

- [ ] **Step 6: Run the fixed-plan test and verify RED**

Run:

```bash
npm test -- --run src/nesting/placement/blf.test.ts -t "fixed-plan full"
```

Expected: FAIL because a plan entry currently uses only its stored variant at `full` depth.

- [ ] **Step 7: Route fixed free-mode plans through the existing full evaluator**

Extend the fixed-variant branch in `findEntryPlacement`:

```ts
if (
  freeCascade &&
  (freeDepth === 'seed' ||
    freeDepth === 'refine' ||
    freeDepth === 'full')
) {
  return pickBestVariant(
    part,
    sheet,
    spacing,
    allowPartInPart,
    signal,
    packBias,
    {
      freeCascade: true,
      depth: freeDepth,
      ...(freeDepth === 'full'
        ? {}
        : { seedRotation: variant.rotation }),
      exactNfp: useExactNfp,
      onAttempt,
    },
  )
}
```

`usesFreeAngleCascade()` remains the trust boundary: explicit fixed, orthogonal, disabled, or custom-step requests must continue down the discrete path.

- [ ] **Step 8: Rerun the fixed-plan test and verify GREEN**

Run the command from Step 6. Expected: PASS.

- [ ] **Step 9: Make the heterogeneous-stock lookahead test fail at 37.1 degrees**

Update existing test `16e` to build the constrained stock from a 37.1-degree rotated bar. Keep the current best-rotation `placeWithOrder` assertions, then add one `placeWithPlan` case with stored rotations `[0, 0]` and `freeAngleDepth: 'full'`. Both must place the flexible part on the 71×71 stock and reserve the exact stock for the bar.

- [ ] **Step 10: Run stock lookahead and verify RED**

Run:

```bash
npm test -- --run src/nesting/placement/blf.test.ts -t "stock lookahead"
```

Expected: FAIL because compatibility still samples whole-degree dimensions and fixed entries still precheck their stored angle.

- [ ] **Step 11: Use the full grid for full-depth stock compatibility**

Parameterize the existing dimension helper and select the grid once per placement run:

```ts
function freeAngleDimensions(
  part: PreparedPart,
  angles: readonly number[] = coarseFreeAngles(1),
): FitDimensions[] {
  return angles.map((angle) => rotationDimensions(part, angle))
}
```

Then change `fitsStock`:

```ts
const fullStockSearch = freeCascade && freeDepth === 'full'
const stockFitAngles = fullStockSearch ? fullFreeAngles() : undefined

const fitsStock = (entry: SequenceEntry, stock: SheetStock): boolean => {
  let dimensions: FitDimensions[] | undefined
  if (freeCascade && (entry.variant === 'best' || fullStockSearch)) {
    dimensions = freeDimensionCache.get(entry.part)
    if (!dimensions) {
      dimensions = freeAngleDimensions(entry.part, stockFitAngles)
      freeDimensionCache.set(entry.part, dimensions)
    }
  }
  return entryFitsEmptyStock(entry, stock, dimensions)
}
```

This retains the existing cheap whole-degree compatibility behavior outside `full`, but best and fixed-plan entries use the exact 0.1-degree grid during a full pass.

- [ ] **Step 12: Run the complete BLF suite**

Run:

```bash
npm test -- --run src/nesting/placement/blf.test.ts
```

Expected: all BLF tests PASS, including explicit-rotation tests.

- [ ] **Step 13: Commit the BLF root-cause fixes**

```bash
git add src/nesting/placement/blf.ts src/nesting/placement/blf.test.ts
git commit -m "feat: search tenth-degree rotations in full BLF"
```

### Task 3: Mandatory order-distinct automatic finalist passes

**Files:**

- Modify: `src/nesting/optimization/automaticOptimizer.ts:37-70,259-331,414-427,553-640`
- Test: `src/nesting/optimization/automaticOptimizer.test.ts:272-335,918-965`

- [ ] **Step 1: Extend the refinement test harness with a `full` stage**

In `refinementScenario`, make the mock return a distinct result for `full` and record the new progress stage:

```ts
const placeWithPlanUnchecked: typeof actual.placeWithPlanUnchecked =
  (nestRequest, plan, options) => scoredResult(
    nestRequest,
    plan.order,
    options.freeAngleDepth === 'refine'
      ? refineWaste
      : options.freeAngleDepth === 'seed'
        ? 80
        : options.freeAngleDepth === 'full'
          ? 70
          : 100,
  )

type FinalistStage = 'refine' | 'seed' | 'full'
```

Recognize `Improving layout · full-circle finalist` in `onProgress`, then change the expectations to:

```ts
expect(await refinementScenario(90)).toEqual([
  { stage: 'refine', improved: true },
  { stage: 'seed', improved: true },
  { stage: 'full', improved: true },
])

expect(await refinementScenario(110)).toEqual([
  { stage: 'refine', improved: false },
  { stage: 'full', improved: true },
])
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test -- --run src/nesting/optimization/automaticOptimizer.test.ts -t "full-circle|refinement"
```

Expected: FAIL because no automatic `full` replay exists and non-improving refinement returns early.

- [ ] **Step 3: Add `full` to exact replay types and cache by order**

In `automaticOptimizer.ts`:

```ts
type ExactStage = 'fixed' | 'coarse' | 'refine' | 'seed' | 'full'
type ExactDepth = Extract<FreeAngleDepth, 'refine' | 'seed' | 'full'>

const orderKey = (individual: Individual): string =>
  JSON.stringify(individual.order)
```

Use `ExactDepth` in `evaluateExact` and `evaluateAndRefreshExact`. Build cache keys as:

```ts
const key = stage === 'full'
  ? `full:${orderKey(individual)}`
  : `${stage}:${individualKey(individual, runKey)}`
```

Full placement ignores stored rotation genes, so rotation-sensitive keys would repeat identical 3,600-angle work.

- [ ] **Step 4: Make `refineFinalist` always finish with a full replay**

Keep current optional coarse, refine, and conditional seed passes so their distinct greedy layouts remain eligible champions. Replace early success-path exits with a final helper:

```ts
const runFullFinalist = (
  individual: Individual,
  source: 'finalist' | 'repair',
  activity: ProgressActivity,
): RefinementState => {
  emit({
    ratio: 0.65,
    phase: 'optimize',
    activity,
    message: source === 'repair'
      ? 'Improving layout · full-circle repair champion'
      : 'Improving layout · full-circle finalist',
  })
  const full = evaluateExact(individual, 'full', activity, 'full')
  return full.cancelled || options.signal?.aborted ? 'cancelled' : 'done'
}
```

When refine does not improve, call `runFullFinalist(refinementGene, ...)` instead of returning. When seed runs, pass its returned gene when available; otherwise pass the latest refinement gene. Do not call `evaluateAndRefreshExact` for the full pass—refresh the cheap threshold once after terminal processing instead of once per expensive finalist.

- [ ] **Step 5: Dedupe the terminal champion and beam by order**

Replace `individualKey` in the finalist set with `orderKey`:

```ts
const finalistKeys = new Set<string>()
const finalists = [championGene, ...beam.map(({ individual }) => individual)]
  .filter((individual) => {
    const key = orderKey(individual)
    if (finalistKeys.has(key)) return false
    finalistKeys.add(key)
    return true
  })
```

- [ ] **Step 6: Rerun the focused automatic tests**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 7: Add and pass an order-deduplication regression**

Using the existing `vi.doMock('../placement/blf', importOriginal => ...)` pattern, feed the finalist list the same order with different rotation genes, record calls where `freeAngleDepth === 'full'`, and assert that order appears once. Run:

```bash
npm test -- --run src/nesting/optimization/automaticOptimizer.test.ts -t "deduplicates full finalists by order"
```

Expected before the order-key implementation: FAIL with two calls. Expected after it: PASS with one call.

- [ ] **Step 8: Commit mandatory finalist scheduling**

```bash
git add src/nesting/optimization/automaticOptimizer.ts src/nesting/optimization/automaticOptimizer.test.ts
git commit -m "feat: fully rotate automatic finalists"
```

### Task 4: Preserve finalist work across convergence, repair, and abort

**Files:**

- Modify: `src/nesting/optimization/automaticOptimizer.ts:203-223,404-427,433-683`
- Test: `src/nesting/optimization/automaticOptimizer.test.ts:175-270,335-470,634-685,918-965,1076-1110`

- [ ] **Step 1: Add a failing convergence-to-finalists test**

Extend `fidelityPromotionScenario` to wrap the real `selectBeam`, retain the latest selected order keys, and record exact calls with `freeAngleDepth === 'full'`. In the existing `stopAtFirstLayer` clock scenario, set `clock = 5_000` as today and assert:

```ts
expect(new Set(fullOrderKeys)).toEqual(
  new Set([championOrderKey, ...terminalBeamOrderKeys]),
)
```

Normalize all keys with `JSON.stringify(order)`. This checks every terminal order and naturally ignores rotation-gene duplicates.

- [ ] **Step 2: Run the convergence regression and verify RED**

Run:

```bash
npm test -- --run src/nesting/optimization/automaticOptimizer.test.ts -t "convergence.*full finalists"
```

Expected: FAIL because `haltResult()` currently returns `finish()` from discovery before finalist processing.

- [ ] **Step 3: Separate abort from convergence and exit discovery through a label**

Keep immediate abort behavior, but turn convergence into a transition to terminal processing:

```ts
const aborted = (): boolean => options.signal?.aborted === true
const converged = (): boolean => shouldStop(convergence, now(), false)
```

Declare `beam` before a `discovery: { ... }` block, and start that block before
the initial `refreshCheapThreshold()` guard so convergence cannot return early
there either. Wrap the required-order and beam loops in the same block. Replace
each discovery `if (halted()) return haltResult()` with:

```ts
if (aborted()) return cancelled()
if (converged()) break discovery
```

Only call `markRequiredOrdersComplete` if the required-order loop actually completes. After the labeled block, retain the current champion fallback when `beam` is empty, snapshot and full-process the terminal finalists, and then:

```ts
if (aborted()) return cancelled()
if (converged()) return finish()
if (!refreshCheapThreshold()) return cancelled()
```

Do not let time/count convergence interrupt the mandatory terminal loop; only `AbortSignal` may do so.

Inside `refineFinalist`, replace every `halted()` early return with:

```ts
if (aborted()) return 'cancelled'
if (converged()) {
  return runFullFinalist(refinementGene, source, activity)
}
```

This may skip optional coarse/local work after convergence, but never the full
pass. Once no code returns a convergence-only `halted` state, remove `halted`
from `RefinementState` and delete the corresponding caller branches.

- [ ] **Step 4: Rerun the convergence regression and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Add a failing repair-order regression**

Update `repairImprovementScenario` to record `repair:full:start` and `exact:full:*`. Abort after the repair full exact evaluation instead of after refine, then assert:

```ts
const repairFull = sequence.indexOf('exact:full:true')
const nextRepairRank = sequence.findIndex(
  (event, index) => index > repairExact && event.startsWith('rank:candidate:'),
)

expect(repairFull).toBeGreaterThan(repairExact)
expect(nextRepairRank === -1 || nextRepairRank > repairFull).toBe(true)
```

Expected RED: the current repair flow has no full stage.

- [ ] **Step 6: Ensure every promoted repair order passes through full before continuation**

After an exact repair promotion and optional local refinement, call the same `runFullFinalist(championGene, 'repair', 'repair')`. Check convergence only after that function returns. If the full pass improves the champion and repair will continue, call `refreshCheapThreshold()` once before proposing another repair.

The order-key exact cache may satisfy this without rerunning when that exact order already received a full pass.

- [ ] **Step 7: Add a failing cancellation-partial regression**

Mock `placeWithPlanUnchecked` so the first `full` call aborts and returns:

```ts
{
  status: 'cancelled',
  message: 'Cancelled',
  bestSoFar: scoredResult(nestRequest, plan.order, 0),
}
```

Capture the last published champion before the call, then assert the automatic result is `cancelled` and its `bestSoFar` equals that published champion—not the tempting partial with waste `0`.

- [ ] **Step 8: Run repair and cancellation tests and verify GREEN**

Run:

```bash
npm test -- --run src/nesting/optimization/automaticOptimizer.test.ts -t "repair.*full|cancel.*full"
```

Expected: PASS. `evaluateExact` must return cancellation without publishing `replay.bestSoFar`; `cancelled()` remains the only result constructor for this path.

- [ ] **Step 9: Run all active rotation/optimizer tests**

```bash
npm test -- --run \
  src/nesting/optimization/rotations.test.ts \
  src/nesting/placement/blf.test.ts \
  src/nesting/optimization/automaticOptimizer.test.ts
```

Expected: all focused active-app tests PASS.

- [ ] **Step 10: Commit convergence and cancellation behavior**

```bash
git add src/nesting/optimization/automaticOptimizer.ts src/nesting/optimization/automaticOptimizer.test.ts
git commit -m "fix: preserve full finalist search on convergence"
```

### Task 5: Standalone free rotation and 0.1-degree defaults

**Files:**

- Modify: `malt-nest-engine/src/rotation/types.ts:33-53`
- Test: `malt-nest-engine/tests/rotation.free.test.ts:85-200`
- Test: `malt-nest-engine/tests/engine.regression.test.ts:244-290`

- [ ] **Step 1: Write the failing standalone default-grid test**

Import `resolveFreeConfig` and add to `rotation.free.test.ts`:

```ts
it('searches the default circle at 0.1° resolution', () => {
  const config = resolveFreeConfig()
  const result = searchFreeAngle((angleDeg) => ({
    angleDeg,
    ok: angleDeg === 37.1,
    ...(angleDeg === 37.1
      ? {
          position: { x: 0, y: 0 },
          bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
          packedBoundsMm2: 1,
        }
      : {}),
  }))

  expect(config.finalStepDeg).toBe(0.1)
  expect(result.evalCount).toBe(3_600)
  expect(new Set(result.anglesEvaluated).size).toBe(3_600)
  expect(result.anglesEvaluated[0]).toBe(0)
  expect(result.anglesEvaluated.at(-1)).toBe(359.9)
  expect(result.best?.angleDeg).toBe(37.1)
})
```

- [ ] **Step 2: Write the failing public-default nesting regression**

Replace/extend the full-circle regression in `engine.regression.test.ts` as
`it('uses free tenth-degree search when rotation is omitted', ...)`, using a
100×1 bar and a sheet whose exact AABB is calculated at 37.1 degrees. Omit
`rotation`:

```ts
const result = nest([rect('bar', length, height)], sheet, {
  gap: 0,
  maxSheets: 1,
})

expect(result.config.rotation).toEqual({ kind: 'free' })
expect(result.placements).toHaveLength(1)
expect([37.1, 217.1]).toContain(result.placements[0]!.rotationDeg)
expect(validatePlacement(result.placements[0]!, sheet, [], { gap: 0 }).valid)
  .toBe(true)
```

- [ ] **Step 3: Run both tests and verify RED**

Run:

```bash
npm --prefix malt-nest-engine test -- --run \
  tests/rotation.free.test.ts \
  tests/engine.regression.test.ts \
  -t "default circle|rotation is omitted"
```

Expected: the search reports 360 rather than 3,600 evaluations, 37.1 is not found, and omitted rotation resolves to orthogonal.

- [ ] **Step 4: Make the two standalone default changes**

In `malt-nest-engine/src/rotation/types.ts`:

```ts
export const DEFAULT_FREE_ANGLE = {
  coarseStepDeg: 15,
  refineStepDeg: 5,
  finalStepDeg: 0.1,
  // existing fields unchanged
}

export const DEFAULT_ROTATION: RotationPolicy = { kind: 'free' }
```

Do not modify `search.ts`, `place.ts`, `nest.ts`, or `multiStart.ts`: they already propagate these defaults, stream/canonicalize the final grid, keep a running best, honor explicit policies, and keep FAST explicitly orthogonal.

- [ ] **Step 5: Rerun both tests and verify GREEN**

Run the command from Step 3. Expected: PASS.

- [ ] **Step 6: Commit standalone defaults**

```bash
git add \
  malt-nest-engine/src/rotation/types.ts \
  malt-nest-engine/tests/rotation.free.test.ts \
  malt-nest-engine/tests/engine.regression.test.ts
git commit -m "feat: default engine rotation to tenth-degree free search"
```

### Task 6: Keep non-resolution tests bounded and update current documentation

**Files:**

- Modify: `malt-nest-engine/tests/rotation.free.test.ts:24-30`
- Modify: `malt-nest-engine/tests/rotation.property.test.ts:130-165`
- Modify: `malt-nest-engine/tests/optimization.core.test.ts:150-220`
- Modify: `malt-nest-engine/tests/engine.regression.test.ts:390-415,1170-1200`
- Modify: `malt-nest-engine/tests/rotation.bench.test.ts:67-82`
- Modify: `malt-nest-engine/tests/rotation.demo.test.ts:50-68`
- Modify: `docs/ETAP-0-nesting-rebuild.md:45-62`
- Modify: `malt-nest-engine/docs/rotation.md:23-31,86-92`
- Modify: `malt-nest-engine/docs/nest.md:12-22`
- Modify: `malt-nest-engine/docs/optimization.md:35-50`

- [ ] **Step 1: Pin tests that are not testing default resolution**

Add `finalStepDeg: 1` to:

- the shared `freeNoFloor` fixture in `rotation.free.test.ts`;
- free determinism and baseline-floor configs in `rotation.property.test.ts`;
- baseline-floor aggregation in `engine.regression.test.ts`;
- the direct ETAP-5 non-orthogonal fixture in `optimization.core.test.ts`; and
- the orchestration-only `fullRotation` config in the multi-strategy optimizer regression.

For `optimization.core.test.ts` test `FULL uses free by default`, pass an empty part list so the test still proves the default policy kind without paying for unrelated geometry work:

```ts
const result = optimizeMultiStart([], sheet, {
  gap: 0,
  strategies: ['area_desc'],
  maxSheets: 2,
})
```

Remove the `< 1500ms` assertion from `engine.regression.test.ts`; correctness tests must not encode wall-clock performance.

- [ ] **Step 2: Run the affected standalone correctness tests**

```bash
npm --prefix malt-nest-engine test -- --run \
  tests/rotation.free.test.ts \
  tests/rotation.property.test.ts \
  tests/engine.regression.test.ts \
  tests/optimization.core.test.ts
```

Expected: PASS without turning every unrelated fixture into a 3,600-angle benchmark.

- [ ] **Step 3: Make FULL benchmarks consume the new default**

In `rotation.bench.test.ts`, remove only `finalStepDeg: 1` from the FULL config and rename the row to `free-full-default-0.1deg`. In `rotation.demo.test.ts`, remove its explicit `finalStepDeg: 1`; retain its other free-search settings. Raise timeouts only if an observed run exceeds the existing limits.

- [ ] **Step 4: Update current docs, not historical reports**

Make these exact statements:

- `docs/ETAP-0-nesting-rebuild.md`: active `full` is exhaustive `0.0°..359.9° @ 0.1°`.
- `malt-nest-engine/docs/rotation.md`: final default is full circle at 0.1 degree, exactly 3,600 normalized samples; finer caller overrides still use the existing bound.
- `malt-nest-engine/docs/nest.md`: the omitted `rotation` default is `free`.
- `malt-nest-engine/docs/optimization.md`: FAST remains orthogonal and FULL inherits free 0.1-degree search.

Do not rewrite historical benchmark reports or the superseded 2026-08-12 design/plan.

- [ ] **Step 5: Run the standalone microbenchmarks**

```bash
npm --prefix malt-nest-engine test -- --run \
  tests/rotation.bench.test.ts \
  tests/optimization.bench.test.ts
```

Expected: PASS and printed rows identify the 0.1-degree default. Record actual runtime before considering timeout changes.

- [ ] **Step 6: Commit test scoping, benchmarks, and docs**

```bash
git add \
  docs/ETAP-0-nesting-rebuild.md \
  malt-nest-engine/docs/nest.md \
  malt-nest-engine/docs/optimization.md \
  malt-nest-engine/docs/rotation.md \
  malt-nest-engine/tests/engine.regression.test.ts \
  malt-nest-engine/tests/optimization.core.test.ts \
  malt-nest-engine/tests/rotation.bench.test.ts \
  malt-nest-engine/tests/rotation.demo.test.ts \
  malt-nest-engine/tests/rotation.free.test.ts \
  malt-nest-engine/tests/rotation.property.test.ts
git commit -m "docs: describe tenth-degree free rotation"
```

### Task 7: Full verification

**Files:** No new files unless a check exposes a real regression.

- [ ] **Step 1: Run the active-app focused suite**

```bash
npm test -- --run \
  src/nesting/optimization/rotations.test.ts \
  src/nesting/placement/blf.test.ts \
  src/nesting/core/validate.test.ts \
  src/nesting/optimization/automaticOptimizer.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run all active-app checks**

```bash
npm test
npm run lint
npm run build
```

Expected: all tests PASS, lint exits 0, TypeScript and Vite production build succeed.

- [ ] **Step 3: Run all standalone checks**

```bash
npm --prefix malt-nest-engine test
npm --prefix malt-nest-engine run lint
npm --prefix malt-nest-engine run typecheck
```

Expected: all tests PASS, lint exits 0, and `tsc --noEmit` exits 0. The standalone package has no build script; do not invent one.

- [ ] **Step 4: Run opt-in quality benchmarks when their fixtures are available**

```bash
RUN_AUTOMATIC_BENCHMARK=1 \
  npm test -- --run src/geometry/fabFixtures.test.ts

npm test -- --run src/nesting/optimization/freeAngle.demo.compare.test.ts
```

Expected: strict fabrication comparisons PASS. The Demo command reads the
existing `DEMO_SVG` environment variable and reports a skip when it is unset or
invalid; report that skip explicitly rather than inventing a fixture path.

- [ ] **Step 5: Inspect only the intended final diff**

```bash
git status --short
git diff --check
git diff 4d45231..HEAD -- \
  src/nesting \
  malt-nest-engine \
  docs/ETAP-0-nesting-rebuild.md
```

Expected: no whitespace errors; the user's unrelated `.gitignore` and SVG parser changes remain unstaged and unmodified by this work.
