# Stage 9 — Pre-change baseline (Stage 8 engine)

**Date:** 2026-08-10  
**Sheet:** 400 × 300 mm, margin 5 mm, spacing 2 mm, rotations 0/90/180/270  
**Evolutionary:** `optimizationLevel=fast`, `timeLimitMs=400`, `seed=7`  
**Engine:** Stage 8 hybrid Clipper2 + BLF + evolutionary (no Stage 9 multi-start / local search yet)

> Do not delete. Stage 7 fixture suite results preserved conceptually in `src/geometry/fixtures.ts`.

## Fixture results

| Fixture | Engine | Placed | Unplaced | Sheets | Util % | Waste score term | Compactness (bbox area sum) | Score | Runtime ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| rectangles | blf | 5/5 | 0 | 1 | 2.9 | (in score) | — | 1110881 | 33 |
| rectangles | evo | 5/5 | 0 | 1 | 2.9 | — | — | 1110786 | 401 |
| triangles | blf | 4/4 | 0 | 1 | 2.0 | — | — | 1114165 | 24 |
| triangles | evo | 4/4 | 0 | 1 | 2.0 | — | — | 1111957 | 401 |
| circles | blf | 4/4 | 0 | 1 | 2.5 | — | — | 1114205 | 413 |
| circles | evo | 4/4 | 0 | 1 | 2.5 | — | — | 1114205 | 1604 |
| L | blf | 3/3 | 0 | 1 | 2.2 | — | — | 1111892 | 36 |
| L | evo | 3/3 | 0 | 1 | 2.2 | — | — | 1111612 | 363 |
| C | blf | 3/3 | 0 | 1 | 3.1 | — | — | 1110884 | 34 |
| C | evo | 3/3 | 0 | 1 | 3.1 | — | — | 1110884 | 404 |
| U | blf | 3/3 | 0 | 1 | 3.1 | — | — | 1110884 | 29 |
| U | evo | 3/3 | 0 | 1 | 3.1 | — | — | 1110884 | 402 |
| stars | blf | 3/3 | 0 | 1 | 1.0 | — | — | 1112858 | 196 |
| stars | evo | 3/3 | 0 | 1 | 1.0 | — | — | 1112738 | 662 |
| letters | blf | 4/4 | 0 | 1 | 2.8 | — | — | 1111062 | 175 |
| letters | evo | 4/4 | 0 | 1 | 2.8 | — | — | 1111062 | 593 |
| holes | blf | 3/3 | 0 | 1 | 5.3 | — | — | 1109855 | 5 |
| holes | evo | 3/3 | 0 | 1 | 5.3 | — | — | 1109655 | 137 |
| multiHoles | blf | 3/3 | 0 | 1 | 7.3 | — | — | 1108101 | 4 |
| multiHoles | evo | 3/3 | 0 | 1 | 7.3 | — | — | 1107961 | 124 |
| mixedIrregular | blf | 5/5 | 0 | 1 | 3.3 | — | — | 1113253 | 492 |
| mixedIrregular | evo | 5/5 | 0 | 1 | 3.3 | — | — | 1111023 | 1313 |
| manySmall | blf | 16/16 | 0 | 1 | 2.1 | — | — | 1111426 | 129 |
| manySmall | evo | 16/16 | 0 | 1 | 2.1 | — | — | 1111426 | 511 |
| fewLarge | blf | 3/3 | 0 | 1 | 39.7 | — | — | 1081266 | 11 |
| fewLarge | evo | 3/3 | 0 | 1 | 39.7 | — | — | 1080956 | 253 |
| mixedSizes | blf | 6/6 | 0 | 1 | 10.6 | — | — | 1105901 | 104 |
| mixedSizes | evo | 6/6 | 0 | 1 | 10.6 | — | — | 1105521 | 415 |

## Notes

- All fixtures placed with **0 unplaced** on a single sheet (sheet is oversized vs parts → low utilization %).
- Evolutionary sometimes improves **score** (compactness / waste terms) without changing sheet count.
- Circles / mixed irregular are NFP-heavy (runtime).
- Score weights (Stage 8): `unplaced=1e7`, `sheet=1e6`, `waste=1`, `compactness=0.25`.

## Guarantees retained

- Optimized score ≤ BLF score (lower is better)
- Geometry / spacing / export regression suites green at Stage 8 (136 tests)
