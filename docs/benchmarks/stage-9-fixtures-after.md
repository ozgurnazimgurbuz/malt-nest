# Stage 9 — Geometry fixture suite (after Stage 9 optimizer)

Same fixtures/settings as `stage-9-baseline.md` (400×300, margin 5, spacing 2, fast/~400ms, seed=7).

```
Nesting fixture benchmark
-------------------------
rectangles       blf          placed=5/5 sheets=1 util=2.9% score=1165326.1 61.3ms
rectangles       evolutionary placed=5/5 sheets=1 util=2.9% score=1165269.4 418.0ms
triangles        blf          placed=4/4 sheets=1 util=2.0% score=1168264.0 28.8ms
triangles        evolutionary placed=4/4 sheets=1 util=2.0% score=1166863.2 423.8ms
circles          blf          placed=4/4 sheets=1 util=2.5% score=1167797.1 503.5ms
circles          evolutionary placed=4/4 sheets=1 util=2.5% score=1166184.6 440.4ms
L                blf          placed=3/3 sheets=1 util=2.2% score=1166722.0 13.2ms
L                evolutionary placed=3/3 sheets=1 util=2.2% score=1166554.0 211.6ms
C                blf          placed=3/3 sheets=1 util=3.1% score=1165210.0 8.1ms
C                evolutionary placed=3/3 sheets=1 util=3.1% score=1165210.0 310.2ms
U                blf          placed=3/3 sheets=1 util=3.1% score=1165210.0 7.2ms
U                evolutionary placed=3/3 sheets=1 util=3.1% score=1165210.0 297.3ms
stars            blf          placed=3/3 sheets=1 util=1.0% score=1168544.2 38.5ms
stars            evolutionary placed=3/3 sheets=1 util=1.0% score=1168419.2 355.4ms
letters          blf          placed=4/4 sheets=1 util=2.8% score=1165547.2 19.3ms
letters          evolutionary placed=4/4 sheets=1 util=2.8% score=1165547.2 390.4ms
holes            blf          placed=3/3 sheets=1 util=5.3% score=1162280.5 1.7ms
holes            evolutionary placed=3/3 sheets=1 util=5.3% score=1162160.5 62.9ms
multiHoles       blf          placed=3/3 sheets=1 util=7.3% score=1159199.5 1.2ms
multiHoles       evolutionary placed=3/3 sheets=1 util=7.3% score=1159115.5 47.5ms
mixedIrregular   blf          placed=5/5 sheets=1 util=3.3% score=1166369.4 50.0ms
mixedIrregular   evolutionary placed=5/5 sheets=1 util=3.3% score=1165022.9 406.5ms
manySmall        blf          placed=16/16 sheets=1 util=2.1% score=1166458.6 41.6ms
manySmall        evolutionary placed=16/16 sheets=1 util=2.1% score=1166458.6 406.5ms
fewLarge         blf          placed=3/3 sheets=1 util=39.7% score=1110100.0 2.2ms
fewLarge         evolutionary placed=3/3 sheets=1 util=39.7% score=1109914.0 61.2ms
mixedSizes       blf          placed=6/6 sheets=1 util=10.6% score=1154567.1 25.3ms
mixedSizes       evolutionary placed=6/6 sheets=1 util=10.6% score=1154363.1 401.8ms
```
