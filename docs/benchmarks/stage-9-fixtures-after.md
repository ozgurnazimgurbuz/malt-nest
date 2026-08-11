# Stage 9 — Geometry fixture suite (after Stage 9 optimizer)

Same fixtures/settings as `stage-9-baseline.md` (400×300, margin 5, spacing 2, fast/~400ms, seed=7).

```
Nesting fixture benchmark
-------------------------
rectangles       blf          placed=5/5 sheets=1 util=2.9% score=1165326.1 40.8ms
rectangles       evolutionary placed=5/5 sheets=1 util=2.9% score=1165269.4 396.9ms
triangles        blf          placed=4/4 sheets=1 util=2.0% score=1168264.0 9.0ms
triangles        evolutionary placed=4/4 sheets=1 util=2.0% score=1166863.2 278.6ms
circles          blf          placed=4/4 sheets=1 util=2.5% score=1167797.1 60.9ms
circles          evolutionary placed=4/4 sheets=1 util=2.5% score=1166184.6 402.3ms
L                blf          placed=3/3 sheets=1 util=2.2% score=1166722.0 7.6ms
L                evolutionary placed=3/3 sheets=1 util=2.2% score=1166554.0 112.8ms
C                blf          placed=3/3 sheets=1 util=3.1% score=1165210.0 4.8ms
C                evolutionary placed=3/3 sheets=1 util=3.1% score=1165210.0 204.4ms
U                blf          placed=3/3 sheets=1 util=3.1% score=1165210.0 4.3ms
U                evolutionary placed=3/3 sheets=1 util=3.1% score=1165210.0 192.7ms
stars            blf          placed=3/3 sheets=1 util=1.0% score=1168544.2 27.8ms
stars            evolutionary placed=3/3 sheets=1 util=1.0% score=1168419.2 348.4ms
letters          blf          placed=4/4 sheets=1 util=2.8% score=1165547.2 18.7ms
letters          evolutionary placed=4/4 sheets=1 util=2.8% score=1165547.2 388.7ms
holes            blf          placed=3/3 sheets=1 util=5.3% score=1162280.5 1.6ms
holes            evolutionary placed=3/3 sheets=1 util=5.3% score=1162160.5 58.7ms
multiHoles       blf          placed=3/3 sheets=1 util=7.3% score=1159199.5 1.1ms
multiHoles       evolutionary placed=3/3 sheets=1 util=7.3% score=1159115.5 45.1ms
mixedIrregular   blf          placed=5/5 sheets=1 util=3.3% score=1166369.4 53.0ms
mixedIrregular   evolutionary placed=5/5 sheets=1 util=3.3% score=1165022.9 405.5ms
manySmall        blf          placed=16/16 sheets=1 util=2.1% score=1166458.6 38.9ms
manySmall        evolutionary placed=16/16 sheets=1 util=2.1% score=1166458.6 406.6ms
fewLarge         blf          placed=3/3 sheets=1 util=39.7% score=1110100.0 2.0ms
fewLarge         evolutionary placed=3/3 sheets=1 util=39.7% score=1109914.0 60.7ms
mixedSizes       blf          placed=6/6 sheets=1 util=10.6% score=1154567.1 27.1ms
mixedSizes       evolutionary placed=6/6 sheets=1 util=10.6% score=1154363.1 402.1ms
```
