# Placement primitives (ETAP 2)

No NFP / nesting / optimization. This layer only **evaluates** placements.

## Sheet model

```ts
Sheet { width, height, margin }  // mm
```

- Coordinate system: same as Geometry Core (SVG axes, mm).
- **Usable region:** `[margin, margin] → [width−margin, height−margin]`.
- Margin is a sheet property, not baked into part geometry.
- API allows future non-rectangular sheets via a usable polygon; ETAP 2 implements AABB usable region.

## Placement model

```ts
Placement {
  shapeId
  position      // world-space centroid after placement
  rotationDeg   // arbitrary angle, CCW in SVG axes
  geometry      // transformed Shape
  bounds        // AABB of geometry
}
```

Immutable plain data; use `clonePlacement` for copies.

## Transformation order

Given original shape S, centroid C, rotation θ, target position P:

1. `normalizeShape(S)`
2. Translate by `−C` (centroid → origin)
3. Rotate by `θ` about origin
4. Translate by `+P` (centroid → P)

So **`position` = world centroid** of the placed part.

Rotation is a geometry operation, not a search.

## Gap vs margin

| Concept | Where | Meaning |
|---------|-------|---------|
| **margin** | Sheet | Keep solids inside usable region |
| **gap** | PlacementConfig | Minimum clearance between solids (mm) |

Gap is **not** permanently offset into Shape. Applied at validation time.

### Gap semantics

- `gap = 0`: positive material intersection area → `collision`. Pure edge touch → allowed (`touch`).
- `gap > 0`: inflate solid A by `gap` (Clipper), intersect with solid B; positive area → `gap-violation`. Exact separation `= gap` is allowed (zero intersection area after inflate).

## Collision architecture

1. **Broad-phase:** AABB overlap, expanded by `gap`.
2. **Narrow-phase:** Clipper2 boolean on solids (outer − holes); inflate for gap.

## Validation reasons

| Code | Meaning |
|------|---------|
| `ok` | Valid |
| `invalid-geometry` | Degenerate / invalid solid |
| `outside-sheet` | Outside usable region (margin) |
| `collision` | Material overlap |
| `gap-violation` | Clearance < gap |

## Tolerance

All comparisons use `GeometryTolerance` from Geometry Core (`config.tolerance` or `DEFAULT_TOLERANCE`). No hard-coded epsilons in placement logic.
