# Stage 3 — Nesting Engine Research & Architecture

**Status:** Research + architecture only. No nesting algorithm implemented.  
**Date:** 2026-08-10  
**Product:** Malt Nest (browser-based 2D nesting for fabrication)

Pipeline (unchanged contract):

```
SVG → GeometryPart[] → NestingEngine → NestingResult
```

UI and Stage 2 geometry must not depend on a specific engine implementation.

---

## 1. Technical comparison of reference projects

### 1.1 SVGNest ([Jack000/SVGnest](https://github.com/Jack000/SVGnest))

| Area | Notes |
| --- | --- |
| **Geometry** | SVG outlines → polygons; holes via containment; Clipper for boolean ops; curve linearization with tolerance |
| **Offset / spacing** | Part spacing via polygon offset (kerf-like gap) |
| **Collision** | NFP-based: placements chosen on NFP edges; IFP for bin interior |
| **Nesting** | NFP (orbital / Minkowski-style) + genetic algorithm on insertion order & rotation |
| **Placement** | Heuristic pick on NFP (gravity / compact); first-fit-decreasing seed |
| **Fitness** | (1) unplaceable parts (2) bin count (3) packed width |
| **Rotation** | Discrete “number of rotations” (e.g. 4 → 0/90/180/270); larger N = denser angle set |
| **Multi-sheet** | Multiple bins; minimize bin count |
| **Part-in-part** | Optional nesting into holes |
| **Runtime** | Browser JS + Web Workers; NFP cache; continuous improve until stop |
| **Fabrication fit** | Strong for laser/CNC demos; units historically SVG/px-centric |

**Takeaways for Malt:** NFP + GA + workers is the proven browser pattern. Fitness overly biased to width → Malt should use multi-term scoring.

### 1.2 DeepNest Next ([deepnest-next/deepnest](https://github.com/deepnest-next/deepnest))

| Area | Notes |
| --- | --- |
| **Lineage** | Fork/evolution of SVGNest / Deepnest for CNC (laser, plasma, plotter) |
| **Geometry** | SVG/DXF paths; improved path approximation for complex parts |
| **Nesting** | Same family: NFP + evolutionary search; speed-critical pieces moved to native (C, planned Rust) |
| **Extras** | Common-line merge for cuts; DXF via conversion; desktop Electron-style app |
| **Runtime** | Native Node modules for hot paths; roadmap toward cloud nesting |
| **Fabrication fit** | Closer to real shop use than pure SVGNest demo |

**Takeaways for Malt:** Keep JS/TS engine first; reserve WASM/native for NFP/boolean hot path later. Common-line is a Stage 8+ concern, not Stage 4.

### 1.3 libnest2d ([tamasmeszaros/libnest2d](https://github.com/tamasmeszaros/libnest2d))

| Area | Notes |
| --- | --- |
| **Geometry** | C++11, templated backends; default Clipper + Boost.Geometry; integer coords in Clipper backend |
| **Holes / concavity** | README: works well for rectangles & **convex** closed polygons; holes/concavities incomplete |
| **Nesting** | NFP placer + first-fit selection; local optimization (NLopt); used in PrusaSlicer arrangement |
| **Rotation** | Configurable via placer/selection policies |
| **Multi-sheet** | Bin packing with multiple bins |
| **Runtime** | Native C++; WASM possible but heavy (Clipper, Boost, NLopt) |
| **Fabrication fit** | Proven in slicer bed arrangement; not a full irregular industrial nester yet |

**Takeaways for Malt:** Excellent reference for **engine-agnostic** C++ API design. Not ideal as Stage 4 primary engine (LGPL + incomplete irregular/holes + WASM cost). Candidate for optional future `WasmNestingEngine` if license & quality bar are met.

### 1.4 ec-automatic-nesting ([mariokostelac/ec-automatic-nesting](https://github.com/mariokostelac/ec-automatic-nesting))

