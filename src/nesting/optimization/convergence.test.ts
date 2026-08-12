import { describe, expect, it } from 'vitest'
import {
  createConvergenceState,
  markRequiredOrdersComplete,
  recordChampion,
  recordEvaluation,
  recordFirstChampion,
  shouldStop,
} from './convergence'

describe('convergence policy', () => {
  it('sets a benchmark-derived minimum evaluation limit of 640', () => {
    expect(
      createConvergenceState({
        partCount: 10,
        deterministic: true,
        startedAtMs: 0,
      }).evaluationLimit,
    ).toBe(640)
  })

  it('scales the evaluation limit with part count', () => {
    expect(
      createConvergenceState({
        partCount: 200,
        deterministic: true,
        startedAtMs: 0,
      }).evaluationLimit,
    ).toBe(800)
  })

  it('rejects invalid part counts', () => {
    for (const partCount of [-1, 1.5, Infinity]) {
      expect(() =>
        createConvergenceState({ partCount, deterministic: true, startedAtMs: 0 }),
      ).toThrow(RangeError)
    }
  })

  it('rejects non-finite start times', () => {
    for (const startedAtMs of [NaN, Infinity, -Infinity]) {
      expect(() =>
        createConvergenceState({ partCount: 0, deterministic: true, startedAtMs }),
      ).toThrow(RangeError)
    }
  })

  it('stops immediately when aborted', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: true,
      startedAtMs: 0,
    })

    expect(shouldStop(state, 0, true)).toBe(true)
  })

  it('ignores clocks in deterministic mode before required orders complete', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: true,
      startedAtMs: 0,
    })
    recordFirstChampion(state, 40)

    expect(shouldStop(state, 140, false)).toBe(false)
    expect(shouldStop(state, 5_000, false)).toBe(false)
  })

  it('stops deterministically at the post-order non-improvement limit without a clock', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: true,
      startedAtMs: 0,
    })
    for (let i = 0; i < state.evaluationLimit; i++) recordEvaluation(state)

    expect(shouldStop(state, 0, false)).toBe(false)
    markRequiredOrdersComplete(state)
    for (let i = 0; i < state.evaluationLimit; i++) recordEvaluation(state)
    expect(shouldStop(state, 0, false)).toBe(true)
  })

  it('does not stop for champion-relative stagnation gaps', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: false,
      startedAtMs: 0,
    })
    recordFirstChampion(state, 40)

    expect(shouldStop(state, 6_999, false)).toBe(false)
  })

  it('applies the seven-second ceiling after the first champion', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: false,
      startedAtMs: 0,
    })
    recordFirstChampion(state, 40)
    expect(shouldStop(state, 7_039, false)).toBe(false)
    expect(shouldStop(state, 7_040, false)).toBe(true)
  })

  it('records improvements without replacing the seed timestamp or total evaluations', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: false,
      startedAtMs: 0,
    })
    recordFirstChampion(state, 40)
    recordFirstChampion(state, 50)
    recordEvaluation(state)
    recordEvaluation(state)
    recordChampion(state, 90)

    expect(state.firstChampionMs).toBe(40)
    expect(state.lastImprovementMs).toBe(90)
    expect(state.evaluations).toBe(2)
    expect(state.evaluationsSinceImprovement).toBe(0)
  })

  it('resets the count when mandatory orders complete', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: true,
      startedAtMs: 0,
    })
    recordEvaluation(state)

    markRequiredOrdersComplete(state)

    expect(state.requiredOrdersComplete).toBe(true)
    expect(state.evaluationsSinceImprovement).toBe(0)
  })

  it('does not start the safety ceiling before a champion exists', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: false,
      startedAtMs: 100,
    })

    expect(shouldStop(state, 100_000, false)).toBe(false)
  })

  it('stops non-deterministically at the post-order count limit boundary', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: false,
      startedAtMs: 0,
    })
    recordFirstChampion(state, 0)
    markRequiredOrdersComplete(state)
    for (let i = 0; i < state.evaluationLimit - 1; i++) recordEvaluation(state)

    expect(shouldStop(state, 0, false)).toBe(false)

    recordEvaluation(state)
    expect(shouldStop(state, 0, false)).toBe(true)
  })

  it('does not time-stop without a champion', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: false,
      startedAtMs: 0,
    })

    expect(shouldStop(state, 100_000, false)).toBe(false)
  })

  it('does not stop on the count limit without a champion', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: false,
      startedAtMs: 0,
    })
    markRequiredOrdersComplete(state)
    for (let i = 0; i < state.evaluationLimit; i++) recordEvaluation(state)

    expect(shouldStop(state, 0, false)).toBe(false)
  })
})
