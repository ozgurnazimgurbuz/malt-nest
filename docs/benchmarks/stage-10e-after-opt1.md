# Stage 10E — after opt1

## Changes
1. `clipperInflate`: pass explicit `arcTolerance` (was miswired; 6th arg was precision, arcTol defaulted to 0 → dense Round arcs).
2. `clipperMinkowskiDiffNfp`: strip exact-collinear vertices before Minkowski (geometry unchanged within geomEps).

## Micro part-12@180 × part-8@90
- offset verts: 180 (was 241)
- computeNfp: 961 ms (baseline ~1510 ms)
- method: minkowski-clipper convexA=false

## Demo.svg BLF
| metric | baseline | after |
| --- | ---: | ---: |
| BLF wall s | 36.15 | 18.81 |
| NFP time s | 29.48 | 13.19 |
| Minkowski calls | 456 | 456 |
| Minkowski ms | 29407 | 13137 |
| part-12↔8 NFP ms | 4934 | 3225 |
| placed | 16/16 | 16/16 |
| sheets | 1 | 1 |
| util % | 6.70 | 6.70 |

## Accuracy
- All pairs: solidsCollide(..., 5mm) === false
- placed 16/16 on 1 sheet(s)
