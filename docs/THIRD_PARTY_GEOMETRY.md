# Third-party geometry backend

## Selected

| Field | Value |
| --- | --- |
| Package | `clipper2-ts` |
| Version | `2.0.1-18` |
| License | Boost Software License 1.0 (BSL-1.0) |
| Role | Boolean ops, polygon offset, Minkowski NFP |

## Why

- Robust concave offset / boolean / Minkowski without shipping WASM
- Pure TypeScript — works in Vite Workers with no async init
- Same license family as upstream Clipper2 (BSL-1.0)
- Clean-room Malt Nest nesting code; Clipper used only as geometry primitive library

## Evaluated alternatives

| Option | Verdict |
| --- | --- |
| Custom TS only | Insufficient for production offset/boolean/concave NFP |
| `clipper2-wasm` 0.4.0 | Faster potential; WASM init + larger worker payload; deferred |
| Hybrid (chosen) | Custom cheap ops + Clipper for heavy polygon algebra |

## Policy

Do not copy SVGNest / DeepNest / libnest2d / jagua-rs / Sparrow source.  
Clipper is a geometry dependency only — nesting algorithms remain Malt Nest clean-room.
