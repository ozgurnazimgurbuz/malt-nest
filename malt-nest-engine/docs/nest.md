# Basic Nesting Engine (ETAP 4)

Deterministic **bottom-left fill** using real NFP constraints. Free-angle and
multi-start orchestration are separate engine modules; there is no GA.

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
| `tolerance` | `DEFAULT_TOLERANCE` | Geometry/NFP/placement tolerance |

The boundary rejects non-finite/negative gaps, invalid sheet or tolerance
values (`clipperScale` supports `1e-8…1e8`), non-positive/non-integer
`maxSheets`, and empty or duplicate shape IDs.

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
5. Candidates = free-region **vertices + edge midpoints**, analytical sheet
   AABB contacts, and validated NFP contact points for zero-measure/hole fits
   that polygon booleans cannot represent (sorted by Y, then X).

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
- Stationary-part and orbiting-part holes produce collision-free outer-NFP
  pockets; holes in an inner-NFP container are excluded from usable material.

## Multi-sheet

Try existing sheets in order. If no fit and not `too-large`, open a new sheet (until `maxSheets`).  
`NestResult.sheets` is ready for multi-sheet UI later.
Empty input returns zero sheets and zero sheet area.
If every part is invalid or too large, no empty sheet is reported; zero-area
results have zero utilization and zero waste.

## Determinism

Same parts + sheet + config → identical placements (positions, rotations, sheet indices).

## Metrics

`packedBoundsMm2` = sum of per-sheet used AABB areas. **Not** a fitness score — just a reported metric.

## NFP cache

`createNfpCache` / `makeNfpCacheKey` — bounded 512-entry session LRU keyed by geometry/topology,
canonical poses, gap, and tolerance. Distinct IDs with identical geometry reuse
pose-equivalent NFPs; outer entries are translation-normalized before caching.

## Limitations

- Discrete candidates only (vertices/midpoints) — may miss some continuous optima.
- Free-angle resolution is discrete and caller-configurable.
- Hole/concavity pockets are candidates when represented by NFP free-region boundaries.
- General concave IFP area still uses a conservative circular erosion. Missing
  zero-measure convex fits and zero/positive-gap concave boundary fits are
  recovered from the gap-eroded boundary and accepted only after exact
  containment revalidation. A useful non-boundary pose outside the conservative
  area can still be missed.
- Boundary recovery is bounded to 256 container anchors × 16 orbiting anchors
  (with area/AABB pruning), so unusually high-vertex shapes may omit contacts.
- No ordering/angle optimization — quality is “valid + deterministic BLF”, not “best nest”.
