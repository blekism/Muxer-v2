import { ElectronAPI } from '@electron-toolkit/preload'
import type {
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
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppApi
  }
}
