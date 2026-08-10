import { defaultNestingEngine, type NestingRunOptions } from './engine'
import { nestInputToRequest } from './request'
import type { NestInput, NestingResult } from './types'

/** Primary UI façade — real BLF nesting via NestingEngine. */
export async function nestAsync(
  input: NestInput,
  options?: NestingRunOptions,
): Promise<NestingResult> {
  return defaultNestingEngine.nest(nestInputToRequest(input), options)
}

/** @deprecated Use nestAsync — kept name for call-site migration. */
export async function nest(
  input: NestInput,
  options?: NestingRunOptions,
): Promise<NestingResult> {
  return nestAsync(input, options)
}
