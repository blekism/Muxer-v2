import { app, BrowserWindow, dialog, shell } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import type { DownloadItem, DownloadMode } from '../shared/types'
import { bundledYtDlpPath, ffmpegLocation } from './utils/ffpaths'

const runFile = promisify(execFile)
const MAX_PARALLEL = 2
const META = '__META__'
const PROG = '__PROG__'
const FILE = '__FILE__'

/** Persisted history row. Paths stay in main; the renderer only gets `DownloadItem`. */
interface DownloadRecord extends Omit<DownloadItem, 'thumbnailUrl'> {
  filePath?: string
  thumbnailPath?: string
}

interface DownloadStore {
  folder: string
  items: DownloadRecord[]
}

let store: DownloadStore | null = null
let saving = Promise.resolve()
let updating = false
let mintMediaUrl: (filePath: string) => string = () => ''
const thumbUrls = new Map<string, string>()
/** Active jobs. `null` while the job is still resolving yt-dlp, before spawning. */
const running = new Map<string, ChildProcess | null>()
const cancelled = new Set<string>()

const storePath = (): string => join(app.getPath('userData'), 'downloads.json')
const thumbsDir = (): string => join(app.getPath('userData'), 'download-thumbs')
const localYtDlpPath = (): string => join(app.getPath('userData'), 'bin', 'yt-dlp.exe')

export function initDownloads(createMediaUrl: (filePath: string) => string): void {
  mintMediaUrl = createMediaUrl
}

async function ensureStore(): Promise<DownloadStore> {
  if (store) return store
  const fallback: DownloadStore = {
    folder: join(app.getPath('videos'), 'TikTok Downloads'),
    items: []
  }
  try {
    const saved = JSON.parse(await readFile(storePath(), 'utf8')) as Partial<DownloadStore>
    store = {
      folder: typeof saved.folder === 'string' ? saved.folder : fallback.folder,
      items: Array.isArray(saved.items) ? saved.items : []
    }
    // Jobs that were running when the app closed can't be resumed in place.
    for (const record of store.items) {
      if (record.status === 'queued' || record.status === 'downloading') {
        Object.assign(record, { status: 'failed', progress: 0, error: 'Interrupted' })
      }
    }
  } catch {
    store = fallback
  }
  return store
}

function persist(): void {
  const snapshot = JSON.stringify(store, null, 2)
  saving = saving
    .then(() => writeFile(storePath(), snapshot, 'utf8'))
    .catch((error) => console.error('Unable to save download history', error))
}

function toItem(record: DownloadRecord): DownloadItem {
  let thumbnailUrl: string | undefined
  if (record.thumbnailPath) {
    thumbnailUrl = thumbUrls.get(record.id) ?? mintMediaUrl(record.thumbnailPath)
    thumbUrls.set(record.id, thumbnailUrl)
  }
  return {
    id: record.id,
    url: record.url,
    title: record.title,
    mode: record.mode,
    batchId: record.batchId,
    status: record.status,
    progress: record.progress,
    sizeBytes: record.sizeBytes,
    thumbnailUrl,
    error: record.error,
    createdAt: record.createdAt
  }
}

function update(record: DownloadRecord, patch: Partial<DownloadRecord>, save: boolean): void {
  // A removed record may still get late events from its process. Don't resurrect it.
  if (!store?.items.includes(record)) return
  Object.assign(record, patch)
  const item = toItem(record)
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('downloads:update', item)
  }
  if (save) persist()
}

/** Runs the userData copy, seeding it from the bundled exe when missing or older. */
async function ytDlpPath(): Promise<string> {
  const target = localYtDlpPath()
  const [bundled, local] = await Promise.all([
    stat(bundledYtDlpPath).catch(() => null),
    stat(target).catch(() => null)
  ])
  if (bundled && (!local || bundled.mtimeMs > local.mtimeMs)) {
    await mkdir(dirname(target), { recursive: true })
    await copyFile(bundledYtDlpPath, target)
  } else if (!local) {
    throw new Error('yt-dlp.exe is missing. Put it in resources/ next to ffmpeg.exe.')
  }
  return target
}

