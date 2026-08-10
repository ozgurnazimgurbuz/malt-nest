# Stage 10E — after opt2 (Miter offset)

## Changes (cumulative)
1. Opt1: strip exact-collinear before Minkowski.
2. Opt2: `clipperInflate` uses `JoinType.Miter` (miterLimit=4) instead of Round+arcTol=0 densification.

## Micro part-12@180 × part-8@90
- offset verts: 108 (baseline 241)
- computeNfp: 457 ms (baseline ~1510 ms)
- method: minkowski-clipper

## Demo.svg BLF
| metric | baseline | opt1 | opt2 |
| --- | ---: | ---: | ---: |
| BLF wall s | 36.15 | 18.81 | 12.02 |
| NFP time s | 29.48 | 13.19 | 6.51 |
| Minkowski calls | 456 | 456 | 456 |
| Minkowski ms | 29407 | 13137 | 6454 |
| part-12↔8 NFP ms | 4934 | 3225 | 1633 |
| placed | 16/16 | 16/16 | 16/16 |
| sheets | 1 | 1 | 1 |
| util % | 6.70 | 6.70 | 6.70 |

## Accuracy
- All pairs: solidsCollide(..., 5mm) === false
- placed 16/16 on 1 sheet(s)
