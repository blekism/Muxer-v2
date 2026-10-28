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

export interface PhotoFolder {
  path: string
  images: { id: string; name: string; url: string }[]
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
}

export interface SavedEditorLibrary {
  presets: CaptionPreset[]
  music: MusicTrack[]
}

export type VerticalAlign = 'top' | 'center' | 'bottom'
export type HorizontalAlign = 'left' | 'center' | 'right'

export interface TextStyle {
  font: string
  size: number
  outline: number
  fill: string
  outlineColor: string
  vAlign: VerticalAlign
  hAlign: HorizontalAlign
}

export interface VideoProps {
  zoom: number
  rotation: number
  perspective: number
  trimStart: number
  temperature: number
  tint: number
  vignette: number
}

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
  photoFolderPath: string | null
  quality: ExportQuality
}

export interface ExportResult {
  outputPaths: string[]
}

export interface ExportProgress {
  completed: number
  total: number
  sourceName: string
}
