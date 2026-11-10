import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { BrandMark, Icon, type IconName } from './components/ui'
import { DownloaderPage } from './features/downloader/DownloaderPage'
import { EditorPage } from './features/editor/EditorPage'
import { randomVideoProps, useEditorSettings } from './features/editor/useEditorSettings'
import { LibraryPage } from './features/library/LibraryPage'
import { fileName } from './lib/format'
import { MAX_FLASH_IMAGES } from '../../shared/flashConstants'
import type { CaptionPreset, DownloadItem, FlashImage, MusicTrack, SourceVideo } from './types'
import {
  ExportProgressPanel,
  type ExportPanelState,
  type ExportRunState
} from './components/ExportProgressPanel'

/** Ends a run: anything that never finished is marked so it doesn't look stuck. */
function finishPanel(
  panel: ExportPanelState | null,
  state: Exclude<ExportRunState, 'running'>
): ExportPanelState | null {
  if (!panel) return null
  const reason = state === 'cancelled' ? 'Cancelled' : 'Not exported'
  return {
    state,
    jobs: panel.jobs.map((job) =>
      job.status === 'queued' || job.status === 'rendering'
        ? { ...job, status: 'failed', error: reason }
        : job
    )
  }
}

type PageId = 'editor' | 'downloader' | 'library'

const NAV: readonly { id: PageId; label: string; icon: IconName }[] = [
  { id: 'editor', label: 'Editor', icon: 'film' },
  { id: 'downloader', label: 'Downloads', icon: 'download' },
  { id: 'library', label: 'Library', icon: 'grid' }
]

const SIDEBAR_KEY = 'sidebar-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

