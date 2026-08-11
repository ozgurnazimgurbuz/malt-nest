# Ordering + Multi-Start (ETAP 6A)

Deterministic multi-start over **ordering strategies**. No GA / mutation / random shuffle.

## Ordering strategies

| Strategy | Key (descending) |
|----------|------------------|
| `area_desc` | polygon area |
| `bbox_area_desc` | AABB area |
| `height_desc` | AABB height |
| `width_desc` | AABB width |
| `complexity_desc` | `V + 10·H + C` |

Tie-break: `shape.id` ascending, then input index.

### Complexity metric

```
complexity = V + 10·H + C
```

- **V** — vertex count (outers + holes)
- **H** — hole count
- **C** — reflex vertices on outer rings (cross ≤ 0)

Documented, integer, unit-tested. No perimeter/area magic blend.

## Multi-start

```ts
optimizeMultiStart(parts, sheet, { gap, maxSheets? }): MultiStartResult
```

### FAST

- Every base strategy (default 5)
- `rotation: orthogonal`
- **No pruning**

### FULL sweep

Every configured strategy is evaluated, deduplicated in stable order;
`area_desc` is injected as the baseline if absent.

`rotation: free` (cascade from ETAP 5; nest-level ortho floor off — FAST already measured orthogonal).

### Baseline invariant

`area_desc` is always in FULL. The final best is selected across both FAST and
FULL candidates, so a richer FULL run cannot regress below the best FAST result.

## Temporary comparison (not ETAP 7)

Priority:

1. more placed (feasibility)
2. fewer sheets
3. higher utilization  
4. lower packedBoundsMm2  
5. strategy name ascending  

No weighted score.

## Diagnostics

- Per-eval: strategy, order, mode, metrics, NFP/cache counters  
- Ranking table: FAST rank vs FULL rank (diagnostic only — not a quality gate)  
- Totals: FAST/FULL runtime, NFP, candidates, cache hits/misses  

## Future (ETAP 6B — not here)

Evolutionary / GA over order genes, using ETAP 7 scoring.  
Must keep multi-start baseline floor.

## Limitations

- Ordering only (no continuous order search)
- FULL evaluates all configured deterministic strategies
- FAST≠FULL rank correlation is reported, not assumed
