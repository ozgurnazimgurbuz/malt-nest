import { describe, expect, it } from 'vitest'
import type { NestingSuccess, NestProgress } from '../nesting'
import {
  applyEngineProgress,
  isBetterNestResult,
  nestUiCancelledBest,
  nestUiCancelledPlain,
  nestUiCompleted,
  nestUiError,
  nestUiFromEngineProgress,
  nestUiPreparing,
  nestUiStopping,
  percentFromRatio,
} from './nestProgress'

function fakeResult(partial?: Partial<NestingSuccess>): NestingSuccess {
  return {
    status: 'ok',
    placements: [],
    sheets: [],
    unplacedPartIds: [],
    utilization: 0.42,
    wasteMm2: 100,
    calculationTimeMs: 1250,
    statistics: {
      partCount: 16,
      placedCount: 16,
      unplacedCount: 0,
      sheetCountUsed: 1,
      totalPartAreaMm2: 1,
      totalSheetAreaMm2: 1,
      overallUtilization: 0.42,
      overallWasteMm2: 100,
    },
    engineId: 'test',
    ...partial,
  }
}

describe('Stage 10A/10F nest progress UI state', () => {
  it('percentFromRatio uses engine ratio only', () => {
    expect(percentFromRatio(0)).toBe(0)
    expect(percentFromRatio(0.75)).toBe(75)
    expect(percentFromRatio(1)).toBe(100)
    expect(percentFromRatio(1.5)).toBe(100)
    expect(percentFromRatio(-0.2)).toBe(0)
  })

  it('maps prepare → preparing', () => {
    const ui = nestUiFromEngineProgress(
      {
        ratio: 0.02,
        phase: 'prepare',
        partCount: 16,
        placedCount: 0,
        jobId: 'j1',
      },
      'j1',
    )
    expect(ui?.phase).toBe('preparing')
    expect(ui?.title).toContain('hazırlanıyor')
    expect(ui?.percent).toBe(2)
    expect(ui?.detail).toContain('Parça')
    expect(ui?.statusLine).toBeUndefined()
  })

  it('maps BLF seed progress with parts / sheet', () => {
    const ui = nestUiFromEngineProgress(
      {
        ratio: 0.75,
        phase: 'seed',
        placedCount: 12,
        partCount: 16,
        sheetCount: 1,
        jobId: 'j1',
        elapsedMs: 12400,
        message: 'Initial layout',
      },
      'j1',
      nestUiPreparing('j1', 16, 1),
    )
    expect(ui?.phase).toBe('blf')
    expect(ui?.title).toBe('İlk yerleşim')
    expect(ui?.percent).toBe(75)
    expect(ui?.detail).toContain('Parça 12 / 16')
    expect(ui?.detail).toContain('Tabaka 1')
    expect(ui?.elapsedMs).toBe(12400)
    expect(ui?.iteration).toBe(1)
    expect(ui?.statusLine).toBe('Initial layout')
  })

  it('maps order search separately and ignores transitional mode fields', () => {
    const search = nestUiFromEngineProgress(
      {
        ratio: 0.48,
        phase: 'optimize',
        optimizationLevel: 'deep',
        multiStartIndex: 3,
        multiStartCount: 8,
        generation: 42,
        placedCount: 16,
        partCount: 16,
        jobId: 'j1',
        message: 'Trying orders · largest first',
      },
      'j1',
    )
    expect(search?.phase).toBe('optimize')
    expect(search?.title).toBe('Sıralamalar deneniyor')
    expect(search?.percent).toBe(48)
    expect(search?.detail).toBe('Parça 16 / 16')
    expect(search?.detail).not.toMatch(/Start|Generation|Fast|Balanced|Deep/)
    expect(search?.statusLine).toBe('Trying orders · largest first')
    expect(search).not.toHaveProperty('optimizationLevel')

    const improve = nestUiFromEngineProgress(
      {
        ratio: 0.65,
        phase: 'optimize',
        message: 'Improving layout · layer 2',
      },
      'j1',
    )
    expect(improve?.title).toBe('Yerleşim iyileştiriliyor')
  })

  it('keeps finalize progress in a running state', () => {
    const ui = nestUiFromEngineProgress(
      {
        ratio: 0.98,
        phase: 'finalize',
        placedCount: 16,
        partCount: 16,
        jobId: 'j1',
        message: 'Full-angle polish',
      },
      'j1',
    )

    expect(ui?.phase).toBe('finalizing')
    expect(ui?.title).toBe('Sonuç doğrulanıyor')
    expect(ui?.percent).toBe(98)
  })

  it('ignores stale jobId progress', () => {
    const prev = nestUiPreparing('job-active', 16)
    const stale: NestProgress = {
      ratio: 0.99,
      phase: 'optimize',
      jobId: 'job-old',
      generation: 999,
    }
    const next = applyEngineProgress(prev, stale, 'job-active')
    expect(next).toBe(prev)
    expect(next?.percent).toBe(0)
  })

  it('stopping keeps last percent and pulses', () => {
    const running = nestUiFromEngineProgress(
      {
        ratio: 0.6,
        phase: 'optimize',
        jobId: 'j1',
        generation: 10,
      },
      'j1',
    )!
    const stopping = nestUiStopping(running)
    expect(stopping.phase).toBe('stopping')
    expect(stopping.title).toContain('Durduruluyor')
    expect(stopping.statusLine).toContain('en iyi')
    expect(stopping.percent).toBe(60)
    expect(stopping.awaitingStop).toBe(true)
    expect(stopping).not.toHaveProperty('optimizationLevel')
  })

  it('preparing and cancellation carry iteration without an optimization level', () => {
    const preparing = nestUiPreparing('j1', 16, 3)
    const cancelled = nestUiCancelledPlain('j1', 'Stopped', preparing)

    expect(preparing.iteration).toBe(3)
    expect(preparing).not.toHaveProperty('optimizationLevel')
    expect(cancelled.iteration).toBe(3)
    expect(cancelled).not.toHaveProperty('optimizationLevel')
  })

  it('completed summary keeps card visible at 100%', () => {
    const ui = nestUiCompleted('j1', fakeResult(), { iteration: 3, isBest: true })
    expect(ui.visible).toBe(true)
    expect(ui.phase).toBe('completed')
    expect(ui.percent).toBe(100)
    expect(ui.iteration).toBe(3)
    expect(ui.isBest).toBe(true)
    expect(ui.summary?.placedCount).toBe(16)
    expect(ui.summary?.sheetCount).toBe(1)
    expect(ui.summary?.utilization).toBeCloseTo(0.42)
  })

  it('cancelled-with-best is not an error state', () => {
    const ui = nestUiCancelledBest('j1', fakeResult())
    expect(ui.phase).toBe('cancelled')
    expect(ui.title).toContain('en iyi sonuç')
    expect(ui.errorMessage).toBeUndefined()
    expect(ui.summary?.note).toContain('en iyi')
  })

  it('error state exposes message', () => {
    const ui = nestUiError('j1', 'Worker crashed')
    expect(ui.phase).toBe('error')
    expect(ui.errorMessage).toBe('Worker crashed')
  })

  it('isBetterNestResult uses the canonical result order', () => {
    const a = fakeResult({ wasteMm2: 50, utilization: 0.9 })
    const b = fakeResult({ wasteMm2: 200, utilization: 0.5 })
    expect(isBetterNestResult(a, b)).toBe(true)
    expect(isBetterNestResult(b, a)).toBe(false)

    const complete = fakeResult({
      statistics: {
        ...a.statistics,
        sheetCountUsed: 2,
      },
    })
    const partial = fakeResult({
      wasteMm2: 0,
      statistics: {
        ...a.statistics,
        placedCount: 15,
        unplacedCount: 1,
        sheetCountUsed: 1,
      },
    })
    expect(isBetterNestResult(complete, partial)).toBe(true)
  })
})
