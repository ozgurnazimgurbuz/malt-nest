import {
  GeometryDebugPreview,
  NestPreview,
  SheetFrame,
  SvgPreview,
} from '../rendering'
import type { NestingSuccess } from '../nesting'
import type { AppStatus, NestSettings, SheetSettings, SvgMeta } from '../state'
import { NestProgressCard } from './NestProgressCard'
import type { NestUiProgress } from './nestProgress'
import type { LiveNestTrace } from './liveNestTrace'

export type PreviewMode = 'svg' | 'geometry' | 'nest'

type Props = {
  svg: SvgMeta | null
  sheet: SheetSettings
  nest: NestSettings
  status: AppStatus
  previewMode: PreviewMode
  onPreviewMode: (mode: PreviewMode) => void
  nestResult: NestingSuccess | null
  nestSheetIndex: number
  onNestSheetIndex: (index: number) => void
  nestDebug?: boolean
  calculating?: boolean
  nestProgress?: NestUiProgress | null
  liveTrace?: LiveNestTrace | null
}

export function Workspace({
  svg,
  sheet,
  nest,
  status,
  previewMode,
  onPreviewMode,
  nestResult,
  nestSheetIndex,
  onNestSheetIndex,
  nestDebug = false,
  calculating = false,
  nestProgress = null,
  liveTrace = null,
}: Props) {
  const showLiveNest = calculating && nestDebug && liveTrace != null
  const showNest = showLiveNest || (previewMode === 'nest' && nestResult != null)
  const displayedSheet = showLiveNest ? liveTrace.sheetIndex : nestSheetIndex
  const placements = showLiveNest
    ? (liveTrace.committed?.placements ?? [])
    : (nestResult?.placements ?? [])
  const showLiveCard =
    nestProgress?.visible &&
    (calculating ||
      nestProgress.phase === 'preparing' ||
      nestProgress.phase === 'blf' ||
      nestProgress.phase === 'optimize' ||
      nestProgress.phase === 'finalizing' ||
      nestProgress.phase === 'stopping')

  return (
    <main className="workspace">
      <div className="workspace__toolbar">
        <span className="workspace__label">Çalışma alanı</span>
        <div className="workspace__toolbar-right">
          {svg && (
            <div className="seg">
              <button
                type="button"
                className={previewMode === 'svg' ? 'seg__btn seg__btn--on' : 'seg__btn'}
                onClick={() => onPreviewMode('svg')}
              >
                SVG
              </button>
              <button
                type="button"
                className={
                  previewMode === 'geometry' ? 'seg__btn seg__btn--on' : 'seg__btn'
                }
                onClick={() => onPreviewMode('geometry')}
              >
                Geometri
              </button>
              <button
                type="button"
                className={previewMode === 'nest' ? 'seg__btn seg__btn--on' : 'seg__btn'}
                onClick={() => onPreviewMode('nest')}
                disabled={!nestResult}
              >
                Nest
              </button>
            </div>
          )}
          {!showLiveNest && showNest && nestResult!.sheets.length > 1 && (
            <label className="sheet-picker">
              Sheet
              <select
                value={nestSheetIndex}
                onChange={(e) => onNestSheetIndex(Number(e.target.value))}
              >
                {nestResult!.sheets.map((s) => (
                  <option key={s.sheetIndex} value={s.sheetIndex}>
                    {s.sheetIndex + 1} / {nestResult.sheets.length}
                  </option>
                ))}
              </select>
            </label>
          )}
          {status.kind !== 'idle' && (
            <span
              className={
                status.kind === 'error'
                  ? 'workspace__status workspace__status--error'
                  : 'workspace__status'
              }
            >
              {status.message}
            </span>
          )}
        </div>
      </div>
      <div className="workspace__stage">
        {showLiveCard && nestProgress ? (
          <div className="workspace-progress">
            <NestProgressCard progress={nestProgress} variant="overlay" />
          </div>
        ) : null}
        {showNest ? (
          <div className="sheet-frame">
            <div className="sheet-frame__meta">
              <span className="sheet-frame__dim">
                Width {fmt(sheet.widthMm)} mm
              </span>
              <span className="sheet-frame__sep">·</span>
              <span className="sheet-frame__dim">
                Height {fmt(sheet.heightMm)} mm
              </span>
              <span className="sheet-frame__sep">·</span>
              <span className="sheet-frame__dim">
                Nest sheet {displayedSheet + 1}
              </span>
            </div>
            <div className="sheet-frame__fit">
              <NestPreview
                sheet={sheet}
                marginMm={nest.marginMm}
                parts={svg?.parts ?? []}
                placements={placements}
                sheetIndex={displayedSheet}
                attempts={showLiveNest ? liveTrace.trail : []}
                current={showLiveNest ? liveTrace.current : null}
                debug={nestDebug}
              />
            </div>
          </div>
        ) : (
          <SheetFrame sheet={sheet} marginMm={nest.marginMm}>
            {!svg ? (
              <div className="workspace-empty workspace-empty--on-sheet">
                <p className="workspace-empty__title">SVG dosyanızı yükleyin</p>
                <p className="workspace-empty__hint">
                  Tabaka {fmt(sheet.widthMm)} × {fmt(sheet.heightMm)} mm
                </p>
              </div>
            ) : previewMode === 'geometry' ? (
              <GeometryDebugPreview
                parts={svg.parts}
                advanced={nestDebug}
                spacingMm={nest.gapMm}
                sheetW={sheet.widthMm}
                sheetH={sheet.heightMm}
                marginMm={nest.marginMm}
              />
            ) : (
              <SvgPreview raw={svg.raw} fileName={svg.fileName} />
            )}
          </SheetFrame>
        )}
      </div>
    </main>
  )
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
