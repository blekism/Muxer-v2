import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
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
