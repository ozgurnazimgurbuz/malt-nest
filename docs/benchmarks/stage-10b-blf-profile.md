# Stage 10B — BLF Performance Investigation

Fixture: **Demo-like** 16 dense irregular parts (`Demo.svg` not in repo).
Sheet **1600×1000**, spacing **5**, margin **10**, rotations **0/90/180/270**.

```
# BLF Profile Report (Stage 10B)

PART 10 (part-9)
Vertices: 88
Holes: 0
BBox: 179.0 × 176.4 mm

ROTATION 0°
NFP: 3916.1 ms (9 calls, hit 0 / miss 9)
Candidates: 263166
Collision: 106317.5 ms (668431 calls)
Total: 111432.8 ms · ACCEPTED

ROTATION 90°
NFP: 4230.4 ms (9 calls, hit 0 / miss 9)
Candidates: 262766
Collision: 98517.8 ms (590513 calls)
Total: 103981.6 ms · ACCEPTED

ROTATION 180°
NFP: 4745.8 ms (9 calls, hit 0 / miss 9)
Candidates: 262632
Collision: 148252.6 ms (687475 calls)
Total: 154568.0 ms · ACCEPTED

ROTATION 270°
NFP: 4468.9 ms (9 calls, hit 0 / miss 9)
Candidates: 263026
Collision: 146816.1 ms (704108 calls)
Total: 153134.3 ms · ACCEPTED

TOTAL:
NFP time: 17361.2 ms
Candidate generation: 19387.2 ms
Collision: 499904.1 ms
Placement: 523117.7 ms
Cache hit rate: 0.0% (0 hit / 36 miss)

## All parts (summary)
  #1 part-0 verts=72 cand=12 place=0ms placed=true
  #2 part-1 verts=64 cand=75637 place=1404ms placed=true
  #3 part-2 verts=80 cand=185910 place=3049ms placed=true
  #4 part-3 verts=56 cand=220164 place=5246ms placed=true
  #5 part-4 verts=96 cand=502654 place=45147ms placed=true
  #6 part-5 verts=48 cand=346728 place=35026ms placed=true
  #7 part-6 verts=64 cand=530928 place=62507ms placed=true
  #8 part-7 verts=72 cand=691834 place=99411ms placed=true
  #9 part-8 verts=40 cand=453389 place=92671ms placed=true
  #10 part-9 verts=88 cand=1051590 place=523118ms placed=true
  #11 part-10 verts=52 cand=724508 place=144455ms placed=true
  #12 part-11 verts=60 cand=894654 place=352905ms placed=true
  #13 part-12 verts=44 cand=721362 place=190288ms placed=true
  #14 part-13 verts=36 cand=631712 place=172494ms placed=true
  #15 part-14 verts=48 cand=863479 place=173540ms placed=true
  #16 part-15 verts=32 cand=616664 place=102058ms placed=true

## Clipper ops (run total)
  minkowski: 480 calls · 182449.8 ms
  offset: 480 calls · 85.9 ms

## Collision (run total): 22264731 calls · 1795308.1 ms

## Candidate sources (push counts before dedupe)
  nfpBoundary: 304397
  vertexPairs: 408160
  edgeVertex: 8036638
```

## Candidate sources (pre-dedupe pushes, full run)

| Source | Count |
| --- | ---: |
| nfpBoundary | 304397 |
| vertexPairs (sampled) | 408160 |
| edgeVertex (full) | 8036638 |

## Clipper (full run)

- **minkowski**: 480 calls · 182449.8 ms
- **offset**: 480 calls · 85.9 ms

Collision (full run): **22264731** calls · **1795308.1** ms

ROOT CAUSE:
- Part #10 placement cost is dominated by candidate×collision against ~9 already-placed dense solids.
- Candidate explosion source: addEdgeVertexContacts is O(|edges|×|verts|) ×2 directions × spacing offsets,
  and is NOT subsampled (unlike vertexPairs which uses ~36×36 sampling).
- With ~60–90 verts/part and 9 placed: edgeVertex pushes dominate (92% of pre-dedupe pushes).
- Each rotation (0/90/180/270) regenerates candidates vs every placed solid; NFP is cached per pair but
  edge/vertex contact enumeration still runs every time.
- Fast timeLimitMs=500 does not bound BLF baseline — only the GA phase after BLF.

RECOMMENDATION (do not implement in 10B):
1. Subsample or cap edgeVertex contacts like vertexPairs.
2. Early-exit candidate loop after first valid (already does) — still pays full generation cost.
3. Cap candidates after BL sort (carefully — prior hard CAP regressed circles).
4. Optionally skip edgeVertex when NFP boundary samples are dense enough.
5. Consider time-budget checks inside BLF part loop for Fast preset.
