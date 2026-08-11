import { useEffect, useRef, useState } from 'react'
import {
  downloadAllSvgSheets,
  downloadSvgSheet,
  exportNestingSheetToSvg,
  exportNestingToSvg,
} from './export'
import {
  isBetterNestingResult,
  nestAsync,
  type NestingSuccess,
} from './nesting'
import {
  DEFAULT_NEST,
  DEFAULT_SHEET,
  type AppStatus,
  type NestSettings,
  type SheetSettings,
  type SvgMeta,
} from './state'
import { readSvgFile } from './svg'
import {
  applyEngineProgress,
  nestUiCancelledBest,
  nestUiCancelledPlain,
  nestUiCompleted,
  nestUiError,
  nestUiPreparing,
  nestUiStopping,
  type NestUiProgress,
  SettingsPanel,
  Workspace,
  type PreviewMode,
} from './ui'

function formatCompleted(result: NestingSuccess, prefix = 'Completed'): string {
  const { placedCount, partCount, unplacedCount, sheetCountUsed } =
    result.statistics
  const unplaced =
    unplacedCount > 0 ? ` · ${unplacedCount} yerleşmedi` : ''
  return `${prefix} · ${placedCount} / ${partCount}${unplaced} · ${sheetCountUsed} tabaka · ${(result.utilization * 100).toFixed(1)}%`
}

function nestSeedForIteration(
  baseSeed: number,
  iteration: number,
  deterministic: boolean,
): number {
  if (deterministic) return baseSeed
  const base = (baseSeed >>> 0) || 1
  return (base + Math.imul(Math.max(0, iteration - 1), 0x9e3779b9)) >>> 0 || 1
}

