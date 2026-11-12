import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
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

// Custom APIs for renderer
const api = {
  videos: {
    import: (): Promise<SourceVideo[]> => ipcRenderer.invoke('videos:import')
  },
  photos: {
    choose: (): Promise<FlashImageSelection | null> => ipcRenderer.invoke('photos:choose')
  },
  library: {
    load: (): Promise<SavedEditorLibrary> => ipcRenderer.invoke('library:load'),
    save: (library: SavedEditorLibrary): Promise<void> =>
      ipcRenderer.invoke('library:save', library)
  },
  session: {
    load: (): Promise<SavedEditorSession | null> => ipcRenderer.invoke('session:load'),
    save: (session: SavedEditorSession): Promise<void> =>
      ipcRenderer.invoke('session:save', session)
  },
  music: {
    import: (): Promise<MusicTrack[]> => ipcRenderer.invoke('music:import')
  },
  export: {
    run: (request: ExportRequest): Promise<ExportOutcome> =>
      ipcRenderer.invoke('export:run', request),
    cancel: (): Promise<void> => ipcRenderer.invoke('export:cancel'),
    show: (filePath: string): Promise<void> => ipcRenderer.invoke('export:show', filePath),
    onProgress: (listener: (progress: ExportProgress) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ExportProgress) =>
        listener(progress)
      ipcRenderer.on('export:progress', handler)
      return () => ipcRenderer.removeListener('export:progress', handler)
    }
  },
  files: {
    watch: (paths: string[]): Promise<void> => ipcRenderer.invoke('files:watch', paths),
    onStatus: (listener: (changes: Record<string, boolean>) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, changes: Record<string, boolean>): void =>
        listener(changes)
      ipcRenderer.on('files:status', handler)
      return () => ipcRenderer.removeListener('files:status', handler)
    }
  },
  downloads: {
    list: (): Promise<DownloadItem[]> => ipcRenderer.invoke('downloads:list'),
    start: (urls: string[], mode: DownloadMode): Promise<void> =>
      ipcRenderer.invoke('downloads:start', urls, mode),
    retry: (id: string): Promise<void> => ipcRenderer.invoke('downloads:retry', id),
    cancel: (id: string): Promise<void> => ipcRenderer.invoke('downloads:cancel', id),
    removeMany: (ids: string[]): Promise<boolean> =>
      ipcRenderer.invoke('downloads:remove-many', ids),
    show: (id: string): Promise<void> => ipcRenderer.invoke('downloads:show', id),
    getFolder: (): Promise<string> => ipcRenderer.invoke('downloads:get-folder'),
    chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('downloads:choose-folder'),
    onUpdate: (listener: (item: DownloadItem) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, item: DownloadItem): void =>
        listener(item)
      ipcRenderer.on('downloads:update', handler)
      return () => ipcRenderer.removeListener('downloads:update', handler)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
