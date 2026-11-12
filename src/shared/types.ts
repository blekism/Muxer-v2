export interface SourceVideo {
  id: string
  name: string
  sourcePath: string
  /** URL the <video> element can play. */
  previewUrl: string
  thumbnailUrl?: string
  sizeBytes: number
  durationSec: number
  width: number
  height: number
}

export interface FlashImage {
  id: string
  name: string
  path: string
  url: string
}

export interface FlashImageSelection {
  images: FlashImage[]
  /** How many image files were picked in the dialog. */
  pickedCount: number
}

export interface CaptionPreset {
  id: string
  text: string
}

export interface MusicTrack {
  id: string
  name: string
  sourcePath: string
  durationSec: number
  previewUrl?: string
}

export interface SavedEditorLibrary {
  presets: CaptionPreset[]
  music: MusicTrack[]
}

/** Work in progress restored on launch. `editor` is the renderer's EditorSettings; main stores it as-is. */
export interface SavedEditorSession {
  sources: SourceVideo[]
  /** The imported pool; only `selectedFlashImageIds` are flashed on export. */
  flashImages: FlashImage[]
  selectedFlashImageIds: string[]
  flashRepeats: number
  editor: unknown
}

export type VerticalAlign = 'top' | 'center' | 'bottom'
export type HorizontalAlign = 'left' | 'center' | 'right'

export type TextCase = 'none' | 'upper' | 'lower'

/** Center of the caption box as fractions (0-1) of the frame width and height. */
export interface TextPosition {
  x: number
  y: number
}

export interface TextStyle {
  font: string
  textCase: TextCase
  size: number
  outline: number
  fill: string
  outlineColor: string
  vAlign: VerticalAlign
  hAlign: HorizontalAlign
  /** Dragged position in the preview; overrides vAlign/hAlign. null = use the alignment. */
  position: TextPosition | null
}

export interface VideoProps {
  zoom: number
  rotation: number
  perspective: number
  trimStart: number
  temperature: number
  vignette: number
  /** Playback speed multiplier (setpts / atempo). */
  speed: number
  /** eq brightness offset, 0 = neutral. */
  brightness: number
  /** eq contrast, 1 = neutral. */
  contrast: number
  /** eq saturation, 1 = neutral. */
  saturation: number
  flip: boolean
}

export type NumericVideoKey = Exclude<keyof VideoProps, 'flip'>

export interface AudioSettings {
  originalEnabled: boolean
  musicId: string | null
}

export interface SourceEditSettings {
  text: TextStyle
  video: VideoProps
  audio: AudioSettings
  captionPresetId: string | null
}

export type ExportQuality = 'low' | 'medium' | 'high'

export interface ExportRequest {
  sources: SourceVideo[]
  sourceSettings: Record<string, SourceEditSettings>
  presets: CaptionPreset[]
  music: MusicTrack[]
  flashImagePaths: string[]
  /** Times each flash image appears per video, MIN_FLASH_REPEATS to MAX_FLASH_REPEATS. */
  flashRepeats: number
  quality: ExportQuality
  /** Outputs per source, 1 to MAX_COPIES. */
  copies: number
  /** Per source id: the video props for each copy (length = copies). */
  videoVariants: Record<string, VideoProps[]>
}

export interface ExportFailure {
  sourceId: string
  sourceName: string
  error: string
}

export interface ExportResult {
  outputPaths: string[]
  /** Sources skipped because one of their files disappeared during the export. */
  failures: ExportFailure[]
}

export type ExportOutcome =
  | { kind: 'cancelled' }
  /** Nothing was exported: these referenced files no longer exist. */
  | { kind: 'missing'; paths: string[] }
  | ({ kind: 'done' } & ExportResult)

export type ExportJobStatus = 'queued' | 'rendering' | 'done' | 'failed'

/** One output file of an export: one copy of one source video. */
export interface ExportJob {
  id: string
  /** Output file name, e.g. clip_edited_v2.mp4. */
  label: string
  status: ExportJobStatus
  /** 0 to 100. */
  percent: number
  /** Set once the file is written. */
  outputPath?: string
  error?: string
}

/** Full snapshot of every job, sent whole so out-of-order events can't corrupt it. */
export interface ExportProgress {
  jobs: ExportJob[]
}

export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'failed'
export type DownloadMode = 'single' | 'batch'

export interface DownloadItem {
  id: string
  url: string
  title: string
  mode: DownloadMode
  /** Shared by every item from one batch submission. */
  batchId?: string
  status: DownloadStatus
  /** 0 to 100, only meaningful while downloading. */
  progress: number
  sizeBytes?: number
  /** `media://` URL minted by main. */
  thumbnailUrl?: string
  error?: string
  createdAt: number
}