# Impossible-Sheet Material-Area Pruning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip BLF candidate generation only when conservative net-material bounds prove that an existing sheet cannot contain the next part.

**Architecture:** Keep the public nesting and telemetry APIs unchanged. Share the validator's existing metadata-relative-tolerance contract, then add one rejection-only predicate immediately inside `findEntryPlacement`, the common seam used by canonical placement and suffix simulations. Compute the predicate from validated net material areas, usable sheet area, and tolerance-width boundary bands; all eligible sheets continue through the unchanged angle/NFP pipeline.

**Tech Stack:** TypeScript 6, Vitest 4, existing geometry/BLF modules.

---

Use `@superpowers:test-driven-development`. Do not alter worker batching, Canvas playback, candidate order, scoring, or result comparison.

## File Map

- Modify `src/nesting/core/validate.ts`: export and reuse the existing geometry-metadata tolerance calculation.
- Modify `src/nesting/placement/blf.ts`: add the conservative material-capacity predicate and call it before angle/NFP work in `findEntryPlacement`.
- Create `src/nesting/placement/blf.areaGuard.test.ts`: focused red/green tests, including a module spy that proves suffix simulation avoids candidate generation without adding production instrumentation.

### Task 1: Reject mathematically impossible sheet trials

**Files:**
- Modify: `src/nesting/core/validate.ts`
- Modify: `src/nesting/placement/blf.ts`
- Create: `src/nesting/placement/blf.areaGuard.test.ts`

- [ ] **Step 1: Create the focused test harness and failing regressions**

Use the real `collectPlacementCandidates`, wrapped by a hoisted Vitest module spy:

```ts
const candidateCalls = vi.hoisted(() => [] as Array<{
  partId: string
  placedWidths: number[]
}>)

vi.mock('../nfp/candidates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../nfp/candidates')>()
  return {
    ...actual,
    collectPlacementCandidates: (...args: Parameters<typeof actual.collectPlacementCandidates>) => {
      candidateCalls.push({
        partId: args[0].partId,
        placedWidths: args[1].map(({ bounds }) => bounds.width),
      })
      return actual.collectPlacementCandidates(...args)
    },
  }
})
```

Reuse the minimal `rectPart`, request, and result-normalization patterns from
`blf.test.ts`; keep helpers local rather than exporting production internals.

Add these cases before production code:

1. Two 8×8 parts, 10×10 stock with quantity 2 and fixed 0°: both place on separate sheets; attempts for the second part on sheet 0 are empty; traced and untraced results match after removing `calculationTimeMs`.
2. The same material-capacity failure on a 12×12 stock with 1 mm margin proves the 10×10 usable area, not gross area, is used.
3. Two 5×10 parts exactly fill one 10×10 usable sheet: both place and the second part has a sheet-0 attempt.
4. Set each 5×10 part's reported area to the largest safely representable value accepted by validation (`trueArea + 0.999 * 1e-6 * trueArea`): both still place on one sheet.
5. Temporarily configure `epsilonMm: 1e-5` in `try/finally` on a 10×10
   usable sheet. Use `6×10 + 4.001×10` for the eligible case and assert sheet-0
   candidate generation occurs. After metadata lower bounds, this pair exceeds
   an incorrect `geomEps()` boundary allowance but remains inside the specified
   `10 * geomEps()` allowance. Then use `6×10 + 4.002×10`, which exceeds the
   complete allowance, and assert sheet 0 is skipped. Restore `epsilonMm: 1e-7`
   in `finally`.
6. Temporarily configure `epsilonMm: 1e-3`. Place a 10×10 host with a clockwise 4×8 hole and a 4.0005×8 guest on a 10×10 sheet with `allowPartInPart: true`. The host net area plus guest area is greater than 100 mm², but the existing containment tolerance accepts the fit; assert both parts place, then restore `epsilonMm: 1e-7`.
7. Exercise suffix simulation with order `first(8×8), current(2×8),
   future(8×8), blocked(11×11)` and 10×10 stock quantity 2. The trailing
   unplaceable part prevents the first lookahead choice from taking the
   `completedSuffix` shortcut, so both alternatives are simulated. Assert the
   spy saw `future` evaluated beside the 2 mm-wide `current` part (proving suffix
   simulation ran), never beside the 8 mm-wide `first` part (the impossible
   existing sheet), and the deterministic result places the first three parts
   while reporting `blocked` unplaced.

- [ ] **Step 2: Run the tests and verify the regression is red**

Run:

```bash
npx vitest run src/nesting/placement/blf.areaGuard.test.ts --reporter=verbose
```

Expected: the impossible-sheet attempt and spy assertions fail because
`findEntryPlacement` still enters `collectPlacementCandidates`.

- [ ] **Step 3: Share the existing metadata tolerance contract**

In `src/nesting/core/validate.ts`, replace the duplicated expression with one
exported helper:

```ts
export const GEOMETRY_METADATA_RELATIVE_TOLERANCE = 1e-6

export function geometryMetadataTolerance(value: number): number {
  return (
    GEOMETRY_METADATA_RELATIVE_TOLERANCE * Math.max(1, Math.abs(value))
  )
}

function matchesGeometry(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= geometryMetadataTolerance(expected)
}
```

Do not change which requests validation accepts.

- [ ] **Step 4: Add the single shared BLF guard**

Import `geomEps` from the existing geometry barrel and
`geometryMetadataTolerance` from the validator. Add only local helpers in
`blf.ts`:

```ts
function ringPerimeter(points: ReadonlyArray<{ x: number; y: number }>): number {
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total
}

function hasMaterialCapacity(entry: SequenceEntry, sheet: SheetState): boolean {
  const areas = [...sheet.placed.map(({ area }) => area), entry.part.area]
  const lowerTotal = areas.reduce(
    (sum, area) => sum + Math.max(0, area - geometryMetadataTolerance(area)),
    0,
  )
  const rings = [
    ...sheet.placed.flatMap(({ solid }) => [solid.outer, ...solid.holes]),
    { points: entry.part.sourceOuter },
    ...entry.part.sourceHoles.map((points) => ({ points })),
  ]
  const boundaryLength = rings.reduce(
    (sum, ring) => sum + ringPerimeter(ring.points),
    0,
  )
  const tolerance = geomEps() * 10
  const width = sheet.widthMm - sheet.marginMm * 2
  const height = sheet.heightMm - sheet.marginMm * 2
  const expandedSheetArea =
    (width + tolerance * 2) * (height + tolerance * 2)
  const collisionSlack =
    tolerance * 2 * boundaryLength +
    Math.PI * rings.length * tolerance * tolerance
  const admittedArea = expandedSheetArea + collisionSlack
  const roundoff =
    16 *
    Number.EPSILON *
    areas.length *
    Math.max(1, lowerTotal, admittedArea)
  return lowerTotal <= admittedArea + roundoff
}
```

At the first line of `findEntryPlacement`, before variant selection or
`tryPlaceOnSheet`, add:

```ts
if (!hasMaterialCapacity(entry, sheet)) return null
```

Do not emit telemetry for this return: no candidate position was generated or
tested.

- [ ] **Step 5: Run red/green and focused regression verification**

Run:

```bash
npx vitest run src/nesting/placement/blf.areaGuard.test.ts --reporter=verbose
npx vitest run src/nesting/placement/blf.test.ts src/nesting/nfp/candidates.test.ts src/nesting/core/validate.test.ts --reporter=dot
```

Expected: all focused tests pass with no warnings or leaked tolerance state.

- [ ] **Step 6: Verify static checks and commit**

Run:

```bash
npm run lint
npm run build
git diff --check
```

Expected: all commands exit 0.

Then commit only these three files:

```bash
git add src/nesting/core/validate.ts \
  src/nesting/placement/blf.ts \
  src/nesting/placement/blf.areaGuard.test.ts
git commit -m "perf: prune impossible sheet placement attempts"
```

## Post-Task Verification

After spec and code-quality review, run the complete repository gate:

```bash
npm test -- --reporter=dot
npm run lint
npm run build
git diff --check
```

Then serve the production build:

```bash
npm run preview -- --host 127.0.0.1 --port 5175
```

Repeat the headed-Chromium profile with an in-memory Playwright upload named
`nesting-50x48.svg`. Its SVG is `width="100mm" height="100mm" viewBox="0 0 100
100"` and contains 50 independent `<polygon>` elements. Polygon `partIndex`
uses 48 points where, for vertex `v`:

```js
const angle = (2 * Math.PI * v) / 48
const radius = 39 + 1.5 * Math.sin(5 * angle + partIndex * 0.37)
const x = 50 + radius * Math.cos(angle)
const y = 50 + radius * Math.sin(angle)
```

Use the same UI profile: 100×100 mm sheet, 8 mm margin, 2 mm spacing, Fast,
deterministic, default free-angle behavior, debug enabled. Start instrumentation
before navigation and record:

- worker attempt batches and total records;
- displayed yellow attempt frames and peak `received - displayed` backlog;
- worker-completion timestamp, paint-safe drain timestamp, and total completion;
- playback RAF callback p95/p99 and maximum pending playback RAF count;
- `PerformanceObserver('longtask')` entries after worker completion;
- zero-delay event-loop probe p95/max and trusted debug-toggle/STOP latency;
- loaded-baseline, peak-backlog, and post-drain/cancel post-GC heap.

The required completion-and-drain limit is three minutes; RAF p95 must stay under
8 ms, p99 under 16.7 ms, no post-worker long task may reach 50 ms, probe p95 must
stay under 50 ms/max under 100 ms, and incremental post-GC heap must stay below
64 MiB and return near baseline after drain or cancel. Confirm one attempt Canvas,
no obsolete SVG attempt layer, no console errors/warnings, and immediate cleanup
for STOP and debug disable. Do not change the one-attempt-per-frame queue or hide
remaining backlog. Stop the preview and remove all temporary browser state. If
the profile still misses three minutes, report the next measured root cause
before proposing another behavior change.