function buildArgs(url: string, folder: string): string[] {
  return [
    '--newline',
    '--no-playlist',
    '--no-warnings',
    '--no-mtime',
    // --print implies --quiet and --simulate, so turn progress and the download back on.
    '--no-simulate',
    '--progress',
    '-f',
    'bv*+ba/b',
    // Prefer H.264 so the editor's <video> preview can play the file.
    '-S',
    'vcodec:h264,ext:mp4:m4a',
    '--merge-output-format',
    'mp4',
    '--ffmpeg-location',
    ffmpegLocation,
    '--write-thumbnail',
    '--convert-thumbnails',
    'jpg',
    '-P',
    folder,
    '-P',
    `thumbnail:${thumbsDir()}`,
    '-o',
    '%(uploader)s_%(id)s.%(ext)s',
    '-o',
    'thumbnail:%(id)s.%(ext)s',
    '--progress-template',
    `download:${PROG}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s`,
    '--print',
    `before_dl:${META}%(.{id,title})j`,
    '--print',
    `after_move:${FILE}%(filepath)s`,
    '--',
    url
  ]
}

function killTree(child: ChildProcess): void {
  // The PyInstaller exe spawns a child, and yt-dlp may spawn ffmpeg, so kill the whole tree.
  if (child.pid) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {})
}

async function runJob(record: DownloadRecord): Promise<void> {
  running.set(record.id, null)
  update(record, { status: 'downloading', progress: 0, error: undefined }, true)

  let videoId: string | undefined
  let lastPercent = -1
  let lastError = ''

  const handleLine = (line: string): void => {
    if (line.startsWith(PROG)) {
      const [done, total, estimate] = line.slice(PROG.length).split('|').map(Number)
      const size = total || estimate
      if (!(size > 0) || !(done >= 0)) return
      const percent = Math.min(99, Math.round((done / size) * 100))
      if (percent !== lastPercent) {
        lastPercent = percent
        update(record, { progress: percent, sizeBytes: size }, false)
      }
    } else if (line.startsWith(META)) {
      try {
        const meta = JSON.parse(line.slice(META.length)) as { id?: string; title?: string }
        videoId = meta.id
        update(record, { title: meta.title || meta.id || record.title }, true)
      } catch {
        /* ignore malformed metadata */
      }
    } else if (line.startsWith(FILE)) {
      record.filePath = line.slice(FILE.length).trim()
    } else if (line.startsWith('ERROR:')) {
      lastError = line.replace(/^ERROR:\s*(\[[^\]]+\]\s*[^:]*:\s*)?/, '').trim()
    }
  }

  try {
    const { folder } = await ensureStore()
    const [exe] = await Promise.all([
      ytDlpPath(),
      mkdir(folder, { recursive: true }),
      mkdir(thumbsDir(), { recursive: true })
    ])
    if (cancelled.has(record.id)) throw new Error('Cancelled')

    await new Promise<void>((resolve, reject) => {
      const child = spawn(exe, buildArgs(record.url, folder), {
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
      })
      running.set(record.id, child)
      // Progress goes to stderr under --print's implied --quiet, so read both streams.
      createInterface({ input: child.stdout }).on('line', handleLine)
      createInterface({ input: child.stderr }).on('line', handleLine)
      child.on('error', reject)
      child.on('close', (code) => {
        if (cancelled.has(record.id)) reject(new Error('Cancelled'))
        else if (code === 0) resolve()
        else reject(new Error(lastError || `yt-dlp exited with code ${code}`))
      })
    })

    const [file, thumb] = await Promise.all([
      record.filePath ? stat(record.filePath).catch(() => null) : null,
      videoId ? stat(join(thumbsDir(), `${videoId}.jpg`)).catch(() => null) : null
    ])
    update(
      record,
      {
        status: 'done',
        progress: 100,
        sizeBytes: file?.size ?? record.sizeBytes,
        thumbnailPath: thumb && videoId ? join(thumbsDir(), `${videoId}.jpg`) : undefined
      },
      true
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    update(record, { status: 'failed', progress: 0, error: message }, true)
  } finally {
    running.delete(record.id)
    cancelled.delete(record.id)
    pump()
  }
}

