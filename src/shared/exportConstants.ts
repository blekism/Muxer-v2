/** Copies generated per source video. */
export const MIN_COPIES = 1
export const MAX_COPIES = 10

/** Whole number in [MIN_COPIES, MAX_COPIES]; anything invalid becomes MIN_COPIES. */
export function clampCopies(value: number): number {
  if (!Number.isFinite(value)) return MIN_COPIES
  return Math.min(MAX_COPIES, Math.max(MIN_COPIES, Math.round(value)))
}
