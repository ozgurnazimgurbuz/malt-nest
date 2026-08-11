# Demo.svg — NFP call / cache-key analysis

> Historical pre-audit snapshot. Production now computes and caches NFPs in a
> translation-normalized, ID-independent local frame, keys tolerance/fidelity,
> and restores world coordinates on retrieval. The zero-hit diagnosis below is
> retained as the benchmark evidence that motivated that fix.

Measure only. Placement/NFP/scoring logic unchanged (profiler key logging only when `profileBlf`).

Fixture: `/Users/ozgurnazimgurbuz/Desktop/Demo.svg`
BLF status: ok · placed 16/16
NFP attempts logged: **480**
Clipper minkowski: **456** calls · **29457 ms**
Existing production cache hits: **0** / 480

## Answers

| Question | currentFullKey (prod) | idRotKey | localShapeKey | idRotLocalKey |
| --- | ---: | ---: | ---: | ---: |
| Unique | 480 | 480 | 424 | 480 |
| Duplicate calls eliminable | 0 | 0 | 56 | 0 |
| Repeat rate | 0.0% | 0.0% | 11.7% | 0.0% |
| Theoretical ms saved | 0 | 0 | 607 | 0 |

### Why the historical production cache had ~0 hits
At the time of this snapshot, `geometryVersion` hashed **world** coordinates.
Each placed pose changed the hash, so the same part-pair at a new sheet
position missed even when relative geometry was identical. The current cache
uses translation-normalized geometry plus exact collision verification.

### Single BLF pass: identity keys never repeat
Each `(stationary, moving, rotA, rotB)` is computed once in area-sorted BLF. Cache only helps via **shape twins** (`localShapeKey`, 56/480) or across later GA re-evals (not in this measure).

## Top identity pairs (stationary × moving @ rots)

| count | ms | stationary | rotA | moving | rotB | vertsA×vertsB |
| ---: | ---: | --- | ---: | --- | ---: | --- |
| 1 | 1461 | part-12 | 180 | part-8 | 270 | 110×110 |
| 1 | 1406 | part-12 | 180 | part-8 | 90 | 110×110 |
| 1 | 1085 | part-12 | 180 | part-8 | 180 | 110×110 |
| 1 | 1074 | part-12 | 180 | part-8 | 0 | 110×110 |
| 1 | 531 | part-5 | 180 | part-12 | 90 | 64×110 |
| 1 | 507 | part-5 | 180 | part-8 | 270 | 64×110 |
| 1 | 494 | part-5 | 180 | part-8 | 90 | 64×110 |
| 1 | 486 | part-5 | 180 | part-12 | 270 | 64×110 |
| 1 | 472 | part-5 | 180 | part-8 | 0 | 64×110 |
| 1 | 456 | part-5 | 180 | part-12 | 180 | 64×110 |
| 1 | 442 | part-5 | 180 | part-8 | 180 | 64×110 |
| 1 | 434 | part-0 | 0 | part-8 | 90 | 15×110 |
| 1 | 431 | part-0 | 0 | part-12 | 270 | 15×110 |
| 1 | 419 | part-5 | 180 | part-12 | 0 | 64×110 |
| 1 | 407 | part-0 | 0 | part-12 | 90 | 15×110 |

## Next bottleneck: NFP cost distribution (unique expensive Minkowski)

| bucket | calls | ms | share |
| --- | ---: | ---: | ---: |
| mover≥100 (B=110) | 76 | 22322 | 75.5% |
| other | 356 | 3059 | 10.4% |
| obs≥100 (A=110) | 40 | 2862 | 9.7% |
| mover≥50 (B=64) | 8 | 1304 | 4.4% |

| rank | ms | stationary | moving | vertsA×vertsB |
| ---: | ---: | --- | --- | --- |
| 1 | 1461 | part-12@180 | part-8@270 | 110×110 |
| 2 | 1406 | part-12@180 | part-8@90 | 110×110 |
| 3 | 1085 | part-12@180 | part-8@180 | 110×110 |
| 4 | 1074 | part-12@180 | part-8@0 | 110×110 |
| 5 | 531 | part-5@180 | part-12@90 | 64×110 |
| 6 | 507 | part-5@180 | part-8@270 | 64×110 |
| 7 | 494 | part-5@180 | part-8@90 | 64×110 |
| 8 | 486 | part-5@180 | part-12@270 | 64×110 |
| 9 | 472 | part-5@180 | part-8@0 | 64×110 |
| 10 | 456 | part-5@180 | part-12@180 | 64×110 |
| 11 | 442 | part-5@180 | part-8@180 | 64×110 |
| 12 | 434 | part-0@0 | part-8@90 | 15×110 |

# NFP cache-key analysis (measure only)

Total NFP attempts recorded: **480**
Existing shared cache hits during run: **0** (0.0%)

## Scheme: currentFullKey
Current production key (part ids + rots + spacing + **world** geometryVersion fingerprints).
- Unique keys: **480**
- Duplicate calls (could skip compute if keyed this way): **0** (0.0%)
- Theoretical ms saved (2nd+ hits): **0 ms** (0.0% of NFP ms)
- Theoretical remaining computes: **480** (first miss per key)