export default function App() {
  const [page, setPage] = useState<PageId>('editor')
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const toggleSidebar = (): void => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, prev ? '0' : '1')
      } catch {
        /* storage unavailable: the choice just won't persist */
      }
      return !prev
    })
  }
  // Editor settings live here so they survive switching pages.
  const editor = useEditorSettings()

  const [sources, setSources] = useState<SourceVideo[]>([])
  const [flashImages, setFlashImages] = useState<FlashImage[]>([])
  const [flashNotice, setFlashNotice] = useState<string | null>(null)
  const [presets, setPresets] = useState<CaptionPreset[]>([])
  const [music, setMusic] = useState<MusicTrack[]>([])
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  // Drives the bottom-right progress box; stays after the export ends until the user closes it.
  const [exportProgress, setExportProgress] = useState<ExportPanelState | null>(null)
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [downloadFolder, setDownloadFolder] = useState('')
  // Tracked separately from exportProgress: a late `export:progress` event can arrive after the
  // invoke reply (Electron doesn't order the two), which would otherwise re-enable "Generating…".
  const [isGenerating, setIsGenerating] = useState(false)
  const isGeneratingRef = useRef(false)
  const cancelRequestedRef = useRef(false)
  // Referenced files main reports as gone from disk (deleted or moved).
  const [missingPaths, setMissingPaths] = useState<ReadonlySet<string>>(() => new Set())
  // `missing` errors clear themselves once every referenced file is back or removed.
  const [exportError, setExportError] = useState<{ message: string; missing: boolean } | null>(null)

  const watchedPaths = useMemo(() => {
    const paths = new Set(sources.map((source) => source.sourcePath))
    if (libraryLoaded) for (const track of music) paths.add(track.sourcePath)
    for (const image of flashImages) paths.add(image.path)
    return [...paths].sort()
  }, [flashImages, libraryLoaded, music, sources])
  // Paths can't contain a newline, so this key changes only when the set does.
  const watchedKey = watchedPaths.join('\n')

  useEffect(
    () =>
      window.api.files.onStatus((changes) =>
        setMissingPaths((prev) => {
          const next = new Set(prev)
          for (const [path, exists] of Object.entries(changes)) {
            if (exists) next.delete(path)
            else next.add(path)
          }
          return next
        })
      ),
    []
  )

  useEffect(() => {
    // Main replies with the full status of this set, so stale entries for paths no longer
    // referenced are harmless: nothing looks them up.
    const paths = watchedKey ? watchedKey.split('\n') : []
    void window.api.files.watch(paths).catch((error) => {
      console.error('Unable to watch referenced files', error)
    })
  }, [watchedKey])

  /** Missing files the export would read: sources, music they use, the flash images. */
  const missingInputs = useMemo(() => {
    const inputs = new Set(sources.map((source) => source.sourcePath))
    for (const source of sources) {
      const musicId = editor.getSourceSettings(source.id).audio.musicId
      const track = music.find((m) => m.id === musicId)
      if (track) inputs.add(track.sourcePath)
    }
    for (const image of flashImages) inputs.add(image.path)
    return [...inputs].filter((path) => missingPaths.has(path))
  }, [editor, flashImages, missingPaths, music, sources])

  // A "missing files" error stops showing once every referenced file is back or removed.
  const visibleExportError =
    exportError && !(exportError.missing && missingInputs.length === 0) ? exportError.message : null

  useEffect(
    () =>
      window.api.export.onProgress((progress) => {
        // The first event arrives once a folder is chosen, so a cancelled dialog shows no box.
        if (isGeneratingRef.current) setExportProgress({ jobs: progress.jobs, state: 'running' })
      }),
    []
  )

  useEffect(() => {
    const unsubscribe = window.api.downloads.onUpdate((item) =>
      setDownloads((prev) => {
        const index = prev.findIndex((d) => d.id === item.id)
        // Append to match main's order; History sorts for display.
        if (index === -1) return [...prev, item]
        const next = prev.slice()
        next[index] = item
        return next
      })
    )
    void window.api.downloads.list().then(setDownloads)
    void window.api.downloads.getFolder().then(setDownloadFolder)
    return unsubscribe
  }, [])

  const removeDownloads = async (ids: string[]): Promise<boolean> => {
    try {
      const removed = await window.api.downloads.removeMany(ids)
      if (removed) setDownloads((prev) => prev.filter((d) => !ids.includes(d.id)))
      return removed
    } catch (error) {
      console.error('Unable to delete downloads', error)
      return false
    }
  }

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
    // Main emits `downloads:update` for each new item, which adds it to the list.
    void window.api.downloads.start(urls, mode).catch((error) => {
      console.error('Unable to start downloads', error)
    })
  }, [])

  const generateVideos = async () => {
    if (sources.length === 0 || isGeneratingRef.current) return

    const missingMessage = (paths: string[]) =>
      `Can't generate: ${paths.map(fileName).join(', ')} ${paths.length === 1 ? 'was' : 'were'} moved or deleted. Restore or remove ${paths.length === 1 ? 'it' : 'them'} first.`

    if (missingInputs.length > 0) {
      setExportError({ message: missingMessage(missingInputs), missing: true })
      return
    }
    setExportError(null)
    cancelRequestedRef.current = false

    isGeneratingRef.current = true
    setIsGenerating(true)
    const { copies, fullRandomize } = editor.settings
    const totalOutputs = sources.length * copies
    // A new export replaces the previous run's box.
    setExportProgress(null)
    let finalState: Exclude<ExportRunState, 'running'> = 'error'
    try {
      const result = await window.api.export.run({
        sources,
        sourceSettings: Object.fromEntries(
          sources.map((source) => [source.id, editor.getSourceSettings(source.id)])
        ),
        presets,
        music,
        flashImagePaths: flashImages.map((image) => image.path),
        quality: editor.settings.quality,
        copies,
        videoVariants: Object.fromEntries(
          sources.map((source) => {
            const { video } = editor.getSourceSettings(source.id)
            return [
              source.id,
              Array.from({ length: copies }, () => (fullRandomize ? randomVideoProps() : video))
            ]
          })
        )
      })

      if (result.kind === 'missing') {
        setExportError({ message: missingMessage(result.paths), missing: true })
      } else if (result.kind === 'done') {
        finalState = 'done'
        console.log('Exported videos', result.outputPaths)
        if (result.failures.length > 0) {
          setExportError({
            message: `Exported ${result.outputPaths.length} of ${totalOutputs}. Skipped ${result.failures
              .map((failure) => `${failure.sourceName} (${failure.error})`)
              .join('; ')}.`,
            missing: false
          })
        }
      }
    } catch (error) {
      console.error('Unable to export videos', error)
      if (cancelRequestedRef.current) {
        finalState = 'cancelled'
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      // ipcRenderer.invoke prefixes "Error invoking remote method 'export:run': Error: ".
      setExportError({
        message: `Export failed: ${message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`,
        missing: false
      })
    } finally {
      isGeneratingRef.current = false
      setIsGenerating(false)
      setExportProgress((panel) => finishPanel(panel, finalState))
    }
  }

  const cancelExport = (): void => {
    cancelRequestedRef.current = true
    void window.api.export.cancel()
  }

  return (
    <div className="shell">
      <TitleBar />
      <div className={collapsed ? 'app app--collapsed' : 'app'}>
        <nav className="sidebar" aria-label="Main">
          <div className="brand">
            <BrandMark />
            <span className="brand__name">Reelszer</span>
          </div>
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className="nav-item"
              data-tooltip={item.label}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => setPage(item.id)}
            >
              <Icon name={item.icon} size={20} />
              <span className="nav-item__label">{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            className="nav-item sidebar__toggle"
            data-tooltip="Expand sidebar"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            onClick={toggleSidebar}
          >
            <Icon name="chevron" size={20} />
            <span className="nav-item__label">Collapse</span>
          </button>
        </nav>

        <main className="main">
          {page === 'editor' && (
            <EditorPage
              editor={editor}
              sources={sources}
              flashImages={flashImages}
              flashNotice={flashNotice}
              presets={presets}
              music={music}
              isGenerating={isGenerating}
              missingPaths={missingPaths}
              exportError={visibleExportError}
              onPickFlashImages={async () => {
                try {
                  const selection = await window.api.photos.choose()
                  if (!selection) return
                  // Picks are added to the current images; already-picked files are skipped.
                  const existing = new Set(flashImages.map((image) => image.path))
                  const fresh = selection.images.filter((image) => !existing.has(image.path))
                  const added = fresh.slice(0, Math.max(0, MAX_FLASH_IMAGES - flashImages.length))
                  const duplicates = selection.images.length - fresh.length
                  setFlashImages([...flashImages, ...added])
                  setFlashNotice(
                    selection.pickedCount - duplicates > added.length
                      ? `The limit is ${MAX_FLASH_IMAGES} images, so ${selection.pickedCount - duplicates - added.length} weren't added. Remove one to add another.`
                      : null
                  )
                } catch (error) {
                  console.error('Unable to choose flash images', error)
                }
              }}
              onRemoveFlashImage={(id) => {
                // Only removed from the app; the file stays on disk.
                setFlashImages((prev) => prev.filter((image) => image.id !== id))
                setFlashNotice(null)
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
              onCancelExport={cancelExport}
            />
          )}
          {page === 'downloader' && (
            <DownloaderPage
              history={downloads}
              onDownloadSingle={(url) => addDownloads([url], 'single')}
              onDownloadBatch={(urls) => addDownloads(urls, 'batch')}
              onShowInFolder={(id) => void window.api.downloads.show(id)}
              onRetry={(id) => void window.api.downloads.retry(id)}
              onCancel={(id) => void window.api.downloads.cancel(id)}
              folder={downloadFolder}
              onChooseFolder={async () => {
                const folder = await window.api.downloads.chooseFolder()
                if (folder) setDownloadFolder(folder)
              }}
              onRemoveMany={removeDownloads}
            />
          )}
          {page === 'library' && <LibraryPage videos={sources} />}
        </main>
      </div>
      {exportProgress && (
        <ExportProgressPanel
          progress={exportProgress}
          onCancel={cancelExport}
          onClose={() => setExportProgress(null)}
          onShowFile={(filePath) => void window.api.export.show(filePath)}
        />
      )}
    </div>
  )
}
