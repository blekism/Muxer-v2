import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Fallback poll; fs.watch misses some cases (e.g. the parent directory itself being deleted). */
const POLL_INTERVAL_MS = 3000
const DEBOUNCE_MS = 150

type Notify = (changes: Record<string, boolean>) => void

const watchedPaths = new Set<string>()
const lastExists = new Map<string, boolean>()
const dirWatchers = new Map<string, FSWatcher>()
let notify: Notify | null = null
let pollTimer: NodeJS.Timeout | null = null
let debounceTimer: NodeJS.Timeout | null = null
let checking = false
let checkAgain = false
let checkAgainSendAll = false

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function closeWatcher(dir: string): void {
  dirWatchers.get(dir)?.close()
  dirWatchers.delete(dir)
}

/** Watches each parent directory once; recreated by the poll if the directory comes back. */
async function syncDirWatchers(): Promise<void> {
  const dirs = [...new Set([...watchedPaths].map((filePath) => dirname(filePath)))]
  const dirExists = await Promise.all(dirs.map(pathExists))
  const liveDirs = new Set(dirs.filter((_, index) => dirExists[index]))

  // On Windows a deleted directory's watcher often goes silent without emitting 'error', so a
  // watcher for a directory that no longer exists is dead and must be replaced once it returns.
  for (const dir of [...dirWatchers.keys()]) {
    if (!liveDirs.has(dir)) closeWatcher(dir)
  }

  for (const dir of liveDirs) {
    if (dirWatchers.has(dir)) continue
    try {
      const watcher = watch(dir, { persistent: false }, () => scheduleCheck())
      watcher.on('error', () => {
        closeWatcher(dir)
        scheduleCheck()
      })
      dirWatchers.set(dir, watcher)
    } catch {
      // Directory is missing; the poll retries once it exists again.
    }
  }
}

async function checkAll(sendAll: boolean): Promise<void> {
  if (checking) {
    checkAgain = true
    checkAgainSendAll ||= sendAll
    return
  }
  checking = true
  try {
    const paths = [...watchedPaths]
    const results = await Promise.all(paths.map(pathExists))
    const changes: Record<string, boolean> = {}
    let changed = false

    paths.forEach((filePath, index) => {
      // The watched set may have been replaced while stat ran.
      if (!watchedPaths.has(filePath)) return
      const exists = results[index]
      if (sendAll || lastExists.get(filePath) !== exists) {
        changes[filePath] = exists
        changed = true
      }
      lastExists.set(filePath, exists)
    })

    await syncDirWatchers()
    if (changed) notify?.(changes)
  } finally {
    checking = false
    if (checkAgain) {
      const again = checkAgainSendAll
      checkAgain = false
      checkAgainSendAll = false
      void checkAll(again)
    }
  }
}

function scheduleCheck(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void checkAll(false)
  }, DEBOUNCE_MS)
}

export function initFileWatch(onChange: Notify): void {
  notify = onChange
}

/** Replaces the watched set and reports the current state of every path in it. */
export async function setWatchedPaths(paths: string[]): Promise<void> {
  watchedPaths.clear()
  for (const filePath of paths) {
    if (typeof filePath === 'string' && filePath) watchedPaths.add(filePath)
  }
  for (const filePath of [...lastExists.keys()]) {
    if (!watchedPaths.has(filePath)) lastExists.delete(filePath)
  }

  if (watchedPaths.size === 0) {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
  } else if (!pollTimer) {
    pollTimer = setInterval(() => void checkAll(false), POLL_INTERVAL_MS)
    pollTimer.unref()
  }

  await checkAll(true)
}

export function recheckWatchedPaths(): void {
  if (watchedPaths.size > 0) scheduleCheck()
}
