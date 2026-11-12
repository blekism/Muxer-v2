import type { ExportQuality, SourceEditSettings, TextStyle } from '../../shared/types'

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
  NumericVideoKey,
  FlashImage,
  FlashImageSelection,
  SavedEditorLibrary,
  SourceEditSettings,
  SourceVideo,
  TextCase,
  TextPosition,
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
  /** Caption style and position are shared by every video (caption text stays per video). */
  syncText: boolean
  /** The style every video uses while `syncText` is on; also the default for videos never edited. */
  sharedText: TextStyle
  /** Every video uses the same caption text (preset). */
  syncCaption: boolean
  /** The preset every video uses while `syncCaption` is on; also the default for videos never edited. */
  sharedCaptionPresetId: string | null
}
