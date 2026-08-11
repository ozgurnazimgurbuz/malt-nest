# malt-nest-engine

Standalone 2D irregular nesting engine for Malt Nest.

**ETAP 1:** Geometry Core  
**ETAP 2:** Sheet + Placement primitives  
**ETAP 3:** NFP Engine (Minkowski / Clipper2)  
**ETAP 4:** Basic deterministic nesting (BLF + NFP)  
**ETAP 5:** Free-angle rotation search (coarse → refine → final)  
**ETAP 6A:** Ordering + deterministic multi-start (no GA)

See [docs/geometry.md](docs/geometry.md), [docs/placement.md](docs/placement.md), [docs/nfp.md](docs/nfp.md), [docs/nest.md](docs/nest.md), [docs/rotation.md](docs/rotation.md), [docs/optimization.md](docs/optimization.md).

```bash
cd malt-nest-engine
npm install
npm test
npm run typecheck
```

Legacy `malt-nest/src/nesting` is **not** a dependency.