| rank | count | ms_sum | key |
| ---: | ---: | ---: | --- |
| 1 | 1 | 1461 | `part-12|part-8|180.0000|270.0000|5.000000|hybrid-clipper2-ts@2.0.1-18:9e520c7d:hybrid-clipper2-ts...` |
| 2 | 1 | 1406 | `part-12|part-8|180.0000|90.0000|5.000000|hybrid-clipper2-ts@2.0.1-18:9e520c7d:hybrid-clipper2-ts@...` |
| 3 | 1 | 1085 | `part-12|part-8|180.0000|180.0000|5.000000|hybrid-clipper2-ts@2.0.1-18:9e520c7d:hybrid-clipper2-ts...` |
| 4 | 1 | 1074 | `part-12|part-8|180.0000|0.0000|5.000000|hybrid-clipper2-ts@2.0.1-18:9e520c7d:hybrid-clipper2-ts@2...` |
| 5 | 1 | 531 | `part-5|part-12|180.0000|90.0000|5.000000|hybrid-clipper2-ts@2.0.1-18:470d0fb2:hybrid-clipper2-ts@...` |
| 6 | 1 | 507 | `part-5|part-8|180.0000|270.0000|5.000000|hybrid-clipper2-ts@2.0.1-18:470d0fb2:hybrid-clipper2-ts@...` |
| 7 | 1 | 494 | `part-5|part-8|180.0000|90.0000|5.000000|hybrid-clipper2-ts@2.0.1-18:470d0fb2:hybrid-clipper2-ts@2...` |
| 8 | 1 | 486 | `part-5|part-12|180.0000|270.0000|5.000000|hybrid-clipper2-ts@2.0.1-18:470d0fb2:hybrid-clipper2-ts...` |
| 9 | 1 | 472 | `part-5|part-8|180.0000|0.0000|5.000000|hybrid-clipper2-ts@2.0.1-18:470d0fb2:hybrid-clipper2-ts@2....` |
| 10 | 1 | 456 | `part-5|part-12|180.0000|180.0000|5.000000|hybrid-clipper2-ts@2.0.1-18:470d0fb2:hybrid-clipper2-ts...` |
| 11 | 1 | 442 | `part-5|part-8|180.0000|180.0000|5.000000|hybrid-clipper2-ts@2.0.1-18:470d0fb2:hybrid-clipper2-ts@...` |
| 12 | 1 | 434 | `part-0|part-8|0.0000|90.0000|5.000000|hybrid-clipper2-ts@2.0.1-18:7f4a6216:hybrid-clipper2-ts@2.0...` |
| 13 | 1 | 431 | `part-0|part-12|0.0000|270.0000|5.000000|hybrid-clipper2-ts@2.0.1-18:7f4a6216:hybrid-clipper2-ts@2...` |
| 14 | 1 | 419 | `part-5|part-12|180.0000|0.0000|5.000000|hybrid-clipper2-ts@2.0.1-18:470d0fb2:hybrid-clipper2-ts@2...` |
| 15 | 1 | 407 | `part-0|part-12|0.0000|90.0000|5.000000|hybrid-clipper2-ts@2.0.1-18:7f4a6216:hybrid-clipper2-ts@2....` |

## Scheme: idRotKey
Identity only: `stationaryPartId|movingPartId|rotA|rotB|spacing` (no geometry fingerprint).
- Unique keys: **480**
- Duplicate calls (could skip compute if keyed this way): **0** (0.0%)
- Theoretical ms saved (2nd+ hits): **0 ms** (0.0% of NFP ms)
- Theoretical remaining computes: **480** (first miss per key)

| rank | count | ms_sum | key |
| ---: | ---: | ---: | --- |
| 1 | 1 | 1461 | `part-12|part-8|180.0000|270.0000|5.000000` |
| 2 | 1 | 1406 | `part-12|part-8|180.0000|90.0000|5.000000` |
| 3 | 1 | 1085 | `part-12|part-8|180.0000|180.0000|5.000000` |
| 4 | 1 | 1074 | `part-12|part-8|180.0000|0.0000|5.000000` |
| 5 | 1 | 531 | `part-5|part-12|180.0000|90.0000|5.000000` |
| 6 | 1 | 507 | `part-5|part-8|180.0000|270.0000|5.000000` |
| 7 | 1 | 494 | `part-5|part-8|180.0000|90.0000|5.000000` |
| 8 | 1 | 486 | `part-5|part-12|180.0000|270.0000|5.000000` |
| 9 | 1 | 472 | `part-5|part-8|180.0000|0.0000|5.000000` |
| 10 | 1 | 456 | `part-5|part-12|180.0000|180.0000|5.000000` |
| 11 | 1 | 442 | `part-5|part-8|180.0000|180.0000|5.000000` |
| 12 | 1 | 434 | `part-0|part-8|0.0000|90.0000|5.000000` |
| 13 | 1 | 431 | `part-0|part-12|0.0000|270.0000|5.000000` |
| 14 | 1 | 419 | `part-5|part-12|180.0000|0.0000|5.000000` |
| 15 | 1 | 407 | `part-0|part-12|0.0000|90.0000|5.000000` |

