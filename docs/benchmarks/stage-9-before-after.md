# Stage 9 — Before / After

## Geometry fixture suite (shared with Stage 8 baseline)

Settings: 400×300 mm, margin 5, spacing 2, `optimizationLevel=fast`, seed=7.

**Note:** Stage 9 changed score weights (`waste` 1→1.5, `compactness` 0.25→0.15). Absolute `score` totals are **not** comparable across Stage 8→9. Prefer sheets / util / evo≤BLF.

Sources: `docs/benchmarks/stage-9-baseline.md` (Stage 8 engine) vs `docs/benchmarks/stage-9-fixtures-after.md` (Stage 9).

| Fixture | S8 BLF sheets | S9 BLF sheets | S8 Evo sheets | S9 Evo sheets | S8 util% | S9 util% (evo) | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| rectangles | 1 | 1 | 1 | 1 | 2.9 | 2.9 | score evo ≤ BLF |
| triangles | 1 | 1 | 1 | 1 | 2.0 | 2.0 | compactness win |
| circles | 1 | 1 | 1 | 1 | 2.5 | 2.5 | packing preserved after candidate sampling fix |
| L | 1 | 1 | 1 | 1 | 2.2 | 2.2 | score evo ≤ BLF |
| C / U | 1 | 1 | 1 | 1 | 3.1 | 3.1 | tied |
| stars | 1 | 1 | 1 | 1 | 1.0 | 1.0 | slight score win |
| letters | 1 | 1 | 1 | 1 | 2.8 | 2.8 | tied |
| holes | 1 | 1 | 1 | 1 | 5.3 | 5.3 | score evo ≤ BLF |
| multiHoles | 1 | 1 | 1 | 1 | 7.3 | 7.3 | score evo ≤ BLF |
| mixedIrregular | 1 | 1 | 1 | 1 | 3.3 | 3.3 | tied |
| manySmall | 1 | 1 | 1 | 1 | 2.1 | 2.1 | tied |
| fewLarge | 1 | 1 | 1 | 1 | 39.7 | 39.7 | score evo ≤ BLF |
| mixedSizes | 1 | 1 | 1 | 1 | 10.6 | 10.6 | tied / slight |

**Unplaced:** 0 on all fixtures (Stage 8 and Stage 9).

**Runtime:** Evolutionary remains ≈ time budget (fast ~0.4–0.6s). Circles / irregular remain NFP-heavy for BLF.

## Fabrication fixtures A–J (Stage 9)

See `stage-9-after.md` and `stage-9-comparison.md`.

Candidate sampling fix (no hard CAP after BL sort) restored dense packing: fab A–J now land on **1 sheet** with util up to ~27% (A) under the same 500×400 sheet — previously a hard CAP wrongly pushed several fixtures onto multiple sheets.

With **fast / 500ms**, evolutionary sheet/waste often ties BLF; score sometimes improves via compactness (G, H, I). Deeper presets spend more time on multi-start + local search + destroy/repair.

Evidence rule applied: do **not** claim large waste % wins when BLF and evo already share the same sheet count and waste on a given run.
