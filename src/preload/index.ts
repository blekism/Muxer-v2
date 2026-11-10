import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
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

// Custom APIs for renderer
const api = {
  videos: {
    import: (): Promise<SourceVideo[]> => ipcRenderer.invoke('videos:import')
  },
  photos: {
    chooseFolder: (): Promise<PhotoFolder | null> => ipcRenderer.invoke('photos:choose-folder')
  },
  library: {
    load: (): Promise<SavedEditorLibrary> => ipcRenderer.invoke('library:load'),
    save: (library: SavedEditorLibrary): Promise<void> =>
      ipcRenderer.invoke('library:save', library)
  },
  music: {
    import: (): Promise<MusicTrack[]> => ipcRenderer.invoke('music:import')
  },
  export: {
    run: (request: ExportRequest): Promise<ExportResult | null> =>
      ipcRenderer.invoke('export:run', request),
    cancel: (): Promise<void> => ipcRenderer.invoke('export:cancel'),
    onProgress: (listener: (progress: ExportProgress) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ExportProgress) =>
        listener(progress)
      ipcRenderer.on('export:progress', handler)
      return () => ipcRenderer.removeListener('export:progress', handler)
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
