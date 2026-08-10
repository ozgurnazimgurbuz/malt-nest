import { useEffect, useState } from 'react'
import type { NestUiProgress } from './nestProgress'

type Props = {
  progress: NestUiProgress
  /** Compact overlay mode for workspace. */
  variant?: 'panel' | 'overlay'
  onNewIteration?: () => void
  canNewIteration?: boolean
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0.0 sn'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} sn`
}

function liveElapsedMs(progress: NestUiProgress, now: number): number {
  if (
    progress.phase === 'completed' ||
    progress.phase === 'cancelled' ||
    progress.phase === 'error'
  ) {
    return progress.summary?.elapsedMs ?? progress.elapsedMs ?? 0
  }
  if (progress.startedAtMs != null) {
    return Math.max(0, now - progress.startedAtMs)
  }
  return progress.elapsedMs ?? 0
}

export function NestProgressCard({
  progress,
  variant = 'panel',
  onNewIteration,
  canNewIteration = false,
}: Props) {
  const pct = Math.min(100, Math.max(0, progress.percent))
  const running =
    progress.phase === 'preparing' ||
    progress.phase === 'blf' ||
    progress.phase === 'optimize' ||
    progress.phase === 'stopping'
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    if (!running || progress.startedAtMs == null) return
    const id = window.setInterval(() => setNow(performance.now()), 200)
    return () => window.clearInterval(id)
  }, [running, progress.startedAtMs])

  const elapsed = liveElapsedMs(progress, now)
  const label =
    progress.phase === 'optimize'
      ? 'OPTIMIZE'
      : progress.phase === 'completed' || progress.phase === 'cancelled'
        ? 'NESTING'
        : 'NESTING'
  const phaseClass = `nest-progress nest-progress--${progress.phase}${
    variant === 'overlay' ? ' nest-progress--overlay' : ''
  }`

  return (
    <div
      className={phaseClass}
      data-phase={progress.phase}
      aria-live="polite"
    >
      <div className="nest-progress__header">
        <div className="nest-progress__label">{label}</div>
        {progress.isBest ? (
          <span className="nest-progress__best">★ EN İYİ SONUÇ</span>
        ) : null}
      </div>
      <div className="nest-progress__title">{progress.title}</div>

      {running || progress.phase === 'completed' ? (
        <div
          className={
            progress.awaitingStop
              ? 'nest-progress__track nest-progress__track--pulse'
              : 'nest-progress__track'
          }
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="nest-progress__fill"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}

      <div className="nest-progress__meta">
        {(running || progress.phase === 'completed') && (
          <span className="nest-progress__pct">{pct}%</span>
        )}
        {progress.detail ? (
          <span className="nest-progress__detail">
            {progress.detail.split('\n').map((line, i) => (
              <span key={i} className="nest-progress__detail-line">
                {line}
              </span>
            ))}
          </span>
        ) : null}
      </div>

      {running && (
        <div className="nest-progress__elapsed">
          Geçen süre: {formatDuration(elapsed)}
        </div>
      )}

      {progress.statusLine ? (
        <p className="nest-progress__status">{progress.statusLine}</p>
      ) : null}

      {progress.summary && (
        <dl className="nest-progress__summary">
          <div>
            <dt>Parça</dt>
            <dd>
              {progress.summary.placedCount} / {progress.summary.partCount}
              {progress.summary.unplacedCount > 0
                ? ` · ${progress.summary.unplacedCount} yerleşmedi`
                : ''}
            </dd>
          </div>
          <div>
            <dt>Tabaka</dt>
            <dd>{progress.summary.sheetCount}</dd>
          </div>
          <div>
            <dt>Kullanım</dt>
            <dd>{(progress.summary.utilization * 100).toFixed(1)}%</dd>
          </div>
          <div>
            <dt>Süre</dt>
            <dd>{formatDuration(progress.summary.elapsedMs)}</dd>
          </div>
          {progress.iteration != null ? (
            <div>
              <dt>İterasyon</dt>
              <dd>{progress.iteration}</dd>
            </div>
          ) : null}
          {progress.summary.note ? (
            <div className="nest-progress__summary-note">
              <dt>Not</dt>
              <dd>{progress.summary.note}</dd>
            </div>
          ) : null}
        </dl>
      )}

      {progress.errorMessage ? (
        <p className="nest-progress__error">{progress.errorMessage}</p>
      ) : null}

      {onNewIteration &&
        (progress.phase === 'completed' || progress.phase === 'cancelled') && (
          <button
            type="button"
            className="btn btn--block nest-progress__iterate"
            disabled={!canNewIteration}
            onClick={onNewIteration}
          >
            ↻ YENİ İTERASYON
          </button>
        )}
    </div>
  )
}