function pump(): void {
  if (!store || updating) return
  for (const record of store.items) {
    if (running.size >= MAX_PARALLEL) break
    if (record.status === 'queued' && !running.has(record.id)) void runJob(record)
  }
}

async function findRecord(id: string): Promise<DownloadRecord | undefined> {
  return (await ensureStore()).items.find((record) => record.id === id)
}

export async function listDownloads(): Promise<DownloadItem[]> {
  return (await ensureStore()).items.map(toItem)
}

export async function startDownloads(urls: string[], mode: DownloadMode): Promise<void> {
  const current = await ensureStore()
  const createdAt = Date.now()
  const batchId = mode === 'batch' ? crypto.randomUUID() : undefined
  for (const url of urls) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue
    const record: DownloadRecord = {
      id: crypto.randomUUID(),
      url,
      title: 'Fetching details…',
      mode,
      batchId,
      status: 'queued',
      progress: 0,
      createdAt
    }
    current.items.push(record)
    update(record, {}, false)
  }
  persist()
  pump()
}

export async function retryDownload(id: string): Promise<void> {
  const record = await findRecord(id)
  if (!record || record.status !== 'failed') return
  update(record, { status: 'queued', progress: 0, error: undefined }, true)
  pump()
}

export async function cancelDownload(id: string): Promise<void> {
  const record = await findRecord(id)
  if (!record) return
  if (running.has(id)) {
    cancelled.add(id)
    const child = running.get(id)
    if (child) killTree(child)
  } else if (record.status === 'queued') {
    update(record, { status: 'failed', progress: 0, error: 'Cancelled' }, true)
  }
}

export async function showDownload(id: string): Promise<void> {
  const record = await findRecord(id)
  if (record?.filePath && (await stat(record.filePath).catch(() => null))) {
    shell.showItemInFolder(record.filePath)
  } else {
    await shell.openPath((await ensureStore()).folder)
  }
}

export async function getDownloadFolder(): Promise<string> {
  return (await ensureStore()).folder
}

export async function chooseDownloadFolder(): Promise<string | null> {
  const current = await ensureStore()
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: current.folder
  })
  if (result.canceled) return null
  current.folder = result.filePaths[0]
  persist()
  return current.folder
}

/**
 * Confirms, then permanently deletes the downloaded videos (and thumbnails) and removes the
 * items from history. Active jobs are cancelled first. Resolves false when the user cancels.
 */
export async function removeDownloads(
  ids: string[],
  parent: BrowserWindow | null
): Promise<boolean> {
  const current = await ensureStore()
  const targets = current.items.filter((record) => ids.includes(record.id))
  if (targets.length === 0) return true

  const count = `${targets.length} video${targets.length === 1 ? '' : 's'}`
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    message: `Permanently delete ${count}?`,
    detail: `The downloaded ${targets.length === 1 ? 'file' : 'files'} will be deleted from your device and can't be recovered.`,
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1
  }
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  if (response !== 0) return false

  for (const record of targets) {
    await cancelDownload(record.id)
    // `force` ignores files that are already gone. Items that never finished have no path.
    for (const filePath of [record.filePath, record.thumbnailPath]) {
      if (!filePath) continue
      await rm(filePath, { force: true }).catch((error) =>
        console.warn(`Unable to delete ${filePath}`, error)
      )
    }
    thumbUrls.delete(record.id)
  }
  current.items = current.items.filter((record) => !targets.includes(record))
  persist()
  return true
}

/**
 * Silently updates the userData copy on startup. The queue waits while it runs,
 * because the exe gets replaced. Failures keep the current exe.
 */
export async function autoUpdateYtDlp(): Promise<void> {
  if (running.size > 0) return
  updating = true
  try {
    const { stdout } = await runFile(await ytDlpPath(), ['--update-to', 'stable'], {
      windowsHide: true,
      timeout: 60_000
    })
    console.log('yt-dlp update:', stdout.trim().split(/\r?\n/).pop())
  } catch (error) {
    console.warn('yt-dlp update skipped', error instanceof Error ? error.message : error)
  } finally {
    updating = false
    pump()
  }
}
