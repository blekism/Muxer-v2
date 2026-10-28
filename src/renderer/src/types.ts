import type { ExportQuality, SourceEditSettings } from '../../shared/types'

export type {
  AudioSettings,
  CaptionPreset,
  ExportQuality,
  HorizontalAlign,
  MusicTrack,
  PhotoFolder,
  SavedEditorLibrary,
  SourceEditSettings,
  SourceVideo,
  TextStyle,
  VerticalAlign,
  VideoProps
} from '../../shared/types'

export interface EditorSettings {
  sourceSettings: Record<string, SourceEditSettings>
  quality: ExportQuality
  activeSourceId: string | null
}

export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'failed'
export type DownloadMode = 'single' | 'batch'

export interface DownloadItem {
  id: string
  url: string
  title: string
  mode: DownloadMode
  status: DownloadStatus
  /** 0 to 100, only meaningful while downloading. */
  progress: number
  sizeBytes?: number
  thumbnailUrl?: string
  createdAt: number
}
