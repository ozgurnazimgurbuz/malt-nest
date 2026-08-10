# Malt Nest — Handoff for Claude (Stage 9 + Cancel Fix)

Bu dosya bağımsız bir brieftir. Başka sohbet bağlamına ihtiyaç duymaz.
Tarih: 2026-08-10 · Repo: `malt-nest` · Kullanıcı: Özgür (Designer)

---

## 1. Proje nedir?

**Malt Nest** — tarayıcıda çalışan 2D Auto Nesting (Vite + React + TypeScript, client-only).

```
SVG → GeometryPart[] → NestingEngine (Web Worker) → NestingResult
Optimizer → placeWithPlan/BLF → NFP/collision → geometry (Clipper2 hybrid)
Export → applyPlacement (NestPreview ile aynı) → SVG/ZIP
```

**Stack:** Vite, React, TypeScript, Vitest, oxlint, `clipper2-ts@2.0.1-18` (BSL-1.0).

**Çalıştırma:**
```bash
export PATH="$HOME/.local/node/bin:$PATH"
cd /Users/ozgurnazimgurbuz/Downloads/malt-nest
npm test && npm run lint && npm run build && npm run dev
```

**Kurallar (kalıcı):**
- Ponytail: minimal diff, YAGNI, geometry validation zayıflatma.
- DXF / kerf / common-line / auth / cloud / DB **yapma** (ileri stage).
- SVG export redesign yapma (Stage 8’de bitti).
- Commit/push sadece kullanıcı isterse.

---

## 2. Stage geçmişi (özet)

| Stage | Durum |
| --- | --- |
| 1–5 | Scaffold, SVG parse, BLF+NFP, evolutionary, worker |
| 6 | Geometry/NFP, holes, part-in-part foundation, benchmarks |
| 7 | Hybrid Clipper2 (boolean, offset, concave Minkowski) |
| 8 | Production SVG export, multi-sheet ZIP, NestPreview=export transform · **136 tests** |
| **9** | Production-quality optimizer + fab fixtures · **147 tests** (cancel fix sonrası) |

---

## 3. Stage 9 — ne istendi / ne yapıldı?

### Amaç
“Working geometry-aware nesting” → “production-quality nesting optimizer”; **malzeme fire’sini azalt**.

### Yapılanlar
1. **Baseline:** `docs/benchmarks/stage-9-baseline.md` (Stage 8 motoru; silme)
2. **Rotation:** Orthogonal / Balanced (45°) / Deep (adaptive, bounded) — `src/nesting/optimization/rotations.ts`
3. **Presets:** Fast ~0.5s / Balanced ~2s / Deep ~10s — multi-start 2/4/8, local search, destroy/repair
4. **Population seeds:** area/width/height/perimeter/compactness/hole-aware/random + multi-start
5. **Local search + destroy/repair** — `localSearch.ts`, `destroyRepair.ts`
6. **Score:** unplaced ≫ sheets ≫ waste(1.5) ≫ compactness(0.15) — `scoring/SCORE.md`, breakdown
7. **Part-in-part:** default OFF; hole-aware seed + BLF hole fit (sığ: BL/center)
8. **UI:** Optimization + Rotation mode + part-in-part; debug: seed, deterministic
9. **Fab fixtures A–J:** `src/geometry/fabFixtures.ts` → `docs/benchmarks/stage-9-after.md`
10. **Final report:** `docs/stage-9-report.md`

### Bilinçli yapılmayanlar
DXF, kerf, common-line, remnants, auth/cloud/DB, SVG export redesign, Stage 10.

---

## 4. Nesting motoru — gerçek mimari (audit özeti)

### Akış
```
UI nestAsync → Worker → runEvolutionaryNest
  1) BLF baseline (area-sort + best rotation)
  2) Multi-start GA over (order, rotation[]) genes
  3) Her gen → placeWithPlan = AYNI BLF placer
  4) Local search → (balanced/deep) destroy/repair
  5) Score ≤ BLF ise evo, değilse BLF döner
```

**Önemli:** Evolutionary, BLF’yi yeniden yazmaz. Order×rotation genleri ile **aynı greedy BLF placer**’ı tekrar çalıştırır.

### Bileşen bağları
| Parça | Rol |
| --- | --- |
| **IFP** | Sheet − margin − part AABB (dikdörtgen çeviri kutusu) |
| **NFP** | Aday üretici; convex=`exact:true`, concave=Clipper Minkowski `exact:false` |
| **Clipper2** | Offset, boolean, concave Minkowski — collide hot-path’te değil |
| **Collision** | `solidsCollide` → boundary distance (vertex↔edge); her collide’da offset yok |
| **Margin** | `solidInsideRect` (vertices + edge midpoints) |
| **Multi-sheet** | Açık sheet’leri dene → yeni sheet; UI quantity=100 |
| **Part-in-part** | NFP hole yok sayar; ayrı `canFitInHole` (2 aday) |

### Güven skoru (audit): **6/10** CNC/pleksi için
- 🟢 Worker+BLF floor, AA margin, orthogonal, cancel (fix sonrası), convex NFP
- 🟡 Concave NFP exact değil; spacing distance≠offset birebir; evo sheet/waste kazanımı tutarsız; hole nesting sığ
- 🔴 Kerf, common-line, remnant, gerçek fab SVG golden testleri yok