| Area | Notes |
| --- | --- |
| **Focus** | Academic: irregular ship-part nesting via evolutionary computing |
| **Value** | Confirms EC/GA as a standard metaheuristic for irregular nesting |
| **Maturity** | Minimal public docs; not a product engine |
| **License** | No clear SPDX license detected via GitHub API (treat as **do not reuse code**) |

**Takeaways for Malt:** Ideas only (chromosome design, EC literature). Do not depend on this repo.

### 1.5 Cura discussion ([Ultimaker/Cura#16695](https://github.com/Ultimaker/Cura/issues/16695))

| Area | Notes |
| --- | --- |
| **Problem** | Auto-nest many small parts on a bed; built-in arrange underperforms manual packing |
| **References cited** | pack3d (3D), Dalsoo bin packing (2D) |
| **Product lesson** | Users want “multiply & fit as many as practical,” not just collision-free placement; also care about process time vs density tradeoffs |

**Takeaways for Malt:** Expose optimization profiles (fast / balanced / max utilization) and stop criteria (`timeLimitMs`). Score must reflect sheet count + waste, not only bbox width.

---

## 2. Algorithm comparison

| Option | Strengths | Weaknesses | Browser | Difficulty | Quality | Perf | Maintainability |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A. Pure GA + NFP** | Explores order/rotation; SVGNest-proven | Slow cold start; noisy; width-biased fitness if naive | Excellent w/ workers | High | High given time | Medium | Medium |
| **B. Heuristic + NFP** | Fast, predictable; BL/BLF-style | Local optima; weak on concave / order-sensitive jobs | Excellent | Medium | Medium | High | High |
| **C. Hybrid heuristic + evolutionary** | Good first nest fast; improves over time | More moving parts | Excellent | High | High | High→Medium | Medium–High |
| **D. Existing engine behind abstraction** | Faster to “something works” | License, quality gaps, UI coupling risk | Varies | Low–Med integrate | Varies | Varies | Low (foreign code) |
| **E. WASM/native** | Best CPU for NFP/Clipper | Build chain, LGPL/GPL traps, debug cost | Good once built | Very high | Potentially highest | Highest | Hard |

### Recommendation (algorithms)

**Primary strategy: C — Hybrid Heuristic + Evolutionary Optimization**, with NFP-based placement.

1. **Seed:** area-sorted first-fit / bottom-left-fill using NFP + IFP  
2. **Improve:** GA (or evolutionary strategies) on gene = `{order, rotationIndex}` with time budget  
3. **Always show best-so-far** + progress events  

Do **not** ship D as the core (license + quality control). Keep E as Stage 6+ acceleration behind the same `NestingEngine` interface.

---

## 3. License comparison (commercial relevance)

| Project | License | Commercial use | Copyleft / redistribution | Notes |
| --- | --- | --- | --- | --- |
| **SVGNest** | **MIT** | Yes | Attribution in copies/substantial portions | Safest reference for ideas; code reuse OK if MIT notice kept |
| **DeepNest Next** | Main **MIT**, but **mixed** | Caution | `/main/deepnest.js` listed **GPLv3** in LICENSES.md; Clipper/Minkowski **Boost** | Do **not** copy GPLv3 units into a proprietary Malt Nest. Prefer clean-room + MIT/Boost-safe deps |
| **libnest2d** | **LGPL-3.0** | Yes with care | Dynamic linking / LGPL obligations if shipping modified library | WASM static link into proprietary app is legally sensitive — avoid without counsel |
| **ec-automatic-nesting** | **Unclear** | Assume no | Unknown | Ideas only |
| **Clipper** (common dep) | **Boost** | Yes | Permissive | Good candidate for offset/boolean (JS port or WASM) |
| **Cura issue** | N/A | N/A | N/A | Discussion only |

### A / B / C separation

