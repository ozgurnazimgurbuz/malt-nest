# NFP Engine (ETAP 3)

No nesting / ordering / optimizer. Computes **No-Fit / Inner-Fit regions** for a reference point.

## Algorithm choice

| Candidate | Notes |
|-----------|--------|
| SVGnest orbital sliding | Classic; slow for concave; hard with holes |
| Deepnest / deepnest-next | Same family + native accel |
| libnest2d | C++ NFP placers; LGPL |
| jagua-rs CDE | Modern continuous collision; MPL; great later backend |
| **Minkowski via Clipper2** | **Chosen for ETAP 3** |

**Why Minkowski + Clipper2:** Outer NFP for collision is exactly `A ⊕ (−B)` with `B` expressed relative to its reference point. We already depend on `clipper2-ts`, it handles concave polygons and hole solids (after `outer − holes`), and matches Placement’s **centroid** reference.

## Reference point

Orbiting shape is translated so its **centroid is at the origin**, then Minkowski is computed.  
NFP coordinates are therefore valid `Placement.position` values (world centroid).

## Output

```ts
NfpResult {
  kind: 'outer' | 'inner'
  regions: { outer, holes[] }[]  // filled regions
  gap, bounds, algorithm: 'minkowski-clipper2'
}
```

- **Outer NFP:** forbidden region (centroid here ⇒ material collision / gap violation).
- **Inner NFP:** free region (centroid here ⇒ orbiting ⊆ container, with gap).

## Gap

`gap > 0`: inflate stationary solid by `gap` before outer Minkowski (or erode container for inner). Clearance is not baked into Shape.

## Normalization

Rings cleaned; outers CCW; Minkowski artifact holes dropped for outer collision solids.