export default function App() {
  const [svg, setSvg] = useState<SvgMeta | null>(null)
  const [sheet, setSheet] = useState<SheetSettings>(DEFAULT_SHEET)
  const [nestSettings, setNestSettings] = useState<NestSettings>(DEFAULT_NEST)
  const [status, setStatus] = useState<AppStatus>({ kind: 'idle' })
  const [previewMode, setPreviewMode] = useState<PreviewMode>('svg')
  const [nestResult, setNestResult] = useState<NestingSuccess | null>(null)
  const [bestResult, setBestResult] = useState<NestingSuccess | null>(null)
  const [bestIteration, setBestIteration] = useState(0)
  const [iterationCount, setIterationCount] = useState(0)
  const [nestSheetIndex, setNestSheetIndex] = useState(0)
  const [nestDebug, setNestDebug] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [nestProgress, setNestProgress] = useState<NestUiProgress | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const activeJobIdRef = useRef<string | null>(null)
  const nestResultRef = useRef<NestingSuccess | null>(null)
  const bestResultRef = useRef<NestingSuccess | null>(null)
  const nestProgressRef = useRef<NestUiProgress | null>(null)
  const iterationRef = useRef(0)
  const fileLoadIdRef = useRef(0)
  useEffect(
    () => () => {
      fileLoadIdRef.current += 1
      activeJobIdRef.current = null
      abortRef.current?.abort()
    },
    [],
  )
  nestResultRef.current = nestResult
  bestResultRef.current = bestResult
  nestProgressRef.current = nestProgress

  function invalidateNestingState() {
    activeJobIdRef.current = null
    abortRef.current?.abort()
    abortRef.current = null
    setCalculating(false)
    setNestResult(null)
    nestResultRef.current = null
    setBestResult(null)
    bestResultRef.current = null
    setBestIteration(0)
    setIterationCount(0)
    iterationRef.current = 0
    setNestSheetIndex(0)
    setNestProgress(null)
    nestProgressRef.current = null
    setPreviewMode('svg')
    setStatus({ kind: 'idle' })
  }

  async function handleFile(file: File) {
    const loadId = ++fileLoadIdRef.current
    invalidateNestingState()
    setSvg(null)
    try {
      const meta = await readSvgFile(file)
      if (fileLoadIdRef.current !== loadId) return
      setSvg(meta)
      if (meta.warnings.length > 0) {
        setStatus({
          kind: 'info',
          message: `${meta.partCount} parça · ${meta.warnings.length} uyarı`,
        })
      } else {
        setStatus({
          kind: 'info',
          message: `${meta.partCount} parça ayrıştırıldı`,
        })
      }
    } catch (err) {
      if (fileLoadIdRef.current !== loadId) return
      setSvg(null)
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Dosya yüklenemedi.',
      })
    }
  }

  function applyResult(result: NestingSuccess, note?: string) {
    setNestResult(result)
    setNestSheetIndex(0)
    setPreviewMode('nest')
    setStatus({
      kind: 'info',
      message: note ?? formatCompleted(result),
    })
  }

  function recordIteration(result: NestingSuccess): {
    iteration: number
    isBest: boolean
  } {
    const iteration = iterationRef.current
    const prevBest = bestResultRef.current
    const isBest =
      !prevBest ||
      isBetterNestingResult(result, prevBest)
    if (isBest) {
      setBestResult(result)
      bestResultRef.current = result
      setBestIteration(iteration)
      applyResult(result)
    } else {
      // Keep preview on current best; still acknowledge this run
      setStatus({
        kind: 'info',
        message: `${formatCompleted(result, `İterasyon ${iteration}`)} · en iyi korundu`,
      })
    }
    return { iteration, isBest }
  }

  async function handleAutoNest() {
    if (!svg) return
    abortRef.current?.abort()

    const nextIter = iterationRef.current + 1
    iterationRef.current = nextIter
    setIterationCount(nextIter)

    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const ac = new AbortController()
    abortRef.current = ac
    activeJobIdRef.current = jobId
    const level = nestSettings.optimizationLevel
    const runSettings = {
      ...nestSettings,
      seed: nestSeedForIteration(
        nestSettings.seed,
        nextIter,
        nestSettings.deterministic,
      ),
    }
    setCalculating(true)
    const preparing = nestUiPreparing(jobId, svg.partCount, level, nextIter)
    setNestProgress(preparing)
    setStatus({
      kind: 'info',
      message: `İterasyon ${nextIter} · ${preparing.title}`,
    })

    try {
      const result = await nestAsync(
        {
          parts: svg.parts,
          sheet,
          settings: runSettings,
        },
        {
          signal: ac.signal,
          jobId,
          onProgress: (p) => {
            if (activeJobIdRef.current !== jobId) return
            setNestProgress((prev) => applyEngineProgress(prev, p, jobId))
            setStatus({
              kind: 'info',
              message:
                p.message ??
                `İterasyon ${nextIter} · ${preparing.title}`,
            })
          },
        },
      )

      if (activeJobIdRef.current !== jobId) return

      if (result.status === 'ok') {
        const { iteration, isBest } = recordIteration(result)
        setNestProgress(
          nestUiCompleted(jobId, isBest ? result : bestResultRef.current ?? result, {
            iteration,
            isBest,
            note: isBest
              ? undefined
              : `İterasyon ${iteration} · mevcut en iyi korundu`,
          }),
        )
      } else if (result.status === 'cancelled') {
        if (result.bestSoFar) {
          const { iteration, isBest } = recordIteration(result.bestSoFar)
          setNestProgress(
            nestUiCancelledBest(jobId, bestResultRef.current ?? result.bestSoFar, {
              iteration,
              isBest,
            }),
          )
        } else if (bestResultRef.current || nestResultRef.current) {
          setNestProgress(
            nestUiCancelledPlain(
              jobId,
              'Önceki sonuç korundu',
              nestProgressRef.current,
            ),
          )
          setStatus({
            kind: 'info',
            message: 'Stopped — previous result kept',
          })
        } else {
          setNestProgress(
            nestUiCancelledPlain(
              jobId,
              'Nesting durduruldu',
              nestProgressRef.current,
            ),
          )
          setStatus({ kind: 'info', message: 'Nesting stopped' })
        }
      } else {
        setNestProgress(nestUiError(jobId, result.message))
        setStatus({ kind: 'error', message: result.message })
      }
    } catch (err) {
      if (activeJobIdRef.current !== jobId) return
      if (ac.signal.aborted && (bestResultRef.current || nestResultRef.current)) {
        setNestProgress(
          nestUiCancelledPlain(
            jobId,
            'Önceki sonuç korundu',
            nestProgressRef.current,
          ),
        )
        setStatus({ kind: 'info', message: 'Stopped — previous result kept' })
      } else {
        const message =
          err instanceof Error ? err.message : 'Nesting failed'
        setNestProgress(nestUiError(jobId, message))
        setStatus({ kind: 'error', message })
      }
    } finally {
      if (activeJobIdRef.current === jobId) {
        setCalculating(false)
        abortRef.current = null
        activeJobIdRef.current = null
      }
    }
  }

  function handleStopNest() {
    abortRef.current?.abort()
    setNestProgress((prev) => nestUiStopping(prev))
    setStatus({
      kind: 'info',
      message: 'Durduruluyor… mevcut en iyi sonuç uygulanıyor',
    })
  }

  function handleExportSvg() {
    if (!nestResult || !svg) return
    const exported = exportNestingSheetToSvg(
      nestResult,
      svg.parts,
      nestSheetIndex,
      { sourceFileName: svg.fileName },
    )
    if (!exported.ok) {
      setStatus({ kind: 'error', message: exported.message })
      return
    }
    downloadSvgSheet(exported.sheets[0]!)
    setStatus({
      kind: 'info',
      message: `Exported ${exported.sheets[0]!.fileName}`,
    })
  }

  function handleExportAll() {
    if (!nestResult || !svg) return
    const exported = exportNestingToSvg(nestResult, svg.parts, {
      sourceFileName: svg.fileName,
    })
    if (!exported.ok) {
      setStatus({ kind: 'error', message: exported.message })
      return
    }
    downloadAllSvgSheets(exported.sheets, svg.fileName)
    setStatus({
      kind: 'info',
      message:
        exported.sheets.length === 1
          ? `Exported ${exported.sheets[0]!.fileName}`
          : `Exported ${exported.sheets.length} sheets (ZIP)`,
    })
  }

  return (
    <div className="app">
      <SettingsPanel
        svg={svg}
        sheet={sheet}
        nest={nestSettings}
        canNest={svg != null && svg.partCount > 0}
        calculating={calculating}
        nestResult={nestResult}
        bestIteration={bestIteration}
        iterationCount={iterationCount}
        nestProgress={nestProgress}
        nestDebug={nestDebug}
        onFile={handleFile}
        onSheet={(next) => {
          invalidateNestingState()
          setSheet(next)
        }}
        onNest={(next) => {
          invalidateNestingState()
          setNestSettings(next)
        }}
        onAutoNest={() => {
          void handleAutoNest()
        }}
        onNewIteration={() => {
          void handleAutoNest()
        }}
        onStopNest={handleStopNest}
        onNestDebug={setNestDebug}
        onExportSvg={handleExportSvg}
        onExportAll={handleExportAll}
      />
      <Workspace
        svg={svg}
        sheet={sheet}
        nest={nestSettings}
        status={status}
        previewMode={previewMode}
        onPreviewMode={setPreviewMode}
        nestResult={nestResult}
        nestSheetIndex={nestSheetIndex}
        onNestSheetIndex={setNestSheetIndex}
        nestDebug={nestDebug}
        calculating={calculating}
        nestProgress={nestProgress}
      />
    </div>
  )
}
