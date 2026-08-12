import type { CSSProperties } from 'react'
import type { GeometryPart } from '../geometry'
import type { Placement } from '../nesting'
import { applyPlacement, placementBounds } from '../nesting/placement/worldGeometry'
import type { SheetSettings } from '../state'
import type { LiveNestPlayback } from '../ui/liveNestTrace'
import { NestAttemptTrail } from './NestAttemptTrail'

type Props = {
  sheet: SheetSettings
  marginMm: number
  parts: GeometryPart[]
  placements: Placement[]
  sheetIndex: number
  playback?: LiveNestPlayback | null
  debug?: boolean
}

function ringPath(points: { x: number; y: number }[]): string {
  if (!points.length) return ''
  const [f, ...rest] = points
  let d = `M ${f!.x} ${f!.y}`
  for (const p of rest) d += ` L ${p.x} ${p.y}`
  d += ' Z'
  return d
}

export function NestPreview({
  sheet,
  marginMm,
  parts,
  placements,
  sheetIndex,
  playback = null,
  debug = false,
}: Props) {
  const w = Math.max(1, sheet.widthMm)
  const h = Math.max(1, sheet.heightMm)
  const m = Math.max(0, marginMm)
  const sheetPlacements = placements.filter((p) => p.sheetIndex === sheetIndex)
  const partMap = new Map(parts.map((p) => [p.id, p]))

  return (
    <div
      className="nest-preview"
      style={
        {
          aspectRatio: `${w} / ${h}`,
          '--sheet-w': w,
          '--sheet-h': h,
        } as CSSProperties
      }
    >
      <svg
        className="nest-preview__svg"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
      >
        <rect className="nest-preview__board" x={0} y={0} width={w} height={h} />
        {m * 2 < w && m * 2 < h && (
          <rect
            className="nest-preview__margin"
            x={m}
            y={m}
            width={w - m * 2}
            height={h - m * 2}
          />
        )}

        {sheetPlacements.map((pl) => {
          const part = partMap.get(pl.partId)
          if (!part) return null
          const { outer, holes } = applyPlacement(part, pl)
          const b = placementBounds(outer)
          return (
            <g key={`${pl.partId}-${pl.sheetIndex}-${pl.x}-${pl.y}-${pl.rotation}`}>
              {debug && (
                <rect
                  className="nest-preview__bbox"
                  x={b.minX}
                  y={b.minY}
                  width={b.width}
                  height={b.height}
                />
              )}
              <path d={ringPath(outer)} className="nest-preview__outer" />
              {holes.map((hole, i) => (
                <path
                  key={i}
                  d={ringPath(hole)}
                  className="nest-preview__hole"
                />
              ))}
            </g>
          )
        })}
      </svg>
      {playback ? (
        <NestAttemptTrail
          playback={playback}
          parts={parts}
          sheetWidth={w}
          sheetHeight={h}
        />
      ) : null}
    </div>
  )
}