## Scheme: localShapeKey
Translation-normalized shape fingerprints of A & B + spacing (catches identical twins, ignores part ids).
- Unique keys: **424**
- Duplicate calls (could skip compute if keyed this way): **56** (11.7%)
- Theoretical ms saved (2nd+ hits): **607 ms** (2.1% of NFP ms)
- Theoretical remaining computes: **424** (first miss per key)

| rank | count | ms_sum | key |
| ---: | ---: | ---: | --- |
| 1 | 2 | 148 | `603e8609|9cf8df0e|5.000000` |
| 2 | 2 | 148 | `603e8609|3bb74176|5.000000` |
| 3 | 2 | 142 | `603e8609|142e833f|5.000000` |
| 4 | 2 | 140 | `603e8609|2d353f03|5.000000` |
| 5 | 2 | 105 | `603e8609|2d863efb|5.000000` |
| 6 | 2 | 104 | `603e8609|ad10f9cb|5.000000` |
| 7 | 2 | 100 | `603e8609|b0e039ab|5.000000` |
| 8 | 2 | 99 | `603e8609|5685abd0|5.000000` |
| 9 | 2 | 18 | `603e8609|72227bd1|5.000000` |
| 10 | 2 | 17 | `603e8609|1aebfd60|5.000000` |
| 11 | 2 | 17 | `603e8609|8110dbff|5.000000` |
| 12 | 2 | 17 | `603e8609|e2bdf55b|5.000000` |
| 13 | 2 | 15 | `603e8609|d1748cae|5.000000` |
| 14 | 2 | 11 | `603e8609|bc8daffd|5.000000` |
| 15 | 2 | 9 | `3e518579|f25e0b69|5.000000` |

## Scheme: idRotLocalKey
Ids + rots + spacing + translation-normalized local fingerprints (correct relative-NFP key if results stored in local frame).
- Unique keys: **480**
- Duplicate calls (could skip compute if keyed this way): **0** (0.0%)
- Theoretical ms saved (2nd+ hits): **0 ms** (0.0% of NFP ms)
- Theoretical remaining computes: **480** (first miss per key)

| rank | count | ms_sum | key |
| ---: | ---: | ---: | --- |
| 1 | 1 | 1461 | `part-12|part-8|180.0000|270.0000|5.000000|2d863efb|9cf8df0e` |
| 2 | 1 | 1406 | `part-12|part-8|180.0000|90.0000|5.000000|2d863efb|2d353f03` |
| 3 | 1 | 1085 | `part-12|part-8|180.0000|180.0000|5.000000|2d863efb|ad10f9cb` |
| 4 | 1 | 1074 | `part-12|part-8|180.0000|0.0000|5.000000|2d863efb|b0e039ab` |
| 5 | 1 | 531 | `part-5|part-12|180.0000|90.0000|5.000000|3e518579|3bb74176` |
| 6 | 1 | 507 | `part-5|part-8|180.0000|270.0000|5.000000|3e518579|9cf8df0e` |
| 7 | 1 | 494 | `part-5|part-8|180.0000|90.0000|5.000000|3e518579|2d353f03` |
| 8 | 1 | 486 | `part-5|part-12|180.0000|270.0000|5.000000|3e518579|142e833f` |
| 9 | 1 | 472 | `part-5|part-8|180.0000|0.0000|5.000000|3e518579|b0e039ab` |
| 10 | 1 | 456 | `part-5|part-12|180.0000|180.0000|5.000000|3e518579|2d863efb` |
| 11 | 1 | 442 | `part-5|part-8|180.0000|180.0000|5.000000|3e518579|ad10f9cb` |
| 12 | 1 | 434 | `part-0|part-8|0.0000|90.0000|5.000000|469b556|2d353f03` |
| 13 | 1 | 431 | `part-0|part-12|0.0000|270.0000|5.000000|469b556|142e833f` |
| 14 | 1 | 419 | `part-5|part-12|180.0000|0.0000|5.000000|3e518579|5685abd0` |
| 15 | 1 | 407 | `part-0|part-12|0.0000|90.0000|5.000000|469b556|3bb74176` |

## Verdict helper
Repeat rate max **11.7%** (≈**607 ms** savable) → cache is **not** the primary win for this single BLF pass; next bottleneck is per-call Minkowski cost.

## Decision
- Max call-level cache win on this pass: **56/480** (11.7%) ≈ **607 ms** (twin shapes).
- Expensive 110×110 / 64×110 calls are **unique** (count=1) — cache would not remove them on a single BLF.
- **Do not treat NFP cache as the main solution** for Demo.svg BLF latency; next work is per-call Minkowski cost (vertex density, concave path, fewer rotations tried early, etc.).
