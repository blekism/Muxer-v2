/** Most pool images that can be selected for flashing. Each flashes `flashRepeats` times per video. */
export const MAX_FLASH_IMAGES = 5

/** Times each flash image appears per video. */
export const MIN_FLASH_REPEATS = 1
export const MAX_FLASH_REPEATS = 10

/** Whole number in [MIN_FLASH_REPEATS, MAX_FLASH_REPEATS]; anything invalid becomes MIN_FLASH_REPEATS. */
export function clampFlashRepeats(value: number): number {
  if (!Number.isFinite(value)) return MIN_FLASH_REPEATS
  return Math.min(MAX_FLASH_REPEATS, Math.max(MIN_FLASH_REPEATS, Math.round(value)))
}
