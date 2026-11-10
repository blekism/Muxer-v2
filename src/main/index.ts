import { app, shell, BrowserWindow, dialog, ipcMain, protocol, screen } from 'electron'
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'path'
import { basename, extname } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { Stats } from 'node:fs'
import type {
  DownloadMode,
  ExportOutcome,
  ExportRequest,
  MusicTrack,
  FlashImageSelection,
  SavedEditorLibrary,
  SourceVideo
} from '../shared/types'
import {
  autoUpdateYtDlp,
  cancelDownload,
  chooseDownloadFolder,
  getDownloadFolder,
  initDownloads,
  listDownloads,
  removeDownloads,
  retryDownload,
  showDownload,
  startDownloads
} from './download'
import { exportVideos, findMissingInputs, showExportedFile } from './export'
import { MAX_FLASH_IMAGES } from '../shared/flashConstants'
import { initFileWatch, recheckWatchedPaths, setWatchedPaths } from './fileWatch'
import { ffprobePath } from './utils/ffpaths'
import { testFFmpeg } from './utils/test-ffpaths'

const runFile = promisify(execFile)
const mediaPaths = new Map<string, string>()
let activeExportController: AbortController | null = null
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const audioExtensions = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'])

const emptyLibrary: SavedEditorLibrary = { presets: [], music: [] }

function libraryFilePath(): string {
  return join(app.getPath('userData'), 'editor-library.json')
}

async function loadLibrary(): Promise<SavedEditorLibrary> {
  try {
    const raw = await readFile(libraryFilePath(), 'utf8')
    const saved = JSON.parse(raw) as Partial<SavedEditorLibrary>
    return {
      presets: Array.isArray(saved.presets) ? saved.presets : [],
      music: Array.isArray(saved.music)
        ? saved.music.map((track) => ({ ...track, previewUrl: createMediaUrl(track.sourcePath) }))
        : []
    }
  } catch {
    return emptyLibrary
  }
}

async function saveLibrary(library: SavedEditorLibrary): Promise<void> {
  // previewUrl ids are minted per session, so they are not persisted.
  const music = library.music.map(({ previewUrl: _previewUrl, ...track }) => track)
  await writeFile(libraryFilePath(), JSON.stringify({ ...library, music }, null, 2), 'utf8')
}

function mediaContentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.m4a':
      return 'audio/mp4'
    case '.aac':
      return 'audio/aac'
    case '.ogg':
      return 'audio/ogg'
    case '.flac':
      return 'audio/flac'
    default:
      return 'video/mp4'
  }
}

function createMediaUrl(filePath: string): string {
  const id = crypto.randomUUID()
  mediaPaths.set(id, filePath)
  return `media://${id}`
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

async function probeVideo(filePath: string): Promise<SourceVideo> {
  const [{ stdout }, fileStats] = await Promise.all([
    runFile(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath],
      { windowsHide: true }
    ),
    stat(filePath)
  ])

  const probe = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: string
      width?: number
      height?: number
      tags?: { rotate?: string }
      side_data_list?: Array<{ rotation?: number }>
    }>
    format?: { duration?: string }
  }
  const videoStream = probe.streams?.find((stream) => stream.codec_type === 'video')

  if (!videoStream?.width || !videoStream.height) {
    throw new Error(`No video stream found in ${filePath}`)
  }

  const rotation =
    Math.abs(
      Number(
        videoStream.tags?.rotate ??
          videoStream.side_data_list?.find((sideData) => sideData.rotation !== undefined)
            ?.rotation ??
          0
      )
    ) %
      180 ===
    90

  return {
    id: crypto.randomUUID(),
    name: basename(filePath),
    sourcePath: filePath,
    previewUrl: createMediaUrl(filePath),
    sizeBytes: fileStats.size,
    durationSec: Number(probe.format?.duration ?? 0),
    width: rotation ? videoStream.height : videoStream.width,
    height: rotation ? videoStream.width : videoStream.height
  }
}

async function chooseFlashImages(): Promise<FlashImageSelection | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: [...imageExtensions].map((ext) => ext.slice(1)) }]
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const picked = result.filePaths.filter((filePath) =>
    imageExtensions.has(extname(filePath).toLowerCase())
  )
  const images = picked.slice(0, MAX_FLASH_IMAGES).map((filePath) => ({
    id: crypto.randomUUID(),
    name: basename(filePath),
    path: filePath,
    url: createMediaUrl(filePath)
  }))

  return { images, pickedCount: picked.length }
}

async function importMusic(): Promise<MusicTrack[]> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Audio files',
        extensions: [...audioExtensions].map((extension) => extension.slice(1))
      }
    ]
  })

  if (result.canceled) return []

  const filePaths = result.filePaths.filter((filePath) =>
    audioExtensions.has(extname(filePath).toLowerCase())
  )
  return Promise.all(
    filePaths.map(async (filePath) => {
      const { stdout } = await runFile(
        ffprobePath,
        ['-v', 'error', '-print_format', 'json', '-show_format', filePath],
        { windowsHide: true }
      )
      const probe = JSON.parse(stdout) as { format?: { duration?: string } }
      return {
        id: crypto.randomUUID(),
        name: basename(filePath),
        sourcePath: filePath,
        durationSec: Number(probe.format?.duration ?? 0),
        previewUrl: createMediaUrl(filePath)
      }
    })
  )
}

