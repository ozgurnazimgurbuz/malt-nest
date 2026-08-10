import type { NestingSuccess } from '../nesting'
import {
  DEFAULT_NEST,
  OPTIMIZATION_OPTIONS,
  ROTATION_MODE_OPTIONS,
  ROTATION_OPTIONS,
  type NestSettings,
  type RotationAngle,
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
  function toggleAngle(angle: RotationAngle) {
    const has = nest.rotationAngles.includes(angle)
    const rotationAngles = has
      ? nest.rotationAngles.filter((a) => a !== angle)
      : [...nest.rotationAngles, angle].sort((a, b) => a - b)
    onNest({ ...nest, rotationAngles: rotationAngles as RotationAngle[] })
  }

  return (
    <aside className="panel">
      <header className="panel__brand">
        <span className="panel__mark">MN</span>
        <div>
          <h1 className="panel__title">Malt Nest</h1>
          <p className="panel__subtitle">2D Auto Nesting</p>
        </div>
      </header>

      <section className="panel__section">
        <h2 className="panel__heading">Dosya</h2>
        <FileDropzone fileName={svg?.fileName ?? null} onFile={onFile} />
        <dl className="meta meta--4">
          <div>
            <dt>Genişlik (mm)</dt>
            <dd>{formatDim(svg?.width ?? null)}</dd>
          </div>
          <div>
            <dt>Yükseklik (mm)</dt>
            <dd>{formatDim(svg?.height ?? null)}</dd>
          </div>
          <div>
            <dt>Parça sayısı</dt>
            <dd>{svg ? svg.partCount : '—'}</dd>
          </div>
          <div>
            <dt>Toplam alan</dt>
            <dd>
              {svg ? `${formatDim(svg.totalArea)} mm²` : '—'}
            </dd>
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
            checked={nest.allowRotation}
            onChange={(e) =>
              onNest({
                ...nest,
                allowRotation: e.target.checked,
                rotationAngles: e.target.checked
                  ? nest.rotationAngles.length
                    ? nest.rotationAngles
                    : [...DEFAULT_NEST.rotationAngles]
                  : nest.rotationAngles,
              })
            }
          />
          <span>Döndürmeye izin ver</span>
        </label>

        <fieldset className="angles" disabled={!nest.allowRotation}>
          <legend>Döndürme açısı (orthogonal)</legend>
          <div className="angles__row">
            {ROTATION_OPTIONS.map((angle) => (
              <label key={angle} className="chip">
                <input
                  type="checkbox"
                  checked={nest.rotationAngles.includes(angle)}
                  onChange={() => toggleAngle(angle)}
                  disabled={nest.rotationMode !== 'orthogonal'}
                />
                <span>{angle}°</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>Rotation</span>
          <select
            value={nest.rotationMode}
            disabled={!nest.allowRotation}
            onChange={(e) =>
              onNest({
                ...nest,
                rotationMode: e.target.value as NestSettings['rotationMode'],
              })
            }
          >
            {ROTATION_MODE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Optimization</span>
          <select
            value={nest.optimizationLevel}
            onChange={(e) =>
              onNest({
                ...nest,
                optimizationLevel: e.target.value as NestSettings['optimizationLevel'],
              })
            }
          >
            {OPTIMIZATION_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

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

        {/* Stage 10F: UI placeholders only — no engine pack preference yet. */}
        <div className="dayama" aria-disabled="true">
          <span className="dayama__label">Dayama (yakında)</span>
          <div className="dayama__row">
            <button
              type="button"
              className="btn dayama__btn"
              disabled
              title="Engine’de yatay dayama tercihi yok — sonraki stage"
            >
              ↔ Yatay Dayama
            </button>
            <button
              type="button"
              className="btn dayama__btn"
              disabled
              title="Engine’de dikey dayama tercihi yok — sonraki stage"
            >
              ↕ Dikey Dayama
            </button>
          </div>
        </div>

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
