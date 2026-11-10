import { app, shell, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'path'
import { basename, extname } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type {
  DownloadMode,
  ExportRequest,
  MusicTrack,
  PhotoFolder,
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
import { exportVideos } from './export'
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
      music: Array.isArray(saved.music) ? saved.music : []
    }
  } catch {
    return emptyLibrary
  }
}

async function saveLibrary(library: SavedEditorLibrary): Promise<void> {
  await writeFile(libraryFilePath(), JSON.stringify(library, null, 2), 'utf8')
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

async function choosePhotoFolder(): Promise<PhotoFolder | null> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled) return null

  const folderPath = result.filePaths[0]
  const entries = await readdir(folderPath, { withFileTypes: true })
  const images = entries
    .filter((entry) => entry.isFile() && imageExtensions.has(extname(entry.name).toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const filePath = join(folderPath, entry.name)
      return {
        id: crypto.randomUUID(),
        name: entry.name,
        url: createMediaUrl(filePath)
      }
    })

  return { path: folderPath, images }
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
        durationSec: Number(probe.format?.duration ?? 0)
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
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
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

    const fileStats = await stat(filePath)
    const range = request.headers.get('range')
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Content-Type': mediaContentType(filePath),
      'Cache-Control': 'no-cache'
    })

    if (!range) {
      headers.set('Content-Length', String(fileStats.size))
      return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
        status: 200,
        headers
      })
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
    return new Response(
      Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream,
      {
        status: 206,
        headers
      }
    )
  })
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))
  ipcMain.handle('videos:import', importVideos)
  ipcMain.handle('photos:choose-folder', choosePhotoFolder)
  ipcMain.handle('library:load', loadLibrary)
  ipcMain.handle('library:save', (_event, library: SavedEditorLibrary) => saveLibrary(library))
  ipcMain.handle('music:import', importMusic)
  ipcMain.handle('export:run', async (event, request: ExportRequest) => {
    if (activeExportController) throw new Error('An export is already running')

    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: app.getPath('videos')
    })

    if (result.canceled) return null

    const controller = new AbortController()
    activeExportController = controller

    try {
      return await exportVideos(
        request,
        result.filePaths[0],
        (progress) => event.sender.send('export:progress', progress),
        controller.signal
      )
    } finally {
      activeExportController = null
    }
  })
  ipcMain.handle('export:cancel', () => {
    activeExportController?.abort()
  })

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