| Class | What |
| --- | --- |
| **A. Independently implement (preferred)** | NFP concepts, Minkowski difference theory, GA chromosome design, BLF heuristics, scoring models, worker protocol — from papers + clean-room code |
| **B. Potentially reusable (with compliance)** | MIT SVGNest routines; Boost-licensed Clipper; carefully vetted MIT Deepnest-next files **excluding GPLv3 units** |
| **C. Do not copy** | Deepnest GPLv3 modules; libnest2d sources into proprietary bundle without LGPL plan; any unlicensed academic repo code |

**Malt Nest policy for Stage 4+:** clean-room TypeScript engine + optional Boost/MIT geometry libs. No GPLv3 in the core path. Revisit WASM/libnest2d only with an explicit licensing decision.

---

## 4. Recommended nesting strategy

**Hybrid NFP placer + evolutionary improver**, engine-agnostic API.

Phases (future Stage 4/5):

1. **Prepare:** offset parts by `spacingMm/2` (+ optional kerf); discretize rotations  
2. **Place:** IFP for sheet; NFP vs placed set; pick candidate by compact heuristic (not width-only)  
3. **Improve:** mutate order/rotations under `timeLimitMs` / `optimizationLevel`  
4. **Multi-sheet:** open new sheet when IFP empty; minimize sheet count first  
5. **Report:** placements, per-sheet utilization/waste, stats, progress  

Default product rotations: `0/90/180/270` with path to custom step and arbitrary angles.

---

## 5. Recommended NFP strategy

| Topic | Decision |
| --- | --- |
| **Representation** | Outer ring + holes (already in `GeometryPart`); nesting uses inflated/offset polygons |
| **NFP method (Stage 4)** | Orbital / edge-sliding NFP for polygon pairs; cache by `(partA,rotA,partB,rotB)` |
| **Multi-part obstacle** | Union of NFPs vs placed parts (Clipper-style boolean) — Stage 4 simple union; refine later |
| **IFP** | Inner-fit polygon of part inside sheet rectangle (minus margins) |
| **Robustness** | Integer or scaled fixed-point for boolean ops; epsilon cleanup; reject empty/self-intersecting inputs with warnings |
| **Acceleration (later)** | WASM Clipper or native Minkowski for NFP generation |

Holes: Stage 4 may treat holes as non-placeable interior (no part-in-part). Part-in-part = roadmap flag.

---

## 6. Recommended optimization strategy

| Knob | Behavior |
| --- | --- |
| `optimizationLevel: 'fast' \| 'balanced' \| 'max'` | Maps to population size, generations, and local search depth |
| `timeLimitMs` | Hard stop; return best-so-far |
| **Gene** | Permutation of part instances + rotation choice index |
| **Operators** | Order crossover / swap mutation / rotation mutation |
| **Elitism** | Keep best individuals |
| **Determinism** | Optional seed for reproducible nests |

---

## 7. Recommended browser / WASM architecture

```
UI (React)
  → NestingSession (main thread façade)
    → Web Worker
      → NestingEngine (TS hybrid)
           ↳ future: WasmNfpBackend
```

- UI stays responsive; worker posts `progress` `{ ratio, phase, bestScore }`  
- Cancel via `AbortSignal` / worker `cancel` message  
- Stage 4: TypeScript engine in worker  
- Stage 6+: optional WASM for NFP/boolean only — same `NestingEngine`  

**Realistic for Malt Nest now:** browser JS/TS + Web Worker. Native desktop/cloud is out of scope.

---

## 8. Proposed module tree

```
src/nesting/
  types.ts              # request/result/sheet/placement types
  engine.ts             # NestingEngine interface + progress events
  scoring.ts            # ScoreBreakdown + weight config (no final formula hard-lock)
  nest.ts               # façade used by UI (placeholder until Stage 4)
  index.ts

  # Stage 4+ (not created yet — reserved)
  core/                 # prepare parts, rotations, sheet frames
  nfp/                  # NFP/IFP compute + cache
  collision/            # overlap tests / boolean helpers
  placement/            # BLF / NFP candidate selection
  optimization/         # GA / evolutionary loop
  engines/              # HybridTsEngine, future WasmEngine
```

