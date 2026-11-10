import type {
  AudioSettings,
  EditorSettings,
  ExportQuality,
  SourceEditSettings,
  TextStyle,
  VideoProps
} from '../../types'
import { MAX_COPIES, MIN_COPIES } from '../../../../shared/exportConstants'
import {
  TEMPERATURE_KELVIN,
  TEMPERATURE_MIX,
  TINT_MAX,
  VIGNETTE_MAX_ANGLE
} from '../../../../shared/colorConstants'

/** These families must be installed or bundled with the app (and FFmpeg needs the font files too). */
export const FONT_OPTIONS = [
  'Montserrat',
  'Poppins',
  'Inter',
  'Oswald',
  'Anton',
  'Bebas Neue',
  'Roboto',
  'Arial Black'
] as const

export const fontStack = (font: string) => `"${font}", system-ui, sans-serif`

export const TEXT_SWATCHES = [
  '#ffffff',
  '#000000',
  '#ffe14d',
  '#ff5c7a',
  '#4dd2ff',
  '#7cff6b'
] as const

export const QUALITY_OPTIONS: readonly { value: ExportQuality; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }
]

export interface VideoControl {
  key: keyof VideoProps
  label: string
  min: number
  max: number
  step: number
  unit: string
  /** Value that means "no change": the default, and the 0 point when normalizing for the preview. */
  neutral: number
  /** Range used by "Randomize". Same units as `min`/`max`. */
  randomRange: readonly [number, number]
  /**
   * Slider scale shown to the user. `min`/`max` (FFmpeg units) map linearly onto it, and state keeps the FFmpeg
   * value. When set, `format` receives the displayed value.
   */
  display?: { min: number; max: number }
  /** Readout next to the slider. Falls back to value + unit. */
  format?: (value: number) => string
}

/** FFmpeg value -> the number the slider shows. */
export function toDisplay(control: VideoControl, native: number): number {
  if (!control.display) return native
  const { min, max } = control.display
  return min + ((native - control.min) / (control.max - control.min)) * (max - min)
}

/** Number the slider shows -> FFmpeg value. Not snapped to `step`, so a display step of 1 stays exact. */
export function fromDisplay(control: VideoControl, shown: number): number {
  if (!control.display) return shown
  const { min, max } = control.display
  const native = control.min + ((shown - min) / (max - min)) * (control.max - control.min)
  return Number(native.toFixed(6))
}

const PERCENT_SCALE = { min: 0, max: 100 } as const
const formatShown = (value: number): string => `${Math.round(value)}`

export { TEMPERATURE_KELVIN, TEMPERATURE_MIX, TINT_MAX, VIGNETTE_MAX_ANGLE }
export { MAX_COPIES, MIN_COPIES }

/**
 * Every value below is stored in the units FFmpeg receives, so export.ts can use it as-is.
 * Anything the CSS preview can't use directly is converted in previewMath.ts (never here, never in export).
 */
export const PERSPECTIVE_MAX = 0.005

export const VIDEO_CONTROLS: readonly VideoControl[] = [
  {
    key: 'zoom',
    label: 'Zoom',
    min: 1,
    max: 1.18,
    step: 0.01,
    unit: '×',
    neutral: 1,
    randomRange: [1.06, 1.18],
    format: (value) => `${value.toFixed(2)}×`
  },
  {
    key: 'rotation',
    label: 'Rotation',
    min: -1,
    max: 1,
    step: 0.1,
    unit: '°',
    neutral: 0,
    randomRange: [-1, 1],
    format: (value) => `${value.toFixed(1)}°`
  },
  {
    key: 'perspective',
    label: 'Perspective',
    min: -PERSPECTIVE_MAX,
    max: PERSPECTIVE_MAX,
    step: 0.001,
    unit: '',
    neutral: 0,
    randomRange: [-PERSPECTIVE_MAX, PERSPECTIVE_MAX],
    format: (value) => `${(value * 100).toFixed(1)}%`
  },
  {
    key: 'trimStart',
    label: 'Trim start',
    min: 0,
    max: 5,
    step: 0.1,
    unit: 's',
    neutral: 0,
    randomRange: [0, 1],
    format: (value) => `${value.toFixed(1)}s`
  },
  {
    key: 'temperature',
    // 0 = 4200K (warm), 100 = 6800K (slightly cool). Neutral 6500K shows as about 88.
    label: 'Color temperature (warm → cool)',
    min: TEMPERATURE_KELVIN.min,
    max: TEMPERATURE_KELVIN.max,
    step: 1,
    unit: 'K',
    neutral: TEMPERATURE_KELVIN.neutral,
    randomRange: [TEMPERATURE_KELVIN.min, TEMPERATURE_KELVIN.max],
    display: PERCENT_SCALE,
    format: formatShown
  },
  {
    // 0 = magenta (-0.025), 50 = neutral, 100 = green (+0.025).
    key: 'tint',
    label: 'Tint (magenta → green)',
    min: -TINT_MAX,
    max: TINT_MAX,
    step: 0.0005,
    unit: '',
    neutral: 0,
    randomRange: [-TINT_MAX, TINT_MAX],
    display: PERCENT_SCALE,
    format: formatShown
  },
  {
    // 0 = off, 100 = 0.2 rad.
    key: 'vignette',
    label: 'Vignette',
    min: 0,
    max: VIGNETTE_MAX_ANGLE,
    step: 0.002,
    unit: '',
    neutral: 0,
    randomRange: [0.1, VIGNETTE_MAX_ANGLE],
    display: PERCENT_SCALE,
    format: formatShown
  }
]

export const DEFAULT_TEXT: TextStyle = {
  font: 'Montserrat',
  size: 56,
  outline: 4,
  fill: '#ffffff',
  outlineColor: '#000000',
  vAlign: 'bottom',
  hAlign: 'center'
}

/** Derived from the controls so defaults can never drift from the neutral values. */
export const DEFAULT_VIDEO = Object.fromEntries(
  VIDEO_CONTROLS.map((control) => [control.key, control.neutral])
) as unknown as VideoProps

export const DEFAULT_AUDIO: AudioSettings = {
  originalEnabled: true,
  musicId: null
}

export const INITIAL_SOURCE_SETTINGS: SourceEditSettings = {
  text: DEFAULT_TEXT,
  video: DEFAULT_VIDEO,
  audio: DEFAULT_AUDIO,
  captionPresetId: null
}

export const INITIAL_SETTINGS: EditorSettings = {
  sourceSettings: {},
  quality: 'high',
  activeSourceId: null,
  fullRandomize: false,
  copies: 1
}
