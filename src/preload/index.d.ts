import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  DownloadItem,
  DownloadMode,
  ExportProgress,
  ExportRequest,
  ExportResult,
  MusicTrack,
  PhotoFolder,
  SavedEditorLibrary,
  SourceVideo
} from '../shared/types'

interface AppApi {
  videos: {
    import: () => Promise<SourceVideo[]>
  }
  photos: {
    chooseFolder: () => Promise<PhotoFolder | null>
  }
  library: {
    load: () => Promise<SavedEditorLibrary>
    save: (library: SavedEditorLibrary) => Promise<void>
  }
  music: {
    import: () => Promise<MusicTrack[]>
  }
  export: {
    run: (request: ExportRequest) => Promise<ExportResult | null>
    cancel: () => Promise<void>
    onProgress: (listener: (progress: ExportProgress) => void) => () => void
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
