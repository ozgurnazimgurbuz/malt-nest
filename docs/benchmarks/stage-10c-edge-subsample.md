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
NFP: 443.3 ms (9 calls, hit 0 / miss 9)
Candidates: 6125
Collision: 153.4 ms (2426 calls)
Total: 623.8 ms · ACCEPTED

ROTATION 90°
NFP: 270.6 ms (9 calls, hit 0 / miss 9)
Candidates: 6135
Collision: 199.0 ms (2668 calls)
Total: 491.5 ms · ACCEPTED

ROTATION 180°
NFP: 137.6 ms (9 calls, hit 0 / miss 9)
Candidates: 6126
Collision: 160.0 ms (2667 calls)
Total: 308.5 ms · ACCEPTED

ROTATION 270°
NFP: 134.6 ms (9 calls, hit 0 / miss 9)
Candidates: 6178
Collision: 62.0 ms (2531 calls)
Total: 205.7 ms · ACCEPTED

TOTAL:
NFP time: 986.1 ms
Candidate generation: 1038.8 ms
Collision: 574.4 ms
Placement: 1629.7 ms
Cache hit rate: 0.0% (0 hit / 36 miss)

## All parts (summary)
  #10 part-9 verts=72 cand=24564 place=1630ms placed=true

## Clipper ops (run total)
  minkowski: 36 calls · 966.3 ms
  offset: 36 calls · 11.8 ms

## Collision (run total): 10292 calls · 574.4 ms

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

Part 10 placement: **1630 ms** (Stage 10B was ~39500 ms).
Candidates total: **24564** (Stage 10B was ~724391).
