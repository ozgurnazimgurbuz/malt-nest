# Stage 10E — Minkowski internal profile

Fixture Demo.svg · part-12@180 × part-8@90 (110×110)

## Input geometry
- A verts=110 convex=false collinear~=0
- B verts=110 convex=false collinear~=0
- A area holes=0 B holes=0
- After +5mm offset: verts=241 (5.0 ms)

## Convex decomposition (fallback path only)
- A pieces=239 B pieces=108 · 3.2 ms
- Pairwise Minkowski count if used: 25812

## Primary path timings (Clipper minkowskiDiffD)
| step | ms |
| --- | ---: |
| offset (+5mm) | 5.0 |
| path construction (ringToPathD) | 0.0 |
| minkowskiDiffD | 1617.4 |
| pathsDToMultiPolygons | 0.3 |
| computeNfp full (incl offset) | 1511.5 |
| method | minkowski-clipper |

## Intermediate geometry
- Clipper output paths: 1
- Clipper output total vertices: 227
- regions after convert: 1
- union/output vertices (regions): 227
- theoretical vertex-pair product |A|×|B|: 26510

## Probe: collinear simplify before Minkowski (not applied)
- verts 241→228 × 110→110
- minkowskiDiffD after simplify: 1376.8 ms (vs 1617.4 ms)
- output paths 1 verts 214
- eps=0.05mm: verts 83×106 → 250.9 ms

## Baseline BLF (Demo.svg FAST settings)
- BLF wall: **36.15 s**
- NFP time sum: **29.48 s**
- Minkowski calls: 456 · 29407 ms
- part-12↔part-8 NFP ms sum: 4934
- placed 16/16 sheets 1 util 6.70%
