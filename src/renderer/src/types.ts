import type { ExportQuality, SourceEditSettings } from '../../shared/types'

export type {
  AudioSettings,
  CaptionPreset,
  DownloadItem,
  DownloadMode,
  DownloadStatus,
  ExportJob,
  ExportJobStatus,
  ExportQuality,
  HorizontalAlign,
  MusicTrack,
  FlashImage,
  FlashImageSelection,
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
  /** Every exported copy gets random video props; manual video edits are locked. */
  fullRandomize: boolean
  /** Outputs per source video. */
  copies: number
}
