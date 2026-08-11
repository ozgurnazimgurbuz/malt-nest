# Basic Nesting Engine (ETAP 4)

Deterministic **bottom-left fill** using real NFP constraints.  
No GA, free-angle search, beam search, or multi-start optimizer.

## API

```ts
nest(parts: Shape[], sheet: Sheet, config: NestConfig): NestResult
```

### NestConfig

| Field | Default | Meaning |
|-------|---------|---------|
| `gap` | required | Clearance (mm) — same semantics as Placement |
| `ordering` | `area_desc` | Deterministic sort strategy |
| `rotation` | `orthogonal` | Angle policy (not a search) |
| `maxSheets` | `parts.length` | Multi-sheet cap |
| `debug` | `false` | Per-part candidate diagnostics |

### NestResult

- `sheets[]` / `placements[]` (each with `sheetIndex`)
- `unplaced[]` with reasons: `too-large` | `no-valid-placement` | `invalid-geometry`
- `metrics`: sheetCount, usedPartArea, sheetArea, utilization, waste, **packedBoundsMm2** (metric only)
- `runtimeMs`, `diagnostics` (NFP / validation / candidate counts)

## Ordering

Module: `src/ordering`

Strategies: `area_desc` | `bbox_area_desc` | `height_desc` | `width_desc`  
Tie-break: `shape.id` ascending, then input index. No randomness.

## Rotation policy

Module: `src/rotation` — see [rotation.md](rotation.md).

| Policy | Behavior |
|--------|----------|
| `none` | `[0]` |
| `fixed` | caller angles |
| `orthogonal` | `[0, 90, 180, 270]` |
| `free` | RotationSearch cascade (coarse→refine→final) |

## Candidate generation (NFP)

1. Rotate part about centroid → orbiting solid at origin.
2. **Inner NFP** vs usable sheet rectangle → free-in-sheet region.
3. For each placed part: **Outer NFP** (with `gap`) → forbidden region.
4. `free = IFP \\ ∪ OuterNFP` via Clipper difference.
5. Candidates = free-region **vertices + edge midpoints** (sorted by Y, then X).

Not AABB-grid placement. Final acceptance still goes through `validatePlacement`.

## Placement selection

Per part, per sheet:

- Try each rotation; take bottom-left valid candidate for that rotation.
- Across rotations: min Y → min X → min `rotationDeg`.
- Validate: broad AABB → NFP filter → `validatePlacement` (sheet + gap).

## Sheet / margin / gap

- Sheet usable region = margin inset (same as Placement).
- Gap applied in Outer NFP **and** final validator (must agree).
- `gap = 0`: touching OK; overlap invalid.
- `gap = 5`: separation < 5 invalid.

## Multi-sheet

Try existing sheets in order. If no fit and not `too-large`, open a new sheet (until `maxSheets`).  
`NestResult.sheets` is ready for multi-sheet UI later.

## Determinism

Same parts + sheet + config → identical placements (positions, rotations, sheet indices).

## Metrics

`packedBoundsMm2` = sum of per-sheet used AABB areas. **Not** a fitness score — just a reported metric.

## NFP cache

`createNfpCache` / `makeNfpCacheKey` — session Map keyed by  
`(kind, ids, rotations, gap)`. No aggressive global LRU yet.

## Limitations

- Discrete candidates only (vertices/midpoints) — may miss some continuous optima.
- Orthogonal / fixed angles only.
- No hole-as-container nesting of other parts into placed holes (outer NFP free pockets exist; BLF does not specially target them beyond free-region vertices).
- No ordering/angle optimization — quality is “valid + deterministic BLF”, not “best nest”.
