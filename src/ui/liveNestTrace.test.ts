import { describe, expect, it } from 'vitest'
import type { NestAttempt, NestingSuccess } from '../nesting'
import {
  appendLiveAttempts,
  applyLiveCommitted,
  pruneLiveAttempts,
  startLiveNestTrace,
} from './liveNestTrace'

const attempt = (sequence: number, sheetIndex = 0): NestAttempt => ({
  sequence,
  partId: `part-${sequence}`,
  sheetIndex,
  x: sequence,
  y: sequence,
  rotation: 0,
  verdict: sequence % 2 === 0 ? 'rejected' : 'accepted',
})

const committed: NestingSuccess = {
  status: 'ok',
  placements: [],
  sheets: [],
  unplacedPartIds: [],
  utilization: 0,
  wasteMm2: 0,
  calculationTimeMs: 0,
  statistics: {
    partCount: 0,
    placedCount: 0,
    unplacedCount: 0,
    sheetCountUsed: 0,
    totalPartAreaMm2: 0,
    totalSheetAreaMm2: 0,
    overallUtilization: 0,
    overallWasteMm2: 0,
  },
  engineId: 'test',
}

describe('live nest trace state', () => {
  it('starts empty for a job', () => {
    expect(startLiveNestTrace('job-1')).toEqual({
      jobId: 'job-1',
      trail: [],
      current: null,
      sheetIndex: 0,
      committed: null,
    })
  })

  it('appends matching batches in order and prunes expired trail entries', () => {
    const first = appendLiveAttempts(
      startLiveNestTrace('job-1'),
      { jobId: 'job-1', attempts: [attempt(0), attempt(1)] },
      100,
    )
    const next = appendLiveAttempts(
      first,
      { jobId: 'job-1', attempts: [attempt(2, 1)] },
      950,
    )

    expect(next?.trail.map(({ sequence }) => sequence)).toEqual([2])
    expect(next?.current?.sequence).toBe(2)
    expect(next?.sheetIndex).toBe(1)
  })

  it('expires the trail and current ghost without another batch', () => {
    const state = appendLiveAttempts(
      startLiveNestTrace('job-1'),
      { jobId: 'job-1', attempts: [attempt(0)] },
      100,
    )

    expect(pruneLiveAttempts(state, 901)).toMatchObject({
      trail: [],
      current: null,
    })
  })

  it('ignores stale job batches and committed snapshots', () => {
    const state = startLiveNestTrace('job-1')

    expect(
      appendLiveAttempts(
        state,
        { jobId: 'old', attempts: [attempt(0)] },
        0,
      ),
    ).toBe(state)
    expect(applyLiveCommitted(state, 'old', committed)).toBe(state)
  })

  it('retains only the matching canonical committed snapshot', () => {
    const state = startLiveNestTrace('job-1')
    expect(applyLiveCommitted(state, 'job-1', committed)?.committed).toBe(
      committed,
    )
  })
})
