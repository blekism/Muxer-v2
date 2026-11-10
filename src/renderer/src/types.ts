import type { ExportQuality, SourceEditSettings } from '../../shared/types'

export type {
  AudioSettings,
  CaptionPreset,
  DownloadItem,
  DownloadMode,
  DownloadStatus,
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
