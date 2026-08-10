# Stage 10C — edgeVertex subsample

Fix for Stage 10B root cause: subsample `addEdgeVertexContacts` (≤36 edges × ≤36 verts),
matching `vertexPairs` sampling. NFP boundary unchanged. No hard candidate CAP.

```
# BLF Profile Report (Stage 10B)

PART 10 (part-9)
Vertices: 72
Holes: 0
BBox: 179.1 × 176.4 mm

ROTATION 0°
NFP: 1409.5 ms (9 calls, hit 0 / miss 9)
Candidates: 6125
Collision: 391.5 ms (2426 calls)
Total: 1951.3 ms · ACCEPTED

ROTATION 90°
NFP: 309.7 ms (9 calls, hit 0 / miss 9)
Candidates: 6135
Collision: 286.5 ms (2668 calls)
Total: 612.5 ms · ACCEPTED

ROTATION 180°
NFP: 225.9 ms (9 calls, hit 0 / miss 9)
Candidates: 6126
Collision: 218.3 ms (2667 calls)
Total: 460.4 ms · ACCEPTED

ROTATION 270°
NFP: 177.7 ms (9 calls, hit 0 / miss 9)
Candidates: 6178
Collision: 55.5 ms (2531 calls)
Total: 243.5 ms · ACCEPTED

TOTAL:
NFP time: 2122.9 ms
Candidate generation: 2283.4 ms
Collision: 951.6 ms
Placement: 3268.0 ms
Cache hit rate: 0.0% (0 hit / 36 miss)

## All parts (summary)
  #10 part-9 verts=72 cand=24564 place=3268ms placed=true

## Clipper ops (run total)
  minkowski: 36 calls · 2049.2 ms
  offset: 36 calls · 53.2 ms

## Collision (run total): 10292 calls · 951.6 ms

## Candidate sources (push counts before dedupe)
  nfpBoundary: 8530
  vertexPairs: 18432
  edgeVertex: 0
```

| Source | Count |
| --- | ---: |
| nfpBoundary | 8530 |
| vertexPairs | 18432 |
| edgeVertex (subsampled) | 0 |

Part 10 placement: **3268 ms** (Stage 10B was ~39500 ms).
Candidates total: **24564** (Stage 10B was ~724391).
