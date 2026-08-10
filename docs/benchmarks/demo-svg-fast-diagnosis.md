# Demo.svg — FAST end-to-end BLF diagnosis

Fixture: `/Users/ozgurnazimgurbuz/Desktop/Demo.svg`
Sheet: 2050×3050 mm, margin 10, spacing 5
Rotations: 0/90/180/270, orthogonal
Preset: **FAST** (optimize budget 500 ms; BLF uncapped)
Parts parsed: **16** · SVG reported 2584×1959 mm

## Part inventory (area-sorted = BLF order)
  #1 id=part-0 verts=15 holes=0 area=64042 bbox=428.6×332.4
  #2 id=part-3 verts=12 holes=0 area=57870 bbox=340.2×332.4
  #3 id=part-5 verts=64 holes=0 area=42756 bbox=331.6×330.6
  #4 id=part-1 verts=8 holes=0 area=38233 bbox=411.6×334.5
  #5 id=part-6 verts=10 holes=0 area=36979 bbox=406.3×333.2
  #6 id=part-4 verts=8 holes=0 area=35717 bbox=349.5×330.6
  #7 id=part-14 verts=4 holes=0 area=30379 bbox=45.0×675.0
  #8 id=part-15 verts=4 holes=0 area=30379 bbox=45.0×675.0
  #9 id=part-10 verts=30 holes=1 area=11960 bbox=122.3×152.8
  #10 id=part-12 verts=110 holes=0 area=11887 bbox=141.4×158.1
  #11 id=part-8 verts=110 holes=0 area=11887 bbox=141.4×158.1
  #12 id=part-11 verts=9 holes=1 area=10235 bbox=144.2×152.8
  #13 id=part-9 verts=9 holes=1 area=10235 bbox=144.2×152.8
  #14 id=part-13 verts=12 holes=0 area=10179 bbox=101.2×152.8
  #15 id=part-2 verts=3 holes=0 area=4775 bbox=110.8×86.2
  #16 id=part-7 verts=3 holes=0 area=4630 bbox=109.2×84.9

## BLF-only (profiled)
Wall: **35.73 s** · status=ok
Placed **16/16**, sheets **1**, calcTime 35732 ms

