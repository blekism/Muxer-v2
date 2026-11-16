/** Only one pool image can be selected for flashing. It flashes `flashRepeats` times per video. */
export const MAX_FLASH_IMAGES = 1

/** Most images that can be imported into the flash image pool. */
export const MAX_POOL_IMAGES = 100

/** Times each flash image appears per video. */
export const MIN_FLASH_REPEATS = 1
export const MAX_FLASH_REPEATS = 10

/** Whole number in [MIN_FLASH_REPEATS, MAX_FLASH_REPEATS]; anything invalid becomes MIN_FLASH_REPEATS. */
export function clampFlashRepeats(value: number): number {
  if (!Number.isFinite(value)) return MIN_FLASH_REPEATS
  return Math.min(MAX_FLASH_REPEATS, Math.max(MIN_FLASH_REPEATS, Math.round(value)))
}
