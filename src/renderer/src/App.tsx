import { useCallback, useEffect, useState } from 'react'
import { Icon, type IconName } from './components/ui'
import { DownloaderPage } from './features/downloader/DownloaderPage'
import { EditorPage } from './features/editor/EditorPage'
import { useEditorSettings } from './features/editor/useEditorSettings'
import { LibraryPage } from './features/library/LibraryPage'
import { MOCK_DOWNLOADS } from './mock'
import type {
  CaptionPreset,
  DownloadItem,
  ExportProgress,
  MusicTrack,
  PhotoFolder,
  SourceVideo
} from './types'

type PageId = 'editor' | 'downloader' | 'library'

const NAV: readonly { id: PageId; label: string; icon: IconName }[] = [
  { id: 'editor', label: 'Editor', icon: 'film' },
  { id: 'downloader', label: 'Downloads', icon: 'download' },
  { id: 'library', label: 'Library', icon: 'grid' }
]

export default function App() {
  const [page, setPage] = useState<PageId>('editor')
  // Editor settings live here so they survive switching pages.
  const editor = useEditorSettings()

  const [sources, setSources] = useState<SourceVideo[]>([])
  const [photoFolder, setPhotoFolder] = useState<PhotoFolder | null>(null)
  const [presets, setPresets] = useState<CaptionPreset[]>([])
  const [music, setMusic] = useState<MusicTrack[]>([])
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [downloads, setDownloads] = useState<DownloadItem[]>(MOCK_DOWNLOADS)
  const isGenerating = exportProgress !== null

  useEffect(() => window.api.export.onProgress(setExportProgress), [])

  useEffect(() => {
    let disposed = false

    void window.api.library
      .load()
      .then((saved) => {
        if (disposed) return
        setPresets(saved.presets)
        setMusic(saved.music)
        setLibraryLoaded(true)
      })
      .catch((error) => {
        console.error('Unable to load editor library', error)
        if (!disposed) setLibraryLoaded(true)
      })

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    if (!libraryLoaded) return
    void window.api.library.save({ presets, music }).catch((error) => {
      console.error('Unable to save editor library', error)
    })
  }, [libraryLoaded, music, presets])

  const addDownloads = useCallback((urls: string[], mode: DownloadItem['mode']) => {
    const createdAt = Date.now()
    const items = urls.map<DownloadItem>((url) => ({
      id: crypto.randomUUID(),
      url,
      title: 'Fetching details…',
      mode,
      status: 'queued',
      progress: 0,
      createdAt
    }))
    setDownloads((prev) => [...items, ...prev])
    // TODO(ipc): window.api.downloads.start(urls) and update items from progress events.
  }, [])

  const generateVideos = async () => {
    if (sources.length === 0 || isGenerating) return

    setExportProgress({ completed: 0, total: sources.length, sourceName: 'Preparing export' })
    try {
      const result = await window.api.export.run({
        sources,
        sourceSettings: Object.fromEntries(
          sources.map((source) => [source.id, editor.getSourceSettings(source.id)])
        ),
        presets,
        music,
        photoFolderPath: photoFolder?.path ?? null,
        quality: editor.settings.quality
      })

      if (result) console.log('Exported videos', result.outputPaths)
    } catch (error) {
      console.error('Unable to export videos', error)
    } finally {
      setExportProgress(null)
    }
  }

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className="nav-item"
            aria-current={page === item.id ? 'page' : undefined}
            onClick={() => setPage(item.id)}
          >
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <main className="main">
        {page === 'editor' && (
          <EditorPage
            editor={editor}
            sources={sources}
            photoFolder={photoFolder}
            presets={presets}
            music={music}
            isGenerating={isGenerating}
            onPickPhotoFolder={async () => {
              try {
                setPhotoFolder(await window.api.photos.chooseFolder())
              } catch (error) {
                console.error('Unable to choose photo folder', error)
              }
            }}
            onImportVideos={async () => {
              try {
                const imported = await window.api.videos.import()
                setSources((prev) => [...prev, ...imported])
              } catch (error) {
                console.error('Unable to import videos', error)
              }
            }}
            onRemoveSource={(id) => setSources((prev) => prev.filter((s) => s.id !== id))}
            onAddPreset={(text) =>
              setPresets((prev) => [...prev, { id: crypto.randomUUID(), text }])
            }
            onDeletePreset={(id) => setPresets((prev) => prev.filter((p) => p.id !== id))}
            onImportMusic={async () => {
              try {
                const imported = await window.api.music.import()
                setMusic((prev) => [...prev, ...imported])
              } catch (error) {
                console.error('Unable to import music', error)
              }
            }}
            onRemoveMusic={(id) => setMusic((prev) => prev.filter((m) => m.id !== id))}
            onGenerate={generateVideos}
            onCancelExport={() => {
              void window.api.export.cancel()
            }}
          />
        )}
        {page === 'downloader' && (
          <DownloaderPage
            history={downloads}
            onDownloadSingle={(url) => addDownloads([url], 'single')}
            onDownloadBatch={(urls) => addDownloads(urls, 'batch')}
            onShowInFolder={() => {
              /* TODO(ipc): shell.showItemInFolder(path) */
            }}
            onRetry={(id) =>
              setDownloads((prev) =>
                prev.map((d) => (d.id === id ? { ...d, status: 'queued', progress: 0 } : d))
              )
            }
            onRemove={(id) => setDownloads((prev) => prev.filter((d) => d.id !== id))}
          />
        )}
        {page === 'library' && <LibraryPage videos={sources} />}
      </main>
    </div>
  )
}
