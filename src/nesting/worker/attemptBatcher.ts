import type { NestAttempt } from '../types'

export function createAttemptBatcher(
  emit: (attempts: NestAttempt[]) => void,
  { maxSize = 256 }: { maxSize?: number } = {},
) {
  let pending: NestAttempt[] = []

  const flush = () => {
    if (pending.length === 0) return
    const batch = pending
    pending = []
    try {
      emit(batch)
    } catch {
      // Debug transport must never alter nesting.
    }
  }

  return {
    push(attempt: NestAttempt) {
      pending.push(attempt)
      if (pending.length >= maxSize) flush()
    },
    flush,
  }
}
