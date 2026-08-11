# Geometry Core (ETAP 1)

Standalone package: `malt-nest-engine`. **No nesting / NFP / optimizer.**

## Coordinate system

- **Units:** millimetres (`mm`).
- **Axes:** SVG user space — **X right, Y down** (SVG convention). SVG user units are interpreted as mm.
- **Origin:** whatever the SVG (or constructed geometry) uses; transforms are absolute in that space.

## Polygon representation

| Type | Meaning |
|------|---------|
| `Point` | `{x,y}` in mm |
| `Ring` | Closed contour; first ≠ last (implicit close) |
| `Polygon` | `outer` + `holes[]` |
| `Shape` | Named part: one or more polygons |
| `BoundingBox` | Axis-aligned min/max |

## Winding convention

After `normalizeShape` / `normalizePolygon`:

- **Outer:** positive `signedArea` → **CCW** in coordinate axes
- **Holes:** negative `signedArea` → **CW**

Shoelace uses the engine’s Y-down space; “CCW in axes” is the definition of positive area here.

## Precision model

Central config: `GeometryTolerance` / `DEFAULT_TOLERANCE` in `src/geometry/tolerance.ts`.

| Field | Role |
|-------|------|
| `abs` | Absolute equality (mm) |
| `rel` | Relative equality factor |
| `edgeMinLen2` | Degenerate edge threshold |
| `curveTolerance` | Curve → polyline chord error (mm) |
| `clipperScale` | Documented int scale for Clipper Path64 (`world * scale`); ETAP 1 uses PathsD floats, scale used in round-trip tests |

**Do not hard-code epsilons** in call sites — pass `GeometryTolerance`.

## Curve flattening

SVG `C/S/Q/T/A` and circle/ellipse are flattened with `curveTolerance` (de Casteljau / arc sampling).
Inherited SVG transforms are accounted for when choosing the local flattening tolerance, so magnification does not multiply the configured world-space error.

## Validity

`validateRing` rejects non-finite coordinates, explicit duplicate closing points, degenerate area, proper crossings, non-adjacent self-touches, and overlapping collinear segments. `validatePolygon` additionally requires every hole to be strictly inside its outer ring and requires holes to be mutually disjoint. `validateShape` rejects polygon pairs when an interior crossing or containment proves that their filled regions overlap; boundary-only contact is not treated as overlap.

## Backend abstraction

```
Geometry API  →  GeometryBackend  →  Clipper2 (clipper2-ts)
```

Default backend: `createClipper2Backend()`. Swap via `setGeometryBackend`. Pure TS still implements area/PIP/transforms without Clipper.

## SVG parsing

`parseSvg(markup)` → `Shape[]` + meta. Nesting config (sheet, gap, margin) is **out of scope**.

- Compound path subpaths are classified by containment depth: disjoint outer contours become separate polygons, odd-depth contours become holes, and even-depth nested islands become polygons.
- `matrix`, `translate`, `scale`, `rotate`, `skewX`, and `skewY` transforms compose through SVG/group/element ancestry.
- Malformed XML, path data, numeric attributes, transforms, and point lists throw instead of returning partial or defaulted geometry.
- `hasCurves` reports only parsed curve geometry, and traversal is iterative for deeply nested documents.
- Geometry below `defs`, `clipPath`, `mask`, and `symbol` is not emitted as nestable parts. Referenced `<use>` instances are not expanded yet.
