# Malt Nest

Client-side 2D Auto Nesting web app (Stage 1 scaffold).

## Stack

- React + TypeScript + Vite
- Fully client-side (no backend)

## Run

```bash
npm install
npm run dev
```

Open the printed local URL (usually `http://localhost:5173`).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build |
| `npm run lint` | Oxlint |
| `npm run test` | Geometry unit tests |
| `npm run preview` | Preview production build |

## Module layout

| Path | Role |
| --- | --- |
| `src/svg/` | SVG → `GeometryPart[]` parser (units, transforms, paths) |
| `src/geometry/` | Engine-agnostic geometry types + ops |
| `src/nesting/` | BLF + NFP-candidate NestingEngine (Web Worker) |
| `docs/stage-3-nesting-architecture.md` | Research, licenses, recommended engine strategy |
| `src/rendering/` | SVG preview + geometry debug view |
| `src/export/` | Export stub (Stage 5+) |
| `src/ui/` | Panels and controls |
| `src/state/` | Shared app types and defaults |

### Geometry notes

- Internal units: **millimeters**
- Winding: outer contours **CCW**, holes **CW**
- Curve tolerance: `curveToleranceMm` (default `0.25`)
- AUTO NEST: BLF baseline → evolutionary optimizer (never worse than BLF)
- Optimization presets: Fast / Balanced / Deep (+ STOP for best-so-far)
