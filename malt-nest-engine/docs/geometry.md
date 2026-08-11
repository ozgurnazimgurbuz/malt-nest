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

## Backend abstraction

```
Geometry API  →  GeometryBackend  →  Clipper2 (clipper2-ts)
```

Default backend: `createClipper2Backend()`. Swap via `setGeometryBackend`. Pure TS still implements area/PIP/transforms without Clipper.

## SVG parsing

`parseSvg(markup)` → `Shape[]` + meta. Nesting config (sheet, gap, margin) is **out of scope**.