## Per-part BLF metrics
| # | partId | verts | holes | place_ms | nfp_ms | cand_gen_ms | cand | collide_n | collide_ms | placed | rotations |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1 | part-0 | 15 | 0 | 0 | 0 | 0 | 12 | 0 | 0 | true | 0°: total=0ms nfp=0 cand=3 col=0/0ms ✓<br>90°: total=0ms nfp=0 cand=3 col=0/0ms ✓<br>180°: total=0ms nfp=0 cand=3 col=0/0ms ✓<br>270°: total=0ms nfp=0 cand=3 col=0/0ms ✓ |
| 2 | part-3 | 12 | 0 | 159 | 148 | 152 | 1362 | 473 | 6 | true | 0°: total=63ms nfp=59 cand=416 col=130/3ms ✓<br>90°: total=34ms nfp=32 cand=261 col=104/1ms ✓<br>180°: total=35ms nfp=33 cand=417 col=140/1ms ✓<br>270°: total=26ms nfp=24 cand=268 col=99/1ms ✓ |
| 3 | part-5 | 64 | 0 | 1367 | 1351 | 1359 | 4066 | 815 | 7 | true | 0°: total=277ms nfp=273 cand=897 col=170/2ms ✓<br>90°: total=393ms nfp=389 cand=1119 col=262/2ms ✓<br>180°: total=284ms nfp=281 cand=917 col=231/1ms ✓<br>270°: total=413ms nfp=409 cand=1133 col=152/2ms ✓ |
| 4 | part-1 | 8 | 0 | 300 | 284 | 289 | 4008 | 2550 | 9 | true | 0°: total=78ms nfp=75 cand=967 col=639/1ms ✓<br>90°: total=70ms nfp=68 cand=972 col=571/1ms ✓<br>180°: total=82ms nfp=74 cand=1044 col=964/6ms ✓<br>270°: total=69ms nfp=67 cand=1025 col=376/1ms ✓ |
| 5 | part-6 | 10 | 0 | 401 | 353 | 360 | 5669 | 4102 | 39 | true | 0°: total=103ms nfp=94 cand=1424 col=1200/6ms ✓<br>90°: total=96ms nfp=83 cand=1380 col=1109/11ms ✓<br>180°: total=100ms nfp=92 cand=1454 col=867/6ms ✓<br>270°: total=101ms nfp=83 cand=1411 col=926/17ms ✓ |
| 6 | part-4 | 8 | 0 | 304 | 220 | 229 | 6606 | 8589 | 73 | true | 0°: total=67ms nfp=51 cand=1465 col=1182/14ms ✓<br>90°: total=115ms nfp=65 cand=1690 col=2626/47ms ✓<br>180°: total=59ms nfp=48 cand=1775 col=2586/8ms ✓<br>270°: total=63ms nfp=57 cand=1676 col=2195/3ms ✓ |
| 7 | part-14 | 4 | 0 | 120 | 44 | 51 | 5090 | 8844 | 68 | true | 0°: total=17ms nfp=14 cand=1400 col=2148/1ms ✓<br>90°: total=46ms nfp=12 cand=1146 col=2277/32ms ✓<br>180°: total=15ms nfp=11 cand=1398 col=2142/2ms ✓<br>270°: total=42ms nfp=7 cand=1146 col=2277/33ms ✓ |
| 8 | part-15 | 4 | 0 | 117 | 38 | 45 | 5576 | 9677 | 71 | true | 0°: total=16ms nfp=13 cand=1521 col=2294/2ms ✓<br>90°: total=42ms nfp=7 cand=1266 col=2543/33ms ✓<br>180°: total=16ms nfp=11 cand=1522 col=2296/3ms ✓<br>270°: total=42ms nfp=7 cand=1267 col=2544/33ms ✓ |
| 9 | part-10 | 30 | 1 | 892 | 726 | 740 | 13090 | 14546 | 145 | true | 0°: total=182ms nfp=164 cand=3273 col=2446/13ms ✓<br>90°: total=227ms nfp=198 cand=3191 col=3663/25ms ✓<br>180°: total=177ms nfp=164 cand=3206 col=2192/8ms ✓<br>270°: total=306ms nfp=200 cand=3420 col=6245/99ms ✓ |
| 10 | part-12 | 110 | 0 | 9696 | 9335 | 9364 | 21624 | 22493 | 318 | true | 0°: total=2113ms nfp=2021 cand=5407 col=5781/82ms ✓<br>90°: total=2766ms nfp=2674 cand=5392 col=5998/81ms ✓<br>180°: total=2396ms nfp=2315 cand=5403 col=5134/70ms ✓<br>270°: total=2421ms nfp=2325 cand=5422 col=5580/86ms ✓ |
| 11 | part-8 | 110 | 0 | 18213 | 13706 | 13734 | 25319 | 60576 | 4444 | true | 0°: total=3986ms nfp=3113 cand=6187 col=14616/857ms ✓<br>90°: total=4901ms nfp=3756 cand=6333 col=15378/1128ms ✓<br>180°: total=4489ms nfp=3112 cand=6436 col=15784/1360ms ✓<br>270°: total=4838ms nfp=3724 cand=6363 col=14798/1099ms ✓ |
| 12 | part-11 | 9 | 1 | 1076 | 723 | 741 | 15226 | 46178 | 329 | true | 0°: total=208ms nfp=121 cand=3780 col=11975/81ms ✓<br>90°: total=333ms nfp=247 cand=3666 col=10643/80ms ✓<br>180°: total=231ms nfp=116 cand=4017 col=12745/109ms ✓<br>270°: total=305ms nfp=240 cand=3763 col=10815/59ms ✓ |
| 13 | part-9 | 9 | 1 | 1046 | 731 | 749 | 16414 | 36957 | 291 | true | 0°: total=180ms nfp=118 cand=4046 col=7533/57ms ✓<br>90°: total=339ms nfp=249 cand=3951 col=11657/83ms ✓<br>180°: total=186ms nfp=117 cand=4294 col=4295/64ms ✓<br>270°: total=341ms nfp=247 cand=4123 col=13472/88ms ✓ |
| 14 | part-13 | 12 | 0 | 1017 | 621 | 644 | 19354 | 62486 | 365 | true | 0°: total=209ms nfp=136 cand=4796 col=15609/66ms ✓<br>90°: total=292ms nfp=180 cand=4855 col=15852/104ms ✓<br>180°: total=251ms nfp=131 cand=4750 col=16274/111ms ✓<br>270°: total=266ms nfp=175 cand=4953 col=14751/83ms ✓ |
| 15 | part-2 | 3 | 0 | 534 | 395 | 411 | 13040 | 14391 | 122 | true | 0°: total=121ms nfp=99 cand=3314 col=3422/17ms ✓<br>90°: total=121ms nfp=97 cand=3251 col=3673/20ms ✓<br>180°: total=143ms nfp=106 cand=3214 col=3027/33ms ✓<br>270°: total=149ms nfp=93 cand=3261 col=4269/52ms ✓ |
| 16 | part-7 | 3 | 0 | 483 | 325 | 341 | 13431 | 17033 | 141 | true | 0°: total=109ms nfp=72 cand=3393 col=5327/33ms ✓<br>90°: total=119ms nfp=95 cand=3348 col=3532/19ms ✓<br>180°: total=118ms nfp=67 cand=3339 col=4587/46ms ✓<br>270°: total=137ms nfp=92 cand=3351 col=3587/42ms ✓ |

