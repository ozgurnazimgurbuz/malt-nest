import { describe, expect, it } from 'vitest'
import type { NestAttempt } from '../types'
import { createAttemptBatcher } from './attemptBatcher'

const attempt = (sequence: number): NestAttempt => ({
  sequence,
  partId: `part-${sequence}`,
  sheetIndex: 0,
  x: sequence,
  y: 0,
  rotation: 0,
  verdict: sequence % 2 === 0 ? 'rejected' : 'accepted',
})

describe('createAttemptBatcher', () => {
  it('preserves order and flushes the final partial batch', () => {
    const batches: NestAttempt[][] = []
    const batcher = createAttemptBatcher(
      (attempts) => batches.push(attempts),
      { maxSize: 2 },
    )

    batcher.push(attempt(0))
    batcher.push(attempt(1))
    batcher.push(attempt(2))
    batcher.flush()

    expect(batches.flat().map(({ sequence }) => sequence)).toEqual([0, 1, 2])
    expect(batches.every((batch) => batch.length <= 2)).toBe(true)
  })

  it('does not propagate transport failures', () => {
    const batcher = createAttemptBatcher(() => {
      throw new Error('post failed')
    })

    expect(() => {
      batcher.push(attempt(0))
      batcher.flush()
    }).not.toThrow()
  })
})
