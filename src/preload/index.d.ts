import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  DownloadItem,
  DownloadMode,
  ExportProgress,
  ExportOutcome,
  ExportRequest,
  MusicTrack,
  FlashImageSelection,
  SavedEditorLibrary,
  SavedEditorSession,
  SourceVideo
} from '../shared/types'

interface AppApi {
  videos: {
    import: () => Promise<SourceVideo[]>
  }
  photos: {
    choose: () => Promise<FlashImageSelection | null>
  }
  library: {
    load: () => Promise<SavedEditorLibrary>
    save: (library: SavedEditorLibrary) => Promise<void>
  }
  session: {
    /** The last editing session (sources, flash images, editor settings), or null. */
    load: () => Promise<SavedEditorSession | null>
    save: (session: SavedEditorSession) => Promise<void>
  }
  music: {
    import: () => Promise<MusicTrack[]>
  }
  export: {
    run: (request: ExportRequest) => Promise<ExportOutcome>
    cancel: () => Promise<void>
    /** Reveals an exported file in Explorer. Only paths written by an export are accepted. */
    show: (filePath: string) => Promise<void>
    onProgress: (listener: (progress: ExportProgress) => void) => () => void
  }
  files: {
    /** Replaces the set of paths main watches; changes arrive through onStatus. */
    watch: (paths: string[]) => Promise<void>
    /** Maps path -> exists for every path whose presence changed. */
    onStatus: (listener: (changes: Record<string, boolean>) => void) => () => void
  }
  downloads: {
    list: () => Promise<DownloadItem[]>
    start: (urls: string[], mode: DownloadMode) => Promise<void>
    retry: (id: string) => Promise<void>
    cancel: (id: string) => Promise<void>
    removeMany: (ids: string[]) => Promise<boolean>
    show: (id: string) => Promise<void>
    getFolder: () => Promise<string>
    chooseFolder: () => Promise<string | null>
    onUpdate: (listener: (item: DownloadItem) => void) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppApi
  }
}