async function importVideos(): Promise<SourceVideo[]> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'MP4 videos', extensions: ['mp4'] }]
  })

  if (result.canceled) return []

  const filePaths = result.filePaths.filter(
    (filePath) => extname(filePath).toLowerCase() === '.mp4'
  )
  return Promise.all(filePaths.map(probeVideo))
}

function createWindow(): void {
  // Size from the work area (DIPs, excludes the taskbar) so the window and its minimums
  // never exceed the usable screen on scaled displays.
  const work = screen.getPrimaryDisplay().workAreaSize
  const mainWindow = new BrowserWindow({
    width: Math.min(1280, work.width),
    height: Math.min(800, work.height),
    minWidth: Math.min(1100, work.width),
    minHeight: Math.min(600, work.height),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    // Hide the native (OS accent-colored) title bar; the renderer draws its own and the
    // window controls are recolored to match the app's --chrome / --text-muted tokens.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0f0f12', symbolColor: '#d4cde0', height: 32 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  testFFmpeg()
  protocol.handle('media', async (request) => {
    const id = new URL(request.url).hostname
    const filePath = mediaPaths.get(id)

    if (!filePath) {
      return new Response('Media file not found', { status: 404 })
    }

    let fileStats: Stats
    try {
      fileStats = await stat(filePath)
    } catch {
      // Deleted or moved since it was imported.
      return new Response('Media file not found', { status: 404 })
    }
    // A file deleted mid-stream errors the stream; without a listener that would be unhandled.
    const openStream = (options?: { start: number; end: number }): ReadableStream => {
      const stream = createReadStream(filePath, options)
      stream.on('error', (error) => console.warn('[media] read failed', filePath, error.message))
      return Readable.toWeb(stream) as ReadableStream
    }
    const range = request.headers.get('range')
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Content-Type': mediaContentType(filePath),
      'Cache-Control': 'no-cache'
    })

    if (!range) {
      headers.set('Content-Length', String(fileStats.size))
      return new Response(openStream(), { status: 200, headers })
    }

    const match = /^bytes=(\d+)-(\d*)$/.exec(range)
    if (!match) return new Response('Invalid range', { status: 416 })

    const start = Number(match[1])
    const requestedEnd = match[2] ? Number(match[2]) : fileStats.size - 1
    const end = Math.min(requestedEnd, fileStats.size - 1)

    if (start >= fileStats.size || start > end) {
      headers.set('Content-Range', `bytes */${fileStats.size}`)
      return new Response(null, { status: 416, headers })
    }

    headers.set('Content-Length', String(end - start + 1))
    headers.set('Content-Range', `bytes ${start}-${end}/${fileStats.size}`)
    return new Response(openStream({ start, end }), { status: 206, headers })
  })
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.reelszer.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))
  ipcMain.handle('videos:import', importVideos)
  ipcMain.handle('photos:choose', chooseFlashImages)
  ipcMain.handle('library:load', loadLibrary)
  ipcMain.handle('library:save', (_event, library: SavedEditorLibrary) => saveLibrary(library))
  ipcMain.handle('music:import', importMusic)
  ipcMain.handle('export:run', async (event, request: ExportRequest): Promise<ExportOutcome> => {
    if (activeExportController) throw new Error('An export is already running')

    const missing = await findMissingInputs(request)
    if (missing.length > 0) return { kind: 'missing', paths: missing }

    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: app.getPath('videos')
    })

    if (result.canceled) return { kind: 'cancelled' }

    const controller = new AbortController()
    activeExportController = controller

    try {
      const exported = await exportVideos(
        request,
        result.filePaths[0],
        (progress) => event.sender.send('export:progress', progress),
        controller.signal
      )
      return { kind: 'done', ...exported }
    } finally {
      activeExportController = null
    }
  })
  ipcMain.handle('export:show', (_event, filePath: string) => showExportedFile(filePath))
  ipcMain.handle('export:cancel', () => {
    activeExportController?.abort()
  })

  initFileWatch((changes) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('files:status', changes)
    }
  })
  ipcMain.handle('files:watch', (_event, paths: string[]) =>
    setWatchedPaths(Array.isArray(paths) ? paths : [])
  )
  // Catch changes made while the app was in the background without waiting for the poll.
  app.on('browser-window-focus', recheckWatchedPaths)

  initDownloads(createMediaUrl)
  void autoUpdateYtDlp()
  ipcMain.handle('downloads:list', listDownloads)
  ipcMain.handle('downloads:start', (_event, urls: string[], mode: DownloadMode) =>
    startDownloads(urls, mode)
  )
  ipcMain.handle('downloads:retry', (_event, id: string) => retryDownload(id))
  ipcMain.handle('downloads:cancel', (_event, id: string) => cancelDownload(id))
  ipcMain.handle('downloads:remove-many', (event, ids: string[]) =>
    removeDownloads(ids, BrowserWindow.fromWebContents(event.sender))
  )
  ipcMain.handle('downloads:show', (_event, id: string) => showDownload(id))
  ipcMain.handle('downloads:get-folder', getDownloadFolder)
  ipcMain.handle('downloads:choose-folder', chooseDownloadFolder)

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
