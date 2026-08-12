import type { NestingSuccess } from '../nesting'
import {
  type NestSettings,
  type SheetSettings,
  type SvgMeta,
} from '../state'
import { FileDropzone } from './FileDropzone'
import { NestProgressCard } from './NestProgressCard'
import type { NestUiProgress } from './nestProgress'

type Props = {
  svg: SvgMeta | null
  sheet: SheetSettings
  nest: NestSettings
  canNest: boolean
  calculating: boolean
  nestResult: NestingSuccess | null
  bestIteration?: number
  iterationCount?: number
  nestProgress: NestUiProgress | null
  nestDebug: boolean
  onFile: (file: File) => void
  onSheet: (next: SheetSettings) => void
  onNest: (next: NestSettings) => void
  onAutoNest: () => void
  onNewIteration?: () => void
  onStopNest: () => void
  onNestDebug: (next: boolean) => void
  onExportSvg?: () => void
  onExportAll?: () => void
}

function formatDim(n: number | null): string {
  if (n == null) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

export function SettingsPanel({
  svg,
  sheet,
  nest,
  canNest,
  calculating,
  nestResult,
  bestIteration = 0,
  iterationCount = 0,
  nestProgress,
  nestDebug,
  onFile,
  onSheet,
  onNest,
  onAutoNest,
  onNewIteration,
  onStopNest,
  onNestDebug,
  onExportSvg,
  onExportAll,
}: Props) {
  return (
    <aside className="panel">
      <header className="panel__brand">
        <span className="panel__mark" aria-hidden="true">
          <svg
            className="panel__mark-svg"
            viewBox="0 0 46 22"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Exact Malt Studio wordmark M (logo.svg polygon) */}
            <g transform="translate(0 0.35) scale(0.136)">
              <polygon points="9.4 21.7 69 155.2 76.9 155.2 128.7 29.1 128.7 155.4 159.3 155.4 159.3 .1 130.4 0 83.8 114 32.9 .1 0 .1 0 155.4 9.4 155.4 9.4 21.7" />
            </g>
            {/* Matching geometric Latin N (same mint fill, sharp joins) */}
            <polygon points="25.4 0.8 30.2 0.8 38.6 15.6 38.6 0.8 43.4 0.8 43.4 21.2 38.6 21.2 30.2 6.4 30.2 21.2 25.4 21.2" />
          </svg>
        </span>
        <div>
          <h1 className="panel__title">Malt Nest</h1>
          <p className="panel__subtitle">2D Auto Nesting</p>
        </div>
      </header>

      <div className="panel__body">
      <section className="panel__section">
        <h2 className="panel__heading">Dosya</h2>
        <FileDropzone fileName={svg?.fileName ?? null} onFile={onFile} />
        <dl className="meta meta--1">
          <div>
            <dt>Parça sayısı</dt>
            <dd>{svg ? svg.partCount : '—'}</dd>
          </div>
        </dl>
        {svg && svg.warnings.length > 0 && (
          <div className="warnings">
            <h3 className="warnings__title">
              Uyarılar ({svg.warnings.length})
            </h3>
            <ul className="warnings__list">
              {svg.warnings.slice(0, 8).map((w, i) => (
                <li key={`${w.code}-${i}`}>
                  <span className="warnings__code">{w.code}</span>
                  {w.message}
                </li>
              ))}
              {svg.warnings.length > 8 && (
                <li>+{svg.warnings.length - 8} daha…</li>
              )}
            </ul>
          </div>
        )}
      </section>

      <section className="panel__section">
        <h2 className="panel__heading">Tabaka</h2>
        <div className="field-grid field-grid--2">
          <label className="field">
            <span>Width (mm)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={sheet.widthMm}
              onChange={(e) =>
                onSheet({ ...sheet, widthMm: Number(e.target.value) || 0 })
              }
            />
          </label>
          <label className="field">
            <span>Height (mm)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={sheet.heightMm}
              onChange={(e) =>
                onSheet({ ...sheet, heightMm: Number(e.target.value) || 0 })
              }
            />
          </label>
        </div>
        <p className="sheet-summary">
          {formatDim(sheet.widthMm)} × {formatDim(sheet.heightMm)} mm
        </p>
      </section>

      <section className="panel__section">
        <h2 className="panel__heading">Nesting ayarları</h2>
        <div className="field-grid">
          <label className="field">
            <span>Parçalar arası boşluk (mm)</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={nest.gapMm}
              onChange={(e) =>
                onNest({ ...nest, gapMm: Number(e.target.value) || 0 })
              }
            />
          </label>
          <label className="field">
            <span>Kenar boşluğu (mm)</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={nest.marginMm}
              onChange={(e) =>
                onNest({ ...nest, marginMm: Number(e.target.value) || 0 })
              }
            />
          </label>
        </div>

        <label className="switch">
          <input
            type="checkbox"
            checked={nest.allowPartInPart}
            onChange={(e) =>
              onNest({ ...nest, allowPartInPart: e.target.checked })
            }
          />
          <span>Part-in-part (holes)</span>
        </label>

        {nestDebug && (
          <>
            <label className="field">
              <span>Seed (debug)</span>
              <input
                type="number"
                value={nest.seed}
                onChange={(e) =>
                  onNest({
                    ...nest,
                    seed: Number(e.target.value) || 0,
                  })
                }
              />
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={nest.deterministic}
                onChange={(e) =>
                  onNest({ ...nest, deterministic: e.target.checked })
                }
              />
              <span>Deterministic budget</span>
            </label>
          </>
        )}
      </section>
      </div>

      <section className="panel__section panel__section--actions">
        <h2 className="panel__heading">İşlemler</h2>
        {!calculating ? (
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={!canNest}
            onClick={onAutoNest}
          >
            AUTO NEST
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--danger btn--block"
            onClick={onStopNest}
          >
            STOP
          </button>
        )}
        <label className="switch">
          <input
            type="checkbox"
            checked={nestDebug}
            onChange={(e) => onNestDebug(e.target.checked)}
          />
          <span>Nest / geom debug</span>
        </label>
        {nestProgress?.visible &&
          (!calculating ||
            nestProgress.phase === 'completed' ||
            nestProgress.phase === 'cancelled' ||
            nestProgress.phase === 'error') && (
          <NestProgressCard
            progress={nestProgress}
            canNewIteration={canNest && !calculating}
            onNewIteration={onNewIteration}
          />
        )}
        {calculating && nestProgress?.visible && (
          <p className="nest-progress-hint">
            Canlı ilerleme çalışma alanında · İterasyon{' '}
            {nestProgress.iteration ?? '…'}
          </p>
        )}
        {nestResult && onExportSvg && (
          <div className="export-actions">
            <button
              type="button"
              className="btn btn--block"
              onClick={onExportSvg}
            >
              EXPORT SVG
            </button>
            {nestResult.sheets.length > 1 && onExportAll && (
              <button
                type="button"
                className="btn btn--block"
                onClick={onExportAll}
              >
                EXPORT ALL (ZIP)
              </button>
            )}
          </div>
        )}
        {nestResult && (
          <dl className="nest-stats">
            {bestIteration > 0 && (
              <div>
                <dt>En iyi</dt>
                <dd>
                  ★ İterasyon {bestIteration}
                  {iterationCount > bestIteration
                    ? ` / ${iterationCount}`
                    : ''}
                </dd>
              </div>
            )}
            <div>
              <dt>Placed</dt>
              <dd>
                {nestResult.statistics.placedCount} /{' '}
                {nestResult.statistics.partCount}
              </dd>
            </div>
            <div>
              <dt>Sheets</dt>
              <dd>{nestResult.statistics.sheetCountUsed}</dd>
            </div>
            <div>
              <dt>Utilization</dt>
              <dd>{(nestResult.utilization * 100).toFixed(1)}%</dd>
            </div>
            <div>
              <dt>Waste</dt>
              <dd>
                {(
                  (1 -
                    nestResult.utilization) *
                  100
                ).toFixed(1)}
                %
              </dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{Math.round(nestResult.calculationTimeMs)} ms</dd>
            </div>
            {nestResult.unplacedPartIds.length > 0 && (
              <div>
                <dt>Unplaced</dt>
                <dd className="nest-stats__warn">
                  {nestResult.unplacedPartIds.length}
                </dd>
              </div>
            )}
          </dl>
        )}
      </section>
    </aside>
  )
}
