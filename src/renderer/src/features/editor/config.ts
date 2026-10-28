import type {
  AudioSettings,
  EditorSettings,
  ExportQuality,
  SourceEditSettings,
  TextStyle,
  VideoProps
} from '../../types'

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
  /** Range used by "Randomize" so results stay watchable. */
  randomRange: readonly [number, number]
}

export const VIDEO_CONTROLS: readonly VideoControl[] = [
  {
    key: 'zoom',
    label: 'Zoom',
    min: 1.18,
    max: 1.06,
    step: 0.3,
    unit: '%',
    randomRange: [100, 115]
  },
  {
    key: 'rotation',
    label: 'Rotation',
    min: -1,
    max: 1,
    step: 0.1,
    unit: '°',
    randomRange: [-3, 3]
  },
  {
    key: 'perspective',
    label: 'Perspective',
    min: -0.005,
    max: 0.005,
    step: 0.001,
    unit: '',
    randomRange: [-8, 8]
  },
  {
    key: 'trimStart',
    label: 'Trim start',
    min: 0,
    max: 5,
    step: 0.1,
    unit: 's',
    randomRange: [0, 1]
  },
  {
    key: 'temperature',
    label: 'Color temperature',
    min: 4200,
    max: 6800,
    step: 1,
    unit: '',
    randomRange: [-20, 20]
  },

  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, unit: '', randomRange: [-15, 15] },
  { key: 'vignette', label: 'Vignette', min: 0, max: 100, step: 1, unit: '%', randomRange: [0, 40] }
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

export const DEFAULT_VIDEO: VideoProps = {
  zoom: 100,
  rotation: 0,
  perspective: 0,
  trimStart: 0,
  temperature: 0,
  tint: 0,
  vignette: 0
}

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
  activeSourceId: null
}