### Audit’te önerilen 5 öncelik (henüz yapılmadı — Stage 10 adayları)
1. Spacing/clearance tek model + golden testler  
2. Concave NFP doğruluk golden’ları  
3. Kerf  
4. Gerçek tabela/pleksi SVG benchmark suite  
5. Placer zenginleştirme (hole IFP, continuous relocate)

---

## 5. Cancel / Worker lifecycle fix (Stage 9 sonrası hotfix)

### Problem
Deep nest UI’ı kilitliyordu (`calculating` sonsuz true). STOP cooperative idi ama uzun senkron NFP/collide içinde abort bakılmıyordu; `worker.terminate()` yoktu. FAST seçip yeniden nest, `if (calculating) return` yüzünden başlamıyordu. “Placed 10/10” BLF progress’inde `yerleşen/işlenen` idi (toplam parça değil).

### Çözüm (algoritma değişmedi — sadece lifecycle + abort noktaları + UI)

**Dosyalar:**
- `src/nesting/worker/client.ts`
- `src/nesting/placement/blf.ts`
- `src/nesting/nfp/candidates.ts` (abort check only)
- `src/nesting/optimization/geneticOptimizer.ts`
- `src/nesting/types.ts`, `engine.ts`
- `src/App.tsx`
- `optimizer.test.ts` (17b BLF abort)

**Davranış:**
1. Her nest → unique `jobId`; UI yalnız aktif job mesajlarını kabul eder  
2. STOP → cancel message → **800ms grace** → hâlâ bitmediyse `worker.terminate()` + progress’teki son `bestSoFar`  
3. Abort noktaları: parça / sheet / her 32 candidate / NFP aday grubu / generation / gene eval  
4. BLF mid-abort → `cancelled` + partial `bestSoFar`  
5. AUTO NEST artık `calculating` iken de eski job’u abort edip yeni job açabilir  
6. Progress: `BLF · 10 / 16 parça · sheet 1` / `Optimize · deep · start 2/8 · gen 5 · …`  
7. Complete: `Completed · 16 / 16` veya `… · 6 yerleşmedi`

---

## 6. Önemli dosya haritası

```
src/nesting/
  nest.ts, engine.ts, request.ts, types.ts
  placement/blf.ts, worldGeometry.ts
  nfp/candidates.ts
  optimization/
    geneticOptimizer.ts, population.ts, rotations.ts, presets.ts
    localSearch.ts, destroyRepair.ts, rng.ts, …
  scoring/fitness.ts, weights.ts, SCORE.md
  worker/client.ts, nestWorker.ts
src/geometry/          # Clipper hybrid, NFP, collide, offset, fabFixtures
src/export/            # SVG export (Stage 8) — dokunma
src/ui/, App.tsx
docs/
  stage-9-report.md
  benchmarks/stage-9-baseline.md
  benchmarks/stage-9-after.md
  benchmarks/stage-9-before-after.md
  benchmarks/stage-9-comparison.md
  THIRD_PARTY_GEOMETRY.md
```

---

## 7. Doğrulama (son bilinen)

```
147/147 tests · oxlint clean · tsc + vite build OK
```

Worker bundle ~107KB, main ~340KB.

---

## 8. Claude’a talimat şablonu

Aşağıyı yeni sohbette yapıştırabilirsin:

> Malt Nest (`/Users/ozgurnazimgurbuz/Downloads/malt-nest`) üzerinde çalış.
> Bağlam: ekteki `docs/HANDOFF-CLAUDE-STAGE9.md` (veya bu dosya).
> Stage 9 + cancel fix tamam. Stage 10’a otomatik başlama.
> Placement/NFP/Clipper/scoring algoritmasını değiştirme demedikçe dokunma.
> DXF/kerf/common-line/auth/cloud yapma.
> Ponytail: minimal diff. Commit istemeden commit atma.
> `npm test && npm run lint && npm run build` ile doğrula.

---

## 9. Bilinen sınırlamalar (dürüst)

- Fast budget’ta evo sık sık BLF ile sheet/waste’te **tie**; kazanım çoğu zaman compactness.
- Concave NFP `exact: false`; kabul kararı distance-collide.
- Circle/ellipse chordal polygon (~0.25mm / n=24 fixture).
- Part-in-part sığ (2 aday/hole), default OFF.
- Cross-sheet explicit relocate yok (sadece order genleri).
- Wall-clock determinism kırılgan; `deterministic: true` + generation cap kullan.
- Tek bir Clipper Minkowski çağrısı hâlâ senkron ve uzun sürebilir; abort o çağrının **içinde** değil, **aralarında**.

---

## 10. Önerilen sonraki iş (Stage 10 — henüz başlanmadı)

Kullanıcı onaylamadan başlama:
1. Kerf
2. Remnants / offcut
3. Daha sıkı fab SVG regression + clearance golden
4. Common-line (bilinçli ertelenmiş olabilir)
5. DXF (bilinçli ertelenmiş)

---

*Bu handoff Stage 9 + cancel hotfix’i kapsar. Başka Cursor sohbetlerinden bağımsızdır.*
