import { useMemo } from 'react'
import type { GeometryPart } from '../geometry'
import {
  computeIfp,
  computeNfp,
  nfpBoundaryTranslations,
  offsetPolygon,
  solidFromRings,
} from '../geometry'
import { nfpCandidateTranslations } from '../nesting/nfp/candidates'

type Props = {
  parts: GeometryPart[]
  /** When set, draw offset / NFP / IFP overlays (developer debug). */
  advanced?: boolean
  spacingMm?: number
  sheetW?: number
  sheetH?: number
  marginMm?: number
}

function boundsViewBox(
  parts: GeometryPart[],
  extras: Array<{ x: number; y: number }[]> = [],
): string {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const consider = (pts: { x: number; y: number }[]) => {
    for (const p of pts) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  for (const p of parts) {
    consider(p.outer.points)
    for (const h of p.holes) consider(h.points)
  }
  for (const e of extras) consider(e)
  if (!Number.isFinite(minX)) return '0 0 1 1'
  const pad = Math.max(maxX - minX, maxY - minY, 1) * 0.08
  return `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`
}

function ringPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  const [first, ...rest] = points
  let d = `M ${first!.x} ${first!.y}`
  for (const p of rest) d += ` L ${p.x} ${p.y}`
  if (points.length >= 3) d += ' Z'
  return d
}

export function GeometryDebugPreview({
  parts,
  advanced = false,
  spacingMm = 5,
  sheetW = 2050,
  sheetH = 3050,
  marginMm = 10,
}: Props) {
  const overlays = useMemo(() => {
    if (!advanced || parts.length === 0) return null
    const a = parts[0]!
    const solidA = solidFromRings(
      a.outer.points,
      a.holes.map((h) => h.points),
    )
    const offset = offsetPolygon(a.outer, spacingMm)
    const ifp =
      parts[0] &&
      computeIfp(solidA, Math.min(sheetW, 400), Math.min(sheetH, 400), marginMm)
    let nfpOuters: { x: number; y: number }[][] = []
    let nfpHoles: { x: number; y: number }[][] = []
    let candidates: { x: number; y: number }[] = []
    let selected: { x: number; y: number } | null = null
    let rejected: { x: number; y: number }[] = []
    if (parts.length >= 2) {
      const b = parts[1]!
      const solidB = solidFromRings(
        b.outer.points,
        b.holes.map((h) => h.points),
      )
      const nfp = computeNfp(solidA, solidB, spacingMm)
      nfpOuters = nfp.regions.map((r) => r.outer.points)
      nfpHoles = nfp.regions.flatMap((r) => r.holes.map((h) => h.points))
      // Place A at origin; candidates are translations for B.
      const placedA = solidFromRings(
        a.outer.points,
        a.holes.map((h) => h.points),
      )
      const raw = nfpCandidateTranslations(placedA, solidB, spacingMm, {
        stationaryPartId: a.id,
        movingPartId: b.id,
        rotationA: 0,
        rotationB: 0,
      })
      const boundary = nfpBoundaryTranslations(nfp)
      const merged = [...boundary, ...raw]
      const seen = new Set<string>()
      for (const t of merged) {
        const key = `${t.x.toFixed(4)},${t.y.toFixed(4)}`
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push(t)
      }
      candidates.sort((p, q) => (p.y !== q.y ? p.y - q.y : p.x - q.x))
      if (candidates.length > 80) candidates = candidates.slice(0, 80)
      selected = candidates[0] ?? null
      rejected = candidates.slice(1, 12)
    } else if (ifp) {
      candidates = [
        { x: ifp.minX, y: ifp.minY },
        { x: ifp.minX, y: ifp.maxY },
        { x: ifp.maxX, y: ifp.minY },
        { x: ifp.maxX, y: ifp.maxY },
      ]
      selected = candidates[0]!
      rejected = candidates.slice(1)
    }
    return {
      offset: offset.polygon.points,
      nfpOuters,
      nfpHoles,
      ifp: ifp?.polygon.points ?? [],
      candidates,
      selected,
      rejected,
    }
  }, [advanced, parts, spacingMm, sheetW, sheetH, marginMm])

  if (parts.length === 0) {
    return (
      <div className="workspace-empty">
        <p className="workspace-empty__title">Geometri yok</p>
        <p className="workspace-empty__hint">Önce bir SVG yükleyin</p>
      </div>
    )
  }

  const extras = overlays
    ? [overlays.offset, ...overlays.nfpOuters, ...overlays.nfpHoles, overlays.ifp]
    : []

  return (
    <div className="workspace-preview workspace-preview--debug">
      <svg
        className="workspace-preview__svg"
        viewBox={boundsViewBox(parts, extras)}
        preserveAspectRatio="xMidYMid meet"
      >
        {parts.map((part) => (
          <g key={part.id}>
            <rect
              x={part.boundingBox.minX}
              y={part.boundingBox.minY}
              width={part.boundingBox.width}
              height={part.boundingBox.height}
              className="debug-bbox"
            />
            <path d={ringPath(part.outer.points)} className="debug-outer" />
            {part.holes.map((hole, i) => (
              <path
                key={`${part.id}-h${i}`}
                d={ringPath(hole.points)}
                className="debug-hole"
              />
            ))}
          </g>
        ))}

        {overlays && (
          <g className="debug-advanced">
            {overlays.offset.length >= 3 && (
              <path d={ringPath(overlays.offset)} className="debug-offset" />
            )}
            {overlays.nfpOuters.map((ring, i) => (
              <path key={`nfp-o-${i}`} d={ringPath(ring)} className="debug-nfp" />
            ))}
            {overlays.nfpHoles.map((ring, i) => (
              <path
                key={`nfp-h-${i}`}
                d={ringPath(ring)}
                className="debug-nfp-hole"
              />
            ))}
            {overlays.ifp.length >= 3 && (
              <path d={ringPath(overlays.ifp)} className="debug-ifp" />
            )}
            {overlays.candidates.map((c, i) => (
              <circle
                key={`c-${i}`}
                cx={c.x}
                cy={c.y}
                r={1.6}
                className="debug-candidate"
              />
            ))}
            {overlays.rejected.map((c, i) => (
              <circle
                key={`r-${i}`}
                cx={c.x}
                cy={c.y}
                r={1.8}
                className="debug-candidate-rejected"
              />
            ))}
            {overlays.selected && (
              <circle
                cx={overlays.selected.x}
                cy={overlays.selected.y}
                r={3.2}
                className="debug-candidate-selected"
              />
            )}
          </g>
        )}
      </svg>
      {advanced && (
        <p className="debug-legend">
          contours · holes · offset · NFP · IFP · candidates · selected · rejected
          (BL priority) · local-search moves run in Worker only
        </p>
      )}
    </div>
  )
}
