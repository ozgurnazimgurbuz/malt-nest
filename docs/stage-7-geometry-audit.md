# Stage 7 — Geometry architecture audit

**Date:** 2026-08-10  
**Status:** Pre-change audit (Step 1)

## Pipeline

```
SVG → GeometryPart[] → prepareParts (rotate local) → BLF / evolutionary
                                              ↓
                                    NFP candidates + IFP clamp
                                              ↓
                                    solidsCollide / solidInsideRect
                                              ↓
                                    NestingResult
```

Optimizer calls `placeWithPlan` → same BLF placer (no second collision stack).

## Where operations live

| Concern | Module |
| --- | --- |
| Types (Point, Polygon, MultiPolygon, GeometryPart) | `geometry/types.ts` |
| Tolerance | `geometry/tolerance.ts` (`geomEps`) |
| Normalize / validate | `geometry/normalize.ts` |
| Area, bbox, point-in-polygon | `geometry/ops.ts` |
| Collision / distance / Solid | `geometry/collide.ts` |
| Containment / IFP | `geometry/containment.ts` |
| Offset (miter custom) | `geometry/offset.ts` |
| Convex decomp / hull / Minkowski convex | `geometry/convex.ts`, `minkowski.ts` |
| NFP | `geometry/nfp.ts` |
| NFP cache (LRU 256) | `geometry/cache.ts` |
| Part-in-part | `geometry/partInPart.ts` |
| Transforms | `geometry/transform.ts` |
| Candidates | `nesting/nfp/candidates.ts` |
| BLF | `nesting/placement/blf.ts` |
| Evolutionary | `nesting/optimization/*` |
| Worker | `nesting/worker/nestWorker.ts` |

## Contours / holes

- Outer: CCW (positive shoelace)
- Holes: CW
- `Solid = { outer, holes[], bounds }` — material = outer − holes
- Stage 6 collision bug (centroid in hole) fixed via solid-aware sampling

## Transforms

- `prepareParts` rotates about `partRotationOrigin` into local solid
- Placement translates local → world via `variantWorldSolid(x,y)`
- Angles are degrees (`angleDeg`); UI still 0/90/180/270

## NFP (Stage 6)

- Convex–convex: exact Minkowski difference (`exact: true`)
- Concave: ear-clip decomp → per-piece Minkowski → **no boolean union** (regions kept separate; viz hull) → `exact: false`
- Spacing: `offsetSolid(A, spacing)` then Minkowski
- Holes of A ignored in NFP (conservative for outer collision; part-in-part separate)

## Collision / spacing

- Broad-phase bbox
- Overlap: edge crossings + solid-aware samples
- Spacing: `solidsDistance < spacing` (boundary distance), not full offset collision

## IFP

- AABB translation bounds from part bbox vs sheet−margin
- Final check: `solidInsideRect` (vertices + edge midpoints)

## Cache

Key: part ids, rotations, spacing, geometry fingerprint.  
**Missing:** backend/version string (needed after Clipper adoption).

## Bottlenecks / risks

1. Concave NFP without union → redundant/overlapping regions, incomplete topology (no NFP holes)
2. Miter offset fragile on acute/concave/narrow channels
3. Spacing via vertex/edge distance ≠ geometric offset clearance
4. No robust boolean API for MultiPolygon
5. Clipper not yet used despite being industry standard for nesting

## Decision direction (post-benchmark)

Hybrid D:

- Custom TS: transforms, bbox, distance, cheap collision predicates
- `clipper2-ts` (BSL-1.0): union/difference/intersection/xor, inflate offset, Minkowski NFP
- Skip WASM for Stage 7 default (init + bundle cost; revisit if microbench demands)