| Module | Responsibility |
| --- | --- |
| `types` | Engine-agnostic DTOs |
| `engine` | Contract: `nest`, cancel, progress |
| `scoring` | Multi-term score; weights by profile |
| `core` | Normalize inputs, expand quantities, apply spacing offsets |
| `nfp` | Pairwise NFP, IFP, cache |
| `collision` | Fallback geometric predicates |
| `placement` | Sequential placement policies |
| `optimization` | Metaheuristics |
| `engines` | Swappable implementations |

Geometry (`src/geometry`) and SVG (`src/svg`) remain upstream-only producers of `GeometryPart[]`.

---

## 9. Proposed data structures

See TypeScript stubs in `src/nesting/types.ts`, `engine.ts`, `scoring.ts`.

Summary:

- `SheetDefinition` — size, margin, quantity, optional remnant id  
- `NestingRequest` — parts, sheets, settings  
- `NestingSettings` — spacing, rotations, optimization, time limit, future grain/priority hooks  
- `Placement` — partId, sheetIndex, x, y, rotation  
- `SheetResult` — utilization, waste, bounds used  
- `NestingResult` — placements, sheets, stats, timing  
- `ScoreBreakdown` — sheet/waste/compact/cut terms (weights configurable)

UI `state.NestSettings` / `SheetSettings` map into `NestingRequest` (adapter in façade).

---

## 10. Proposed `NestingEngine` interface

```ts
interface NestingEngine {
  readonly id: string
  nest(request: NestingRequest, options?: NestingRunOptions): Promise<NestingResult>
}
```

`NestingRunOptions`: `signal`, `onProgress`.  
UI never imports `nfp/` or `optimization/` — only `nest()` / engine façade.

---

## 11. Proposed scoring architecture

Conceptual (weights not frozen):

```
score =
  wSheet  * sheetPenalty
+ wWaste  * wastePenalty
+ wTight  * compactnessPenalty
+ wCut    * cutPenalty          // future
+ wUnplaced * unplacedPenalty
```

| Term | Intent |
| --- | --- |
| sheetPenalty | Prefer fewer sheets |
| wastePenalty | Unused area / low utilization |
| compactnessPenalty | Prefer tight used bbox (height & width), not width-only |
| cutPenalty | Future: toolpath / common-line proxies |
| unplacedPenalty | Hard fail pressure |

Profiles (`fast` / `balanced` / `max`) only change weights + search budget, not the engine API.

---

## 12. Future implementation roadmap

| Stage | Scope |
| --- | --- |
| **4** | Hybrid TS engine in worker: offset, IFP/NFP v1, BLF seed, simple GA, progress, multi-sheet quantity=1..n |
| **5** | Live preview of best-so-far; cancel; richer stats |
| **6** | SVG export of nest; optional WASM Clipper/NFP |
| **7** | Part duplication UI, custom rotation step, priority |
| **8** | Common-line / CNC path hints |
| **9** | DXF; grain; remnants; kerf; part-in-part; Illustrator |

Fabrication roadmap (architecture-ready, unimplemented): kerf, common-line, part-in-part, holes-as-bins, remnants, grain, margins, cut order, SVG/DXF/PDF export.

---

## Final recommendation (executive)

**Build a clean-room, engine-agnostic Hybrid NestingEngine in TypeScript:**

1. **NFP + IFP** for geometrically valid irregular placement (with cache)  
2. **Heuristic seed** for immediate practical layouts  
3. **Evolutionary improvement** under a time budget  
4. **Multi-term scoring** (sheets, waste, compactness — not bbox-width alone)  
5. **Web Worker** for UI responsiveness; **WASM later** only as a backend behind the same interface  
6. **Do not** vendor GPLv3 Deepnest code or LGPL-link libnest2d into the proprietary core without a separate legal decision  

This answers *“most practical way to cut these parts from these sheets”* better than a rectangle packer or a width-only SVGNest clone, while staying commercially safer and replaceable.
