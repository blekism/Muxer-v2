import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { TitleBar } from './components/TitleBar'
import { BrandMark, Icon, type IconName } from './components/ui'
import { DownloaderPage } from './features/downloader/DownloaderPage'
import { EditorPage } from './features/editor/EditorPage'
import { randomVideoProps, useEditorSettings } from './features/editor/useEditorSettings'
import { LibraryPage } from './features/library/LibraryPage'
import { fileName, pluralize } from './lib/format'
import {
  MAX_FLASH_IMAGES,
  MAX_POOL_IMAGES,
  MIN_FLASH_REPEATS,
  clampFlashRepeats
} from '../../shared/flashConstants'
import type {
  CaptionPreset,
  DownloadItem,
  EditorSettings,
  FlashImage,
  MusicTrack,
  SourceVideo
} from './types'
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

/** Sources with any ready thumbnail filled in; the same array when nothing changed (no re-render). */
function withThumbnails(
  list: SourceVideo[],
  thumbnails: ReadonlyMap<string, string>
): SourceVideo[] {
  let changed = false
  const next = list.map((source) => {
    const thumbnailUrl = thumbnails.get(source.id)
    if (!thumbnailUrl || thumbnailUrl === source.thumbnailUrl) return source
    changed = true
    return { ...source, thumbnailUrl }
  })
  return changed ? next : list
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
  // Thumbnails main made in the background, by source id, not yet applied to `sources`. Kept until applied
  // because an event may arrive before the import/session reply that carries its source.
  const pendingThumbsRef = useRef(new Map<string, string>())
  const thumbFlushRef = useRef<number | null>(null)
  const importingRef = useRef(false)
  // The imported pool; only the selected ones are flashed on export.
  const [flashImages, setFlashImages] = useState<FlashImage[]>([])
  const [selectedFlashIds, setSelectedFlashIds] = useState<string[]>([])
  const [flashNotice, setFlashNotice] = useState<string | null>(null)
  const [flashRepeats, setFlashRepeats] = useState(MIN_FLASH_REPEATS)
  const [presets, setPresets] = useState<CaptionPreset[]>([])
  const [music, setMusic] = useState<MusicTrack[]>([])
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  // Nothing is saved until the previous session is restored, so it can't be overwritten.
  const [sessionLoaded, setSessionLoaded] = useState(false)
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
  const selectedFlashImages = useMemo(
    () => flashImages.filter((image) => selectedFlashIds.includes(image.id)),
    [flashImages, selectedFlashIds]
  )

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

  /** Missing files the export would read: sources, music they use, the selected flash images. */
  const missingInputs = useMemo(() => {
    const inputs = new Set(sources.map((source) => source.sourcePath))
    for (const source of sources) {
      const musicId = editor.getSourceSettings(source.id).audio.musicId
      const track = music.find((m) => m.id === musicId)
      if (track) inputs.add(track.sourcePath)
    }
    for (const image of selectedFlashImages) inputs.add(image.path)
    return [...inputs].filter((path) => missingPaths.has(path))
  }, [editor, selectedFlashImages, missingPaths, music, sources])

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

  const { hydrate, removeSources: removeSourceSettings } = editor.actions

  useEffect(() => {
    let disposed = false
    void window.api.session
      .load()
      .then((saved) => {
        if (disposed || !saved) return
        setSources(withThumbnails(saved.sources, pendingThumbsRef.current))
        setFlashImages(saved.flashImages)
        setSelectedFlashIds(saved.selectedFlashImageIds.slice(0, MAX_FLASH_IMAGES))
        setFlashRepeats(clampFlashRepeats(saved.flashRepeats || MIN_FLASH_REPEATS))
        if (saved.editor && typeof saved.editor === 'object') {
          hydrate(saved.editor as Partial<EditorSettings>)
        }
      })
      .catch((error) => console.error('Unable to load editor session', error))
      .finally(() => {
        if (!disposed) setSessionLoaded(true)
      })
    return () => {
      disposed = true
    }
  }, [hydrate])

  // Thumbnails arrive one by one from main; batch them so 100 imports cause a few renders, not 100.
  useEffect(() => {
    const unsubscribe = window.api.videos.onThumbnail(({ id, thumbnailUrl }) => {
      pendingThumbsRef.current.set(id, thumbnailUrl)
      if (thumbFlushRef.current !== null) return
      thumbFlushRef.current = window.setTimeout(() => {
        thumbFlushRef.current = null
        setSources((prev) => withThumbnails(prev, pendingThumbsRef.current))
      }, 150)
    })
    return () => {
      unsubscribe()
      if (thumbFlushRef.current !== null) window.clearTimeout(thumbFlushRef.current)
      thumbFlushRef.current = null
    }
  }, [])

  // Debounced: sliders change settings many times a second.
  useEffect(() => {
    if (!sessionLoaded) return
    const session = {
      sources,
      flashImages,
      selectedFlashImageIds: selectedFlashIds,
      flashRepeats,
      editor: editor.settings
    }
    const timer = window.setTimeout(() => {
      void window.api.session.save(session).catch((error) => {
        console.error('Unable to save editor session', error)
      })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [editor.settings, flashImages, flashRepeats, selectedFlashIds, sessionLoaded, sources])

  const removeSources = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      const removed = new Set(ids)
      for (const id of ids) pendingThumbsRef.current.delete(id)
      setSources((prev) => prev.filter((source) => !removed.has(source.id)))
      removeSourceSettings(ids)
    },
    [removeSourceSettings]
  )

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
        flashImagePaths: selectedFlashImages.map((image) => image.path),
        flashRepeats,
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
        // The batch is done: clear the sources that exported (failed ones stay to retry).
        // Flash images, music and presets are kept for the next batch.
        const failed = new Set(result.failures.map((failure) => failure.sourceId))
        removeSources(sources.filter((source) => !failed.has(source.id)).map((s) => s.id))
        if (result.failures.length > 0) {
          setExportError({
            message: `Exported ${result.outputPaths.length} of ${totalOutputs}. Skipped ${result.failures
              .map((failure) => `${failure.sourceName} (${failure.error})`)
              .join('; ')}.`,
            missing: false
          })
          toast.warning(
            `Exported ${result.outputPaths.length} of ${totalOutputs}. Some videos were skipped.`
          )
        } else {
          toast.success(`Exported ${pluralize(result.outputPaths.length, 'video')}.`)
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
      const cleaned = message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      setExportError({ message: `Export failed: ${cleaned}`, missing: false })
      toast.error(`Export failed: ${cleaned}`)
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
              selectedFlashIds={selectedFlashIds}
              flashNotice={flashNotice}
              flashRepeats={flashRepeats}
              onChangeFlashRepeats={(value) => setFlashRepeats(clampFlashRepeats(value))}
              presets={presets}
              music={music}
              isGenerating={isGenerating}
              missingPaths={missingPaths}
              exportError={visibleExportError}
              onPickFlashImages={async () => {
                try {
                  const selection = await window.api.photos.choose()
                  if (!selection) return
                  // Picks are added to the pool unselected; already-imported files are skipped.
                  const existing = new Set(flashImages.map((image) => image.path.toLowerCase()))
                  const fresh = selection.images.filter(
                    (image) => !existing.has(image.path.toLowerCase())
                  )
                  const duplicates = selection.images.length - fresh.length
                  // The pool holds at most MAX_POOL_IMAGES; extra picks are dropped.
                  const room = Math.max(0, MAX_POOL_IMAGES - flashImages.length)
                  const added = fresh.slice(0, room)
                  const overLimit = fresh.length - added.length
                  setFlashImages([...flashImages, ...added])
                  const notices = [
                    duplicates > 0
                      ? `${pluralize(duplicates, 'image')} already imported, skipped.`
                      : null,
                    overLimit > 0
                      ? `Limit is ${MAX_POOL_IMAGES} images, ${pluralize(overLimit, 'image')} not added.`
                      : null
                  ].filter(Boolean)
                  setFlashNotice(notices.length > 0 ? notices.join(' ') : null)
                } catch (error) {
                  console.error('Unable to choose flash images', error)
                  toast.error("Couldn't add flash images.")
                }
              }}
              onRemoveFlashImage={(id) => {
                // Only removed from the app; the file stays on disk.
                setFlashImages((prev) => prev.filter((image) => image.id !== id))
                setSelectedFlashIds((prev) => prev.filter((selected) => selected !== id))
                setFlashNotice(null)
              }}
              onToggleFlashImage={(id) =>
                // Single selection: clicking the selected image clears it, any other image replaces it.
                setSelectedFlashIds((prev) => (prev.includes(id) ? [] : [id]))
              }
              onImportVideos={async () => {
                // One import at a time; the file dialog isn't modal, so the button can be clicked again.
                if (importingRef.current) return
                importingRef.current = true
                let toastId: string | number | undefined
                const stopProgress = window.api.videos.onImportProgress(({ done, total }) => {
                  // Small imports finish too fast to need a progress toast.
                  if (total < 10) return
                  const message = `Importing videos… ${done} / ${total}`
                  toastId =
                    toastId === undefined
                      ? toast.loading(message)
                      : toast.loading(message, { id: toastId })
                })
                try {
                  const imported = await window.api.videos.import()
                  if (imported.length === 0) {
                    if (toastId !== undefined) toast.dismiss(toastId)
                    return
                  }
                  // Windows paths are case-insensitive; already-imported videos are skipped.
                  const existing = new Set(sources.map((s) => s.sourcePath.toLowerCase()))
                  const fresh = imported.filter((v) => !existing.has(v.sourcePath.toLowerCase()))
                  const duplicates = imported.filter((v) => !fresh.includes(v))
                  setSources((prev) => [
                    ...prev,
                    ...withThumbnails(fresh, pendingThumbsRef.current)
                  ])
                  if (toastId !== undefined) {
                    if (fresh.length > 0) {
                      toast.success(`Imported ${pluralize(fresh.length, 'video')}.`, {
                        id: toastId
                      })
                    } else {
                      toast.dismiss(toastId)
                    }
                  }
                  if (duplicates.length === 1) {
                    toast.warning(`${duplicates[0].name} is already imported.`)
                  } else if (duplicates.length > 1) {
                    toast.warning(
                      `${duplicates.length} videos were already imported and weren't added again.`
                    )
                  }
                } catch (error) {
                  console.error('Unable to import videos', error)
                  if (toastId !== undefined) {
                    toast.error("Couldn't import videos.", { id: toastId })
                  } else {
                    toast.error("Couldn't import videos.")
                  }
                } finally {
                  stopProgress()
                  importingRef.current = false
                }
              }}
              onRemoveSource={(id) => removeSources([id])}
              onRemoveAllSources={() => removeSources(sources.map((source) => source.id))}
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
                  toast.error("Couldn't import music.")
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
