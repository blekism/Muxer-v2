# `src/main` — Electron main process

Owns everything that needs Node/OS access: windows, file dialogs, FFmpeg, and persistence. The renderer reaches it only through IPC (bridged in `src/preload/index.ts`).

## Files

- **`index.ts`** — app entry point and IPC surface.
  - Creates the `BrowserWindow` (preload, `sandbox: false`, `titleBarStyle: 'hidden'` with a `titleBarOverlay` colored to the theme's `--chrome`/`--text-muted`), loads the Vite dev URL or built `index.html`, and quits on `window-all-closed` (except on macOS).
  - On ready, runs `testFFmpeg()` (logs only) and registers all IPC handlers.
  - **IPC handlers:**
    - `videos:import` — opens an MP4 picker, then runs `probeVideo` on each file.
    - `photos:choose` — multi-select image file picker. Returns `{ images, pickedCount }`: the picked images (first `MAX_FLASH_IMAGES` from `shared/flashConstants.ts`) and how many were picked before the cut.
    - `music:import` — opens an audio picker and ffprobes each file for its duration.
    - `library:load` / `library:save` — reads and writes `userData/editor-library.json` (caption presets and music). `load` falls back to an empty library on any error.
    - `export:run` — prompts for an output directory, then calls `exportVideos`. It rejects if an export is already running, returns `null` if the dialog is cancelled, and streams `export:progress` events to the sender.
    - `export:cancel` — aborts the active `AbortController`.
    - `downloads:list` / `start(urls, mode)` / `retry(id)` / `cancel(id)` / `show(id)` / `get-folder` / `choose-folder` — the TikTok downloader, implemented in `download.ts`. Item changes are pushed to all windows as `downloads:update` events carrying a full `DownloadItem`.
    - `downloads:remove-many(ids)` — the only delete path, used for one video or many. It shows a native "Permanently delete N video(s)?" confirm dialog. If the user confirms, it cancels active jobs, **permanently deletes** each video file and its saved thumbnail with `fs.rm` (no Recycle Bin; a failed delete is logged and the item is still removed), removes the items from history and returns `true`. It returns `false` if the user cancels.
  - On ready, it calls `autoUpdateYtDlp()`, which silently runs `yt-dlp --update-to stable` (60-second timeout). The queue doesn't start jobs until it finishes. A failure, for example being offline, is logged and the current exe is kept. Users have no update control.
  - **`media://<uuid>` protocol:** a privileged scheme that serves local video and image files to the renderer.
    - `mediaPaths` maps each random id to a file path, so the renderer never sees raw paths.
    - The handler supports HTTP range requests (200, 206, 416) so `<video>` can seek.
    - Entries are never removed from `mediaPaths`, so it grows for the life of the app.
  - `probeVideo` swaps width and height when the stream is rotated 90° or 270°, so `SourceVideo` dimensions are display dimensions.
  - Leftover template code: the `ping` IPC test handler.
- **`export.ts`** — the render pipeline, exposed as `exportVideos(request, outDir, onProgress, signal)`.
  - Renders sources one at a time, in order.
  - Output is named `<name>_edited.mp4`, with a `-N` suffix on collisions.
  - Each source is probed again with ffprobe (fps, duration, audio track).
  - `buildFilters` produces one `-filter_complex` graph, in this order:
    1. Rotate the full frame, then crop to 9:16 divided by zoom, then scale to the quality width (480/720/1080) at 16:9 portrait height.
    2. Perspective, then an explicit YUV→`gbrp` conversion using the source's probed matrix and range (untagged = BT.709 limited). Then `colortemperature` (skipped at 6500K, `mix=TEMPERATURE_MIX`), `colorbalance gs=` (tint, which lifts shadows only), and `vignette angle=`. Then convert back to BT.709 limited `yuv420p`. The output is tagged BT.709 (`-colorspace`/`-color_primaries`/`-color_trc`/`-color_range`) so players decode it the way the Chromium preview does. HDR sources (PQ/HLG) only log a warning and are not tone-mapped.
    - The shared color constants come from `src/shared/colorConstants.ts`, the same file the renderer uses.
    3. Every picked flash image (capped at `MAX_FLASH_IMAGES`), each overlaid for 3 frames at a random start frame.
    4. `drawtext` caption, read from a temp file in `%TEMP%` that is deleted afterwards.
  - Encodes with libx264, using a CRF set by quality.
  - Audio comes from the chosen music track (looped), else the original audio if enabled, else none.
  - `trimStart` is applied with `-ss`.
  - Cancellation and timeouts: the `AbortSignal` is passed to `execFile`, and each render has a 30-minute timeout.
  - Settings values from the UI are passed to FFmpeg unchanged, apart from clamps.
- **`download.ts`** — TikTok downloads through the standalone `yt-dlp.exe`.
  - Binary: the bundled `resources/yt-dlp.exe` is copied to `userData/bin/yt-dlp.exe` (re-copied when the bundled one is newer), and only that copy runs, so `yt-dlp -U` works in a packaged app.
  - Each `downloads:start` call with mode `batch` stamps one shared `batchId` on its items, which the renderer uses to group them.
  - Queue: one `spawn` per link, at most 2 at a time (`MAX_PARALLEL`). Cancelling kills the process tree with `taskkill /T /F`.
  - Output: `<folder>/<uploader>_<id>.mp4`, preferring H.264 (`-S vcodec:h264`) so the editor preview can play it, and merged with the bundled ffmpeg (`--ffmpeg-location`). Thumbnails go to `userData/download-thumbs/<id>.jpg` and are served as `media://` URLs.
  - Parsing: lines prefixed `__META__` (id and title), `__PROG__` (bytes), `__FILE__` (final path) and `ERROR:`, read from both stdout and stderr, because `--print` implies `--quiet`, which moves progress to stderr.
  - History and the output folder (default `Videos/TikTok Downloads`) persist in `userData/downloads.json`. File paths stay in main. Jobs that were active at shutdown load as failed (`Interrupted`).
- **`utils/ffpaths.ts`** — resolves `ffmpeg.exe`, `ffprobe.exe` and the bundled `yt-dlp.exe`.
  - Dev: `resources/`.
  - Packaged: `process.resourcesPath` (via `extraResources`).
  - Windows-only, because the `.exe` names are hardcoded.
- **`utils/test-ffpaths.ts`** — startup smoke test that runs `-version` on both binaries and logs the result.
- **`exportold.ts`** — earlier export implementation. Nothing imports it.

## Conventions and gotchas

- Types for requests and results come from `src/shared/types.ts`.
- Adding an IPC call means updating this directory's handlers, `src/preload/index.ts`, and `src/preload/index.d.ts`.
- `index.ts` and `export.ts` each define their own `probeVideo` and image-extension set, so changes to one don't carry over to the other.