## Part #10 bottleneck
- BLF sırası **#10** = `part-12` (area-sort; inventory’de ~orta küme).
- Vertex: **110**, holes: **0**, bbox 141.4×158.1.
- Önceki 9 parça sheet’te → her rotation için NFP/obstacle sayısı ≈ 9 + sheet IFP.
- Ölçülen: place **9696 ms**, candidates **21624**, collisions **22493**, NFP **9335 ms**.
- Pay: NFP ~96%, collision ~3% of part placement.

Slowest overall: **#11** `part-8` — 18213 ms, cand=25319, verts=110

## Raw profiler (slowest part detail)
```
# BLF Profile Report (Stage 10B)

PART 11 (part-8)
Vertices: 110
Holes: 0
BBox: 141.4 × 158.1 mm

ROTATION 0°
NFP: 3113.3 ms (10 calls, hit 0 / miss 10)
Candidates: 6187
Collision: 857.4 ms (14616 calls)
Total: 3986.1 ms · ACCEPTED

ROTATION 90°
NFP: 3756.4 ms (10 calls, hit 0 / miss 10)
Candidates: 6333
Collision: 1127.7 ms (15378 calls)
Total: 4901.0 ms · ACCEPTED

ROTATION 180°
NFP: 3111.9 ms (10 calls, hit 0 / miss 10)
Candidates: 6436
Collision: 1359.8 ms (15784 calls)
Total: 4488.5 ms · ACCEPTED

ROTATION 270°
NFP: 3724.3 ms (10 calls, hit 0 / miss 10)
Candidates: 6363
Collision: 1098.9 ms (14798 calls)
Total: 4837.8 ms · ACCEPTED

TOTAL:
NFP time: 13706.0 ms
Candidate generation: 13734.2 ms
Collision: 4443.9 ms
Placement: 18213.4 ms
Cache hit rate: 0.0% (0 hit / 40 miss)

## All parts (summary)
  #1 part-0 verts=15 cand=12 place=0ms placed=true
  #2 part-3 verts=12 cand=1362 place=159ms placed=true
  #3 part-5 verts=64 cand=4066 place=1367ms placed=true
  #4 part-1 verts=8 cand=4008 place=300ms placed=true
  #5 part-6 verts=10 cand=5669 place=401ms placed=true
  #6 part-4 verts=8 cand=6606 place=304ms placed=true
  #7 part-14 verts=4 cand=5090 place=120ms placed=true
  #8 part-15 verts=4 cand=5576 place=117ms placed=true
  #9 part-10 verts=30 cand=13090 place=892ms placed=true
  #10 part-12 verts=110 cand=21624 place=9696ms placed=true
  #11 part-8 verts=110 cand=25319 place=18213ms placed=true
  #12 part-11 verts=9 cand=15226 place=1076ms placed=true
  #13 part-9 verts=9 cand=16414 place=1046ms placed=true
  #14 part-13 verts=12 cand=19354 place=1017ms placed=true
  #15 part-2 verts=3 cand=13040 place=534ms placed=true
  #16 part-7 verts=3 cand=13431 place=483ms placed=true

## Clipper ops (run total)
  minkowski: 456 calls · 28920.1 ms
  offset: 480 calls · 42.0 ms

## Collision (run total): 309710 calls · 6426.8 ms

## Candidate sources (push counts before dedupe)
  nfpBoundary: 124798
  vertexPairs: 57819
  edgeVertex: 0
```

## FAST evolutionary end-to-end
Wall clock: **34.92 s** · status=ok
- **Placed: 16 / 16**
- **Sheets used: 1**
- Unplaced: 0
- Engine calculationTimeMs: 34922
- Utilization: 6.70%

## Headline numbers
- FAST e2e placed: **16 / 16**
- Sheets: **1**
- Total wall (e2e): **34.92 s**
- BLF-only wall: **35.73 s**

## Notes (measurement only — no algorithm change)
- UI FAST’s **500 ms** budget starts with the nest (includes BLF). Demo BLF alone is ~35 s → optimize phase effectively skipped after baseline (`timedOut()` true). Almost all wall time is uncapped BLF.
- After Stage 10C, `edgeVertex` pushes = **0**; mid-pack cost is **Clipper Minkowski NFP** (~29 s / 456 calls run-wide), not collision (~6.4 s).
- Twin 110-vert parts (`part-12` then `part-8`) dominate: #10 ≈ 9.7 s (96% NFP), #11 ≈ 18.2 s (NFP + heavier collision with 10 obstacles).
