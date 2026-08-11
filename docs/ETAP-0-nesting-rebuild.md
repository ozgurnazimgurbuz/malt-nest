# ETAP 0 — Nesting Rebuild: Architecture & Research Report

**Status:** Research only — no new engine code, no legacy patches, no commit required for this document.  
**Date:** 2026-08-11  
**Decision:** Treat `malt-nest` nesting stack as **LEGACY ENGINE**. New work builds a **separate** engine.

---

## Executive freeze

| Do | Do not |
|----|--------|
| Use legacy as reference / benchmark / UI requirements | Patch Stage 1/2, NFP, BLF, scoring, UI |
| Compare new engine results to legacy baseline | Depend on `src/nesting/*` inside new engine |
| Design modular, testable, benchmarkable engine | Copy OSS projects wholesale |

**LEGACY BASELINE (Demo.svg):** packed bounds **780,097 mm²** @ sheet **1600×1000**, gap **5**, margin **10**, 16 parts, runtime ~**189–195 s** (measured ~195 s in Stage-1+2 arch bench).

---

## A. Legacy Engine Audit

### A.1 Pipeline

```
SVG file
  → src/svg/parseGeometry.ts (+ parseMeta)
  → GeometryPart[]
  → src/nesting/request.ts (toNestingRequest — forces free rotation)
  → src/nesting/nest.ts (nestAsync)
  → WorkerNestingEngine (src/nesting/worker/client.ts)
       └─ nestWorker.ts → runEvolutionaryNest
  → Placement: src/nesting/placement/blf.ts
  → Geometry/NFP: src/geometry/{nfp,minkowski,backend/clipperAdapter,cache,collide}.ts
  → NestingSuccess
```

Fallback without `Worker`: **BLF only** (`blfNestingEngine`), not evolutionary.

### A.2 Module map

| Layer | Path | Role |
|-------|------|------|
| Prepare | `src/nesting/core/prepare.ts` | Rotation variants, metrics, lazy `getOrCreateVariant`, optional area sort |
| BLF placer | `src/nesting/placement/blf.ts` | Bottom-left + free-angle depths; `runBottomLeftNest` / `placeWithOrder` / `placeWithPlan` |
| NFP candidates | `src/nesting/nfp/candidates.ts` | Discrete translations from NFP boundary (edge×vertex capped) |
| Rotations | `src/nesting/optimization/rotations.ts` | 15° / 5° / 1° cascade helpers |
| Order search | `src/nesting/optimization/orderSearch.ts` | ~12 heuristic orders |
| Optimizer | `src/nesting/optimization/geneticOptimizer.ts` | Stage1 full floor + 0° order search + GA + Stage2 shortlist |
| Scoring | `src/nesting/scoring/{fitness,weights}.ts` | Weighted GA score + packed-bounds final pick |
| Geometry | `src/geometry/*` | Clipper2 booleans, Minkowski NFP, LRU cache |

### A.3 Free-angle model (legacy)

| Depth | Behavior |
|-------|----------|
| `quick` | 45° grid |
| `coarse` | 15° (24 angles) |
| `medium` | 15° → top-3 refine @ 5° (no 1°) — profiling only |
| `full` | 15° → top-3 @ 5° → ±5° @ 1° |
| `seed` | Refine around gene angle → 1° |

### A.4 Architecture strengths

- Real NFP (not AABB-only decisions) via Clipper2 Minkowski / convex fast path
- Session NFP cache
- Free angles are engine-driven (UI does not pick angles)
- Production path now keeps Stage1 `area_desc + full` as quality floor

### A.5 Architecture debts (why rebuild, not patch)

