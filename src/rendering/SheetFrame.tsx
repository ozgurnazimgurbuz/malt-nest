import type { CSSProperties, ReactNode } from 'react'
import type { SheetSettings } from '../state'

type Props = {
  sheet: SheetSettings
  marginMm?: number
  children?: ReactNode
}

/**
 * Visual sheet: a true width×height rectangle in mm (never forced square).
 */
export function SheetFrame({ sheet, marginMm = 0, children }: Props) {
  const w = Math.max(1, sheet.widthMm)
  const h = Math.max(1, sheet.heightMm)
  const margin = Math.max(0, marginMm)
  const label = `${formatMm(w)} × ${formatMm(h)} mm`

  return (
    <div className="sheet-frame">
      <div className="sheet-frame__meta">
        <span className="sheet-frame__dim">Width {formatMm(w)} mm</span>
        <span className="sheet-frame__sep">·</span>
        <span className="sheet-frame__dim">Height {formatMm(h)} mm</span>
      </div>

      <div className="sheet-frame__fit">
        <div
          className="sheet-frame__stage"
          style={
            {
              aspectRatio: `${w} / ${h}`,
              '--sheet-w': w,
              '--sheet-h': h,
            } as CSSProperties
          }
        >
          <svg
            className="sheet-frame__svg"
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Sheet ${label}`}
          >
            <rect
              className="sheet-frame__board"
              x={0}
              y={0}
              width={w}
              height={h}
            />
            {margin > 0 && margin * 2 < w && margin * 2 < h && (
              <rect
                className="sheet-frame__margin"
                x={margin}
                y={margin}
                width={w - margin * 2}
                height={h - margin * 2}
              />
            )}
            <text
              className="sheet-frame__svg-label"
              x={w / 2}
              y={h * 0.035}
              textAnchor="middle"
              dominantBaseline="hanging"
              fontSize={Math.max(w, h) * 0.028}
            >
              {formatMm(w)} mm
            </text>
            <text
              className="sheet-frame__svg-label"
              x={w * 0.028}
              y={h / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={Math.max(w, h) * 0.028}
              transform={`rotate(-90 ${w * 0.028} ${h / 2})`}
            >
              {formatMm(h)} mm
            </text>
          </svg>

          {children && <div className="sheet-frame__overlay">{children}</div>}
        </div>
      </div>
    </div>
  )
}

function formatMm(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
