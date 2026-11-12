import type {
  AudioSettings,
  EditorSettings,
  ExportQuality,
  NumericVideoKey,
  SourceEditSettings,
  TextCase,
  TextStyle,
  VideoProps
} from '../../types'
import { MAX_COPIES, MIN_COPIES } from '../../../../shared/exportConstants'
import { DEFAULT_FONT_ID, getFont } from '../../../../shared/fonts'
import {
  TEMPERATURE_KELVIN,
  TEMPERATURE_MIX,
  VIGNETTE_MAX_ANGLE
} from '../../../../shared/colorConstants'

/** CSS for a font id; the font files are shared with the FFmpeg export (see shared/fonts.ts). */
export const fontStyle = (id: string): { fontFamily: string; fontWeight: number } => {
  const font = getFont(id)
  return { fontFamily: `"${font.family}", system-ui, sans-serif`, fontWeight: font.weight }
}

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

export type VideoControlGroup = 'transform' | 'color'

export const VIDEO_CONTROL_GROUPS: readonly { id: VideoControlGroup; label: string }[] = [
  { id: 'transform', label: 'Transform' },
  { id: 'color', label: 'Color' }
]

export interface VideoControl {
  key: NumericVideoKey
  group: VideoControlGroup
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
const SIGNED_SCALE = { min: -100, max: 100 } as const
const formatShown = (value: number): string => `${Math.round(value)}`
const formatSigned = (value: number): string => {
  const rounded = Math.round(value)
  return rounded > 0 ? `+${rounded}` : `${rounded}`
}
const formatPercent = (value: number): string => `${Math.round(value * 100)}%`

export { TEMPERATURE_KELVIN, TEMPERATURE_MIX, VIGNETTE_MAX_ANGLE }
export { MAX_COPIES, MIN_COPIES }

/**
 * Every value below is stored in the units FFmpeg receives, so export.ts can use it as-is.
 * Anything the CSS preview can't use directly is converted in previewMath.ts (never here, never in export).
 */
export const PERSPECTIVE_MAX = 0.005

export const VIDEO_CONTROLS: readonly VideoControl[] = [
  {
    key: 'speed',
    group: 'transform',
    label: 'Speed',
    min: 0.97,
    max: 1.03,
    step: 0.005,
    unit: '×',
    neutral: 1,
    randomRange: [0.97, 1.03],
    format: (value) => `${value.toFixed(3)}×`
  },
  {
    key: 'zoom',
    group: 'transform',
    label: 'Zoom',
    min: 1,
    max: 1.07,
    step: 0.01,
    unit: '×',
    neutral: 1,
    randomRange: [1.02, 1.07],
    format: (value) => `${value.toFixed(2)}×`
  },
  {
    key: 'rotation',
    group: 'transform',
    label: 'Rotation',
    min: -3,
    max: 3,
    step: 0.1,
    unit: '°',
    neutral: 0,
    randomRange: [-3, 3],
    format: (value) => `${value.toFixed(1)}°`
  },
  {
    key: 'perspective',
    group: 'transform',
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
    group: 'transform',
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
    // eq brightness offset. -100 = -0.025, 0 = neutral, +100 = +0.025.
    key: 'brightness',
    group: 'color',
    label: 'Brightness',
    min: -0.025,
    max: 0.025,
    step: 0.001,
    unit: '',
    neutral: 0,
    randomRange: [-0.025, 0.025],
    display: SIGNED_SCALE,
    format: formatSigned
  },
  {
    key: 'contrast',
    group: 'color',
    label: 'Contrast',
    min: 0.96,
    max: 1.04,
    step: 0.002,
    unit: '',
    neutral: 1,
    randomRange: [0.98, 1.04],
    format: formatPercent
  },
  {
    key: 'saturation',
    group: 'color',
    label: 'Saturation',
    min: 0.94,
    max: 1.06,
    step: 0.002,
    unit: '',
    neutral: 1,
    randomRange: [0.96, 1.06],
    format: formatPercent
  },
  {
    key: 'temperature',
    group: 'color',
    // 0 = 5100K (warm), 100 = 6500K (neutral, no change).
    label: 'Color temperature (warm → cool)',
    min: TEMPERATURE_KELVIN.min,
    max: TEMPERATURE_KELVIN.max,
    step: 1,
    unit: 'K',
    neutral: TEMPERATURE_KELVIN.neutral,
    randomRange: [5100, 5900],
    display: PERCENT_SCALE,
    format: formatShown
  },
  {
    // 0 = off, 100 = 0.08 rad.
    key: 'vignette',
    group: 'color',
    label: 'Vignette',
    min: 0,
    max: VIGNETTE_MAX_ANGLE,
    step: 0.001,
    unit: '',
    neutral: 0,
    randomRange: [0.02, VIGNETTE_MAX_ANGLE],
    display: PERCENT_SCALE,
    format: formatShown
  }
]

export const TEXT_CASE_OPTIONS: readonly { value: TextCase; label: string }[] = [
  { value: 'none', label: 'As typed' },
  { value: 'upper', label: 'UPPERCASE' },
  { value: 'lower', label: 'lowercase' }
]

export const DEFAULT_TEXT: TextStyle = {
  font: DEFAULT_FONT_ID,
  textCase: 'none',
  size: 56,
  outline: 4,
  fill: '#ffffff',
  outlineColor: '#000000',
  vAlign: 'bottom',
  hAlign: 'center',
  position: null
}

/** Derived from the controls so defaults can never drift from the neutral values. */
export const DEFAULT_VIDEO = {
  ...Object.fromEntries(VIDEO_CONTROLS.map((control) => [control.key, control.neutral])),
  flip: false
} as unknown as VideoProps

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
  copies: 1,
  syncText: false,
  sharedText: DEFAULT_TEXT,
  syncCaption: false,
  sharedCaptionPresetId: null
}