1. **Proxy mismatch:** order ranking at **0°** does not predict free-angle quality (`area_desc` ranked #9 at 0°, #1 at full).
2. **Dual objective:** GA uses weighted score (waste + compactness); free-mode finish uses packed AABB — can disagree.
3. **Search cost shape:** full cascade on Demo is ~3–6 min per thorough multi-order experiment; Stage2 shortlist historically missed Stage1 winner.
4. **NFP candidate sparsity:** Stage 10B capped edge×vertex for speed — possible missed contacts.
5. **Gene vs cascade:** GA `placeWithPlan` locks rotations; cascade `placeWithOrder` picks angles — two search spaces glued together.
6. **Worker asymmetry:** no Worker → BLF-only quality path.
7. **Monolith coupling:** geometry + nesting + UI live in one app; hard to evolve core without UI risk.

---

## B. Legacy Baseline

### B.1 What 780,097 is

**Not** “absolute nesting quality.” It is:

```
packedBoundsMm2 = Σ_sheets (usedBounds.width × usedBounds.height)
```

where `usedBounds` is the axis-aligned bounding box of **all placed part solids** on that sheet (`src/nesting/scoring/fitness.ts`).

| Metric | Meaning |
|--------|---------|
| **packedBoundsMm2** | Pack AABB area (legacy “bounds”) |
| **utilization** | `placedPartArea / usableSheetArea` |
| **wasteMm2** | `usableSheetArea − placedPartArea` |

On Demo (1 sheet, all 16 placed), utilization/fire% can stay flat while packed bounds improve a lot (orthogonal ~1.06M → free ~780k). So bounds measures **compactness of the pack**, not material leftover alone.

### B.2 How baseline is produced

1. Fixture: Desktop `Demo.svg`, 16 parts  
2. Sheet: 1600×1000, margin 10, spacing/gap 5  
3. Order: **area_desc** (`runBottomLeftNest` → `sortByArea: true`)  
4. Angles: **`freeAngleDepth: 'full'`**  
5. Placer: same BLF/NFP engine  
6. Result: **780,097** (regression harness ±50 mm²; measured delta 0)

### B.3 Use going forward

| Role | Rule |
|------|------|
| Reference baseline | Always report new engine vs 780,097 on same fixture |
| Not sole score | New scoring must include utilization, sheets, waste, fragmentation, runtime |
| Gate to production | Match or beat legacy **multi-metric** quality before UI swap — not “bounds only” |

---

## C. Open Source Audit

### C.1 Comparison matrix

| Project | Repo | License | Language | Geometry / NFP | Placement | Rotation | Optimization | Fit for Malt |
|---------|------|---------|----------|----------------|-----------|----------|--------------|--------------|
| **SVGnest** | [Jack000/SVGnest](https://github.com/Jack000/SVGnest) | **MIT** | JS (browser) | Orbital / Burke-style NFP; SVG polygons | NFP point heuristics; FFD order | Discrete part rotations (config) | Genetic algorithm | **Ideas + MIT** — algorithm reference, not copy-paste UI |
| **Deepnest** (Jack) | [Jack000/Deepnest](https://github.com/Jack000/Deepnest) | Mixed / app | Electron + JS + native | SVGnest lineage + native accel | Same family | Discrete | GA + continuous search UX | Reference only; trust/history fragmented |
| **deepnest-next** | [deepnest-next/deepnest](https://github.com/deepnest-next/deepnest) | **MIT** (+ per-folder notes) | JS + C / Rust modules | Speed-critical native; path approx | Nesting app | Config rotations | GA lineage | Active community fork; study architecture, don’t fork-as-product |
| **libnest2d** | [tamasmeszaros/libnest2d](https://github.com/tamasmeszaros/libnest2d) (Prusa lineage) | **LGPL-3.0** | C++11 header-ish | Pluggable geometry; NFP-oriented literature | Template placer/selector | Supported in framework | Metaheuristic selection | Strong C++ design; **LGPL** → careful linking if proprietary; incomplete for holes/concave historically |
| **jagua-rs** (+ **lbf**) | [JeroenGar/jagua-rs](https://github.com/JeroenGar/jagua-rs) | **MPL-2.0** | Rust (+ WASM) | Collision Detection Engine; continuous rot/trans; holes; separation | Reference LBF heuristic crate | Continuous rotation | Optimizer **decoupled** from geometry | **Strongest modern OSS fit** as geometry backend candidate |
| **libnfporb** (literature ecosystem) | Various | Check per-repo | C++ | Robust NFP generation focus | N/A (primitive) | — | — | NFP research component; license per fork |

### C.2 What to learn (not copy)

| Idea | Source | Takeaway |
|------|--------|----------|
| NFP as placement space | SVGnest / Burke et al. | Outer NFP + Inner Fit Polygon remain the right abstraction |
| GA over insertion order | SVGnest | Order search matters; **must evaluate with same rotation depth as production** |
| Decouple collision from optimizer | jagua-rs paper (INFORMS JoC) | Geometry kernel ≠ search algorithm — clean API boundary |
| Continuous rotation | jagua-rs | Free angle as first-class state, not UI enum |
| Policy-based placer | libnest2d | Placer / selector as swappable strategies |
| Common-line / DXF | deepnest-next | Later product features — not ETAP 1–4 |

### C.3 License posture (non-lawyer summary)

| License | Implication for Malt |
|---------|----------------------|
| **MIT** (SVGnest, deepnest-next) | Can study and reimplement ideas; attribution if using code |
| **MPL-2.0** (jagua-rs) | File-level copyleft if modifying/distributing those files; linking as dependency is common for WASM/Rust crates — **legal review before shipping** |
| **LGPL-3** (libnest2d) | Dynamic linking / LGPL compliance if embedding |

**Rule:** Prefer **clean-room reimplementation** of algorithms + optional **dependency** on a reviewed geometry crate over vendoring app UIs.

---

## D. Algorithm Recommendation

### D.1 Recommended stack (conceptual)

```
SVG normalize → polygon solid (outer + holes)
  → spacing via polygon offset
  → collision / NFP kernel (fast queries + optional NFP cache)
  → constructive placer (LBF / bottom-left on valid configs)
  → rotation as continuous or fine discrete state of the placer
  → multi-start order + local/evolutionary improvement
  → multi-objective score + always keep best feasible
```

### D.2 Placement

- **Primary:** Bottom-Left / Lowest-Bounding-Fit family on collision-valid candidate set (NFP vertices/edges or CDE-guided search).
- **Not:** AABB-only packing for irregular production quality.

### D.3 Rotation

- Engine-owned; user never selects angles.
- Start with **cascaded discrete search** (proven in legacy): coarse → refine → fine.
- Design API so **continuous rotation** (jagua-style) can replace cascade later without rewriting optimizer.
- Do **not** rank orders at 0° if the production path uses free angles.

### D.4 Ordering & optimization

- Multi-start heuristic orders + evolutionary / local search.
- Every candidate evaluated with the **same placement+rotation fidelity** used for the champion (or an explicitly calibrated surrogate with measured correlation).
- Always retain a strong constructive baseline (legacy lesson: `area_desc + full`).

### D.5 Scoring (new)

Separate module; **not** bounds-only:

| Priority | Metric |
|----------|--------|
| P0 | Feasibility (all parts placed) |
| P1 | Sheet count |
| P2 | Material utilization / waste |
| P3 | Packed AABB (legacy-comparable) |
| P4 | Fragmentation / hole fill quality (later) |
| P5 | Runtime / candidate budget |

Report **all** metrics in benchmarks even if optimization weights change.

### D.6 Geometry kernel options (decision gate before ETAP 3)

| Option | Pros | Cons |
|--------|------|------|
| **A. TypeScript + Clipper2** (legacy-like) | Fast to ship; browser-native; team already knows | Numeric/perf ceiling; reinvent CDE |
| **B. Rust (jagua-rs) + WASM** | Modern CDE; continuous rot; academic backing | MPL review; WASM glue; learning curve |
| **C. Hybrid** | TS optimizer + Rust geometry | Two runtimes; API discipline required |

**Recommendation for ETAP 0→1:** Design **kernel-agnostic traits** (Solid, collide, NFP/offset). Implement **Option A first** for Geometry Core tests, keep **Option B** as ETAP 3/11 candidate after license review — do not hard-wire Clipper into optimizer APIs.

---

## E. New Engine Architecture

### E.1 Package layout (proposed)

```
malt-nest-engine/                 # standalone package / repo
  package.json | Cargo.toml       # see §F
  src/
    api/                          # NestRequest → NestResult
    geometry/
      svg/                        # parse, normalize, curves→polyline
      solid/                      # polygon, holes, winding, validity
      ops/                        # transform, bbox, area, centroid
      collide/                    # intersection / containment
      offset/                     # gap / kerf
    nfp/                          # outer/inner NFP + cache (or CDE adapter)
    placement/                    # sheet model, candidates, LBF
    rotation/                     # search policies (cascade / continuous)
    ordering/                     # order generators
    optimize/                     # multi-start, GA, local search
    score/                        # multi-metric
    bench/                        # fixtures + reporters
  tests/
    golden/                       # geometry & NFP goldens
    fixtures/                     # rect, L, U, holes, Demo subset
  benches/
```

**Legacy app** (`malt-nest`) remains UI + LEGACY ENGINE until ETAP 10. New engine has **zero imports** from `src/nesting` / `src/geometry` of legacy (may share SVG fixtures only).

### E.2 I/O sketch

**Input**

```ts
NestRequest {
  parts: PartGeometry[]      // from SVG
  sheets: SheetSpec[]        // W, H, margin, quantity
  config: {
    gapMm,                   // spacing between parts
    timeBudgetMs?,
    seed?,
    scoreWeights?,
    rotationPolicy?,         // engine-internal
  }
}
```

**Output**

```ts
NestResult {
  status: 'ok' | 'partial' | 'failed' | 'cancelled'
  placements: { partId, sheetIndex, x, y, rotationDeg }[]
  sheets: SheetResult[]
  metrics: {
    sheetCount, placedCount, unplacedCount,
    utilization, wasteMm2, packedBoundsMm2,
    fragmentation?, runtimeMs, candidatesEvaluated?
  }
  debug?: { ordersTried, angleSamples, ... }
}
```

### E.3 Layer contracts

1. **Geometry Core** — pure, deterministic, no optimizer types  
2. **NFP/CDE** — `(A,B,spacing) → placement space / collide queries`  
3. **Placement** — given order + rotation policy → layout  
4. **Optimize** — generates (order, rotation seeds) → Placement → Score  
5. **Score** — NestResult → comparable key (lexicographic or weighted)  
6. **Bench** — fixtures → metrics JSON (legacy-comparable fields always present)

---

## F. Technology Recommendation

| Stack | When |
|-------|------|
| **TypeScript (primary for ETAP 1–6)** | Matches product (Vite/browser), fastest iteration, vitest goldens, Clipper2 already proven in legacy |
| **Rust + WASM (geometry accel, ETAP 3/11)** | If CDE/NFP becomes the bottleneck; evaluate jagua-rs under MPL |
| **C++ libnest2d** | Only if shipping native desktop and accepting LGPL — **not first choice** for browser Malt Nest |
| **Pure JS SVGnest fork** | Reject as product base — architectural debt |

**Default recommendation:**  
**New engine = TypeScript package `malt-nest-engine`**, browser + Node, Clipper2 (or abstracted) for ETAP 1–5, **WASM slot** reserved in NFP module for ETAP 11. Optimizer stays TS. UI stays React app that later calls the package API.

---

## G. Stage Plan (ETAP 0–11)

### ETAP 0 — Architecture + research *(this document)*

- **Goal:** Freeze legacy; choose direction; define DoD  
- **Modules:** docs only  
- **Tests:** n/a  
- **Exit:** Report accepted; package boundary agreed  

### ETAP 1 — Geometry Core

- **Goal:** Robust solids from SVG/paths  
- **Modules:** `geometry/svg`, `solid`, `ops`  
- **Tests:** winding, holes, area, rotate/translate golden; rect/L/U/concave  
- **Exit:** Deterministic polygon pipeline; no nesting yet  

### ETAP 2 — Sheet + Placement primitives

- **Goal:** Place one part on empty sheet collision-free  
- **Modules:** sheet model, collide stub, trivial placer  
- **Tests:** margin, gap offset, out-of-sheet rejection  
- **Exit:** Single-part placement API stable  

### ETAP 3 — NFP / Collision Engine

- **Goal:** Correct outer (+ inner) fit / collide for pairs  
- **Modules:** `nfp/` or CDE adapter + cache  
- **Tests:** golden NFP for convex/concave/holes; spacing  
- **Exit:** Pairwise placement candidates match goldens; perf budget documented  

### ETAP 4 — Basic Nesting

- **Goal:** Multi-part nest, fixed angles (e.g. 0/90)  
- **Modules:** LBF placer, multi-sheet  
- **Tests:** identical rects, mixed orthogonal irregulars  
- **Exit:** Feasible nests; metrics reported  

### ETAP 5 — Free-angle Rotation

- **Goal:** Engine-chosen angles  
- **Modules:** `rotation/` cascade (or continuous)  
- **Tests:** L/U improve vs 0°; Demo subset  
- **Exit:** Free-angle beats fixed-angle on fixtures; no UI  

### ETAP 6 — Ordering + Optimization

- **Goal:** Multi-start / evolutionary improvement  
- **Modules:** `ordering/`, `optimize/`  
- **Tests:** ranking uses production fidelity; baseline never lost  
- **Exit:** Optimizer ≥ constructive baseline on fixtures  

### ETAP 7 — Advanced Scoring

- **Goal:** Multi-metric score module  
- **Modules:** `score/`  
- **Tests:** weight changes don’t break feasibility-first  
- **Exit:** Documented score + always emit full metric vector  

### ETAP 8 — Benchmark Suite

- **Goal:** Automated benches (not only Demo)  
- **Modules:** `bench/`, fixtures 1–10 from brief  
- **Tests:** CI-capable small suite; nightly Demo  
- **Exit:** JSON reports: bounds, util, sheets, runtime, rotations  

### ETAP 9 — Legacy Comparison

- **Goal:** Head-to-head vs LEGACY BASELINE  
- **Modules:** adapter that runs both engines on same SVG  
- **Tests:** Demo 1600×1000 gap5 margin10  
- **Exit:** Report table; new engine meets quality gate (see §I)  

### ETAP 10 — UI Integration

- **Goal:** Malt Nest UI calls new engine  
- **Modules:** thin adapter in app; feature flag  
- **Tests:** smoke nest from UI  
- **Exit:** Legacy engine removable behind flag  

### ETAP 11 — Performance / WASM / Workers

- **Goal:** Scale without algorithm rewrite  
- **Modules:** workers, WASM geometry, parallel eval  
- **Tests:** same quality, lower p50 runtime  
- **Exit:** Demo budget target TBD after ETAP 9 quality lock  

**Hard rule:** Do not start ETAP *n+1* until ETAP *n* exit criteria pass. No premature UI (ETAP 10). No premature WASM (ETAP 11).

---

## H. Risk Analysis

| Risk | Why it matters | Mitigation |
|------|----------------|------------|
| **NFP correctness** | Wrong NFP → overlaps or empty space | Golden tests; independent collide verify after place |
| **Polygon robustness** | SVG curves, self-intersections, winding | Normalize early; reject/repair invalid; RDP tolerance policy |
| **Holes** | Inner NFP / part-in-part | Explicit hole tests from ETAP 1/3 |
| **Free-angle cost** | Legacy ~195 s for one full cascade | Surrogates only with measured correlation; cache; later WASM |
| **Numerical precision** | Float gaps / micro-overlaps | Exact predicates or ε policy + snap; Clipper integer scale |
| **SVG curves** | Arc/bezier approx error | Configurable tolerance; document vs CNC kerf |
| **Browser limits** | Main-thread jank, memory | Workers from day one of app integration; engine Node-runnable |
| **License** | MPL/LGPL if adopting crates | Legal review before dependency; prefer clean-room |
| **Bounds worship** | Optimizing only AABB | Multi-metric score + utilization gates |
| **Scope creep** | DXF, common-line, cloud | Park until after ETAP 9 |

---

## I. Definition of Done (production-ready)

New engine is production-ready when **all** hold:

1. **Independence:** No runtime dependency on legacy `src/nesting` / legacy optimizer.  
2. **Correctness:** Golden geometry + NFP tests green; zero overlaps on fixture suite (collide verify).  
3. **Feasibility:** Demo.svg 16/16 placed on 1600×1000 (or documented multi-sheet with better score).  
4. **Quality gate:** On Demo fixture, new engine is **not worse** than legacy on the lexicographic key:  
   `(unplaced ↑, sheets ↑, waste/util, packedBounds)` — exact weights frozen in ETAP 7.  
   Packed bounds alone ≤ **780,097 × (1+ε)** is necessary but **not sufficient**.  
5. **Rotation:** Free angles engine-driven; no user angle UI required.  
6. **API:** Stable `NestRequest` → `NestResult` from Node and browser worker.  
7. **Bench:** Automated suite + legacy comparison report checked into CI/nightly.  
8. **Perf:** Documented budget; Worker/WASM plan exists (ETAP 11) if Demo > agreed SLA.  
9. **License:** All deps reviewed.  
10. **UI swap:** Feature-flagged cutover with rollback to legacy for one release.

---

## Immediate next step (after ETAP 0 approval)

1. Approve this report (especially §D kernel choice and §F TS-first).  
2. Scaffold **empty** `malt-nest-engine` package (ETAP 1 start) — **no** legacy imports.  
3. Freeze legacy tree: no Stage1/2/NFP/BLF patches unless critical production hotfixes outside this rebuild track.

---

## Appendix — Legacy reference numbers

| Run | Bounds | Time |
|-----|--------|------|
| Legacy Stage1 full (`area_desc`) | **780,097** | ~195 s |
| Legacy Stage2 champion (coarse+seed path) | 988,815 | ~153 s |
| Orthogonal BLF (historical) | ~1,064,493 | ~7 s |

**Correlation lesson (order×depth profile):** `area_desc` ranks #9 at 0°, #5 at coarse/medium, **#1 at full**. Surrogate ranking without full fidelity is a known failure mode — new engine must not repeat it.
