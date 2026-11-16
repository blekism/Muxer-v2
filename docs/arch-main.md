# `src/main` — Electron main process

Owns everything that needs Node/OS access: windows, file dialogs, FFmpeg, and persistence. The renderer reaches it only through IPC (bridged in `src/preload/index.ts`).

## Files

- **`index.ts`** — app entry point and IPC surface.
  - Creates the `BrowserWindow` (preload, `sandbox: false`, `titleBarStyle: 'hidden'` with a `titleBarOverlay` colored to the theme's `--chrome`/`--text-muted`), loads the Vite dev URL or built `index.html`, and quits on `window-all-closed` (except on macOS).
  - On ready, runs `testFFmpeg()` (logs only) and registers all IPC handlers.
  - **IPC handlers:**
    - `videos:import` — opens an MP4 picker, then runs `probeVideo` (ffprobe) on each file, at most `PROBE_CONCURRENCY` (half the logical CPUs, min 2) at once, sending `videos:import-progress { done, total }` after each. It returns the sources **without** `thumbnailUrl`.
    - Thumbnails: `sendThumbnails` (used by `videos:import` and `session:load`) queues `createVideoThumbnail` for each source on a shared 2-slot limiter (`createLimiter` in `utils/limit.ts`), starting on the next macrotask so the invoke reply goes first. Each grabs one frame with a below-normal-priority ffmpeg into `userData/video-thumbs/<sha1(path|size|mtime)>.jpg` (cached; reused on re-import and session load) and is pushed as `videos:thumbnail { id, thumbnailUrl }` (`media://` URL). Failures are logged and send nothing. The renderer batches these and keeps ones that arrive before their source.
    - `photos:choose` — multi-select image file picker. Returns `{ images, pickedCount }`: every picked image (no cap here; the renderer caps the pool at `MAX_POOL_IMAGES` and allows one *selected* image, `MAX_FLASH_IMAGES` = 1) and how many were picked.
    - `music:import` — opens an audio picker and ffprobes each file for its duration.
    - `library:load` / `library:save` — reads and writes `userData/editor-library.json` (caption presets and music). `load` falls back to an empty library on any error.
    - `session:load` / `session:save` — the work-in-progress editor session in `userData/editor-session.json`: `{ sources, flashImages, selectedFlashImageIds, flashRepeats, editor }` (`flashImages` is the whole pool, `selectedFlashImageIds` the ones that flash; `editor` is the renderer's `EditorSettings`, stored as-is). Sessions saved before selection existed load with the first `MAX_FLASH_IMAGES` images selected. Only file paths are kept, not copies. `load` returns `null` on any error and mints fresh `media://` urls for each source and image (source thumbnails follow as `videos:thumbnail` events); `save` strips them.
    - `photos:choose-folder` — returns the folder's image list, sorted by name.
    - `music:import` — opens an audio picker and ffprobes each file for its duration. Each track gets a `previewUrl` (`media://` id) so the renderer can play it.
    - `library:load` / `library:save` — reads and writes `userData/editor-library.json` (caption presets and music). `load` falls back to an empty library on any error and mints a fresh `previewUrl` for each music track; `save` strips `previewUrl` (ids are per session).
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
  - Renders outputs (sources × copies) through a worker pool: 2 at once when `os.availableParallelism() >= 8`, else 1 (`EXPORT_CONCURRENCY`). Cancelling, or any error other than a missing file, aborts every running render; partial output files are deleted. `uniqueOutputPath` reserves names in memory so parallel jobs never collide.
  - Output is named `<name>_edited.mp4`, with a `-N` suffix on collisions.
  - Each source is probed again with ffprobe (fps, duration, audio track).
  - `buildFilters` produces one `-filter_complex` graph, in this order:
    1. Rotate the full frame (skipped at 0°), then crop to 9:16 divided by zoom, then scale to the quality width (480/720/1080) at 16:9 portrait height.
    2. Perspective, `hflip` (when `flip`), and `eq` brightness/contrast/saturation (on YUV, skipped when neutral). When `colortemperature` (skipped at 6500K, `mix=TEMPERATURE_MIX`) or `vignette angle=` is active, an explicit YUV→`gbrp` conversion runs first, using the source's probed matrix and range (untagged = BT.709 limited). With neither active, the source goes straight YUV→BT.709 limited `yuv420p` with no RGB round trip (lossless when the source is already BT.709). `speed` is applied by `setpts=(PTS-STARTPTS)/speed` on video and `atempo` on kept original audio (music isn't retimed). Output duration, `-t`, flash frame count and progress all use `(duration - trim) / speed`. Then convert back to BT.709 limited `yuv420p`. The output is tagged BT.709 (`-colorspace`/`-color_primaries`/`-color_trc`/`-color_range`) so players decode it the way the Chromium preview does. HDR sources (PQ/HLG) only log a warning and are not tone-mapped.
    - The shared color constants come from `src/shared/colorConstants.ts`, the same file the renderer uses.
    3. Every picked flash image (capped at `MAX_FLASH_IMAGES`) flashes `ExportRequest.flashRepeats` times (clamped by `clampFlashRepeats`). Each repeat is a separate 3-frame flash, as if the image were passed to spike2.mjs again. Each image is a single-frame input (no `-loop`), scaled once, and gets one `overlay` (`eof_action=repeat`) whose `enable` ORs all of that image's flash windows. `flashStarts` places every flash randomly, no earlier than output frame 60 (`FIRST_FLASH_FRAME`) and at least 2s apart (`MIN_FLASH_GAP_SEC`, which shrinks on short clips but never lets flashes overlap). Both limits are scaled by `speed`, because overlay's `n` counts source frames. The slots are dealt to the images in random order. A clip too short for all the flashes fails with a clear error.
    4. `drawtext` caption, read from a temp file in `%TEMP%` that is deleted afterwards. Its `enable` turns it off on the flash frames, so flash images show without the text.
  - Encodes with libx264, using a CRF set by quality.
  - Audio comes from the chosen music track (looped), else the original audio if enabled, else none.
  - `trimStart` is applied with `-ss`.
  - Cancellation and timeouts: the `AbortSignal` is passed to `execFile`, and each render has a 30-minute timeout.
  - Settings values from the UI are passed to FFmpeg unchanged, apart from clamps. The caption text goes through `applyTextCase` (per-source `text.textCase`) before it is written to the drawtext file.
- **`download.ts`** — TikTok downloads through the standalone `yt-dlp.exe`.
  - Binary: the bundled `resources/yt-dlp.exe` is copied to `userData/bin/yt-dlp.exe` (re-copied when the bundled one is newer), and only that copy runs, so `yt-dlp -U` works in a packaged app.
  - Each `downloads:start` call with mode `batch` stamps one shared `batchId` on its items, which the renderer uses to group them.
  - Queue: one `spawn` per link, at most 2 at a time (`MAX_PARALLEL`). Cancelling kills the process tree with `taskkill /T /F`.
  - Output: `<folder>/<uploader>_<id>.mp4` (batch items go in `<folder>/Batch <n> <YYYY-MM-DD>/`, where `n` comes from the persisted `nextBatch` counter in `downloads.json` and the date from the batch's `createdAt`), preferring H.264 (`-S vcodec:h264`) so the editor preview can play it, and merged with the bundled ffmpeg (`--ffmpeg-location`). Thumbnails go to `userData/download-thumbs/<id>.jpg` and are served as `media://` URLs.
  - Parsing: lines prefixed `__META__` (id and title), `__PROG__` (bytes), `__FILE__` (final path) and `ERROR:`, read from both stdout and stderr, because `--print` implies `--quiet`, which moves progress to stderr.
  - History and the output folder (default `Videos/TikTok Downloads`) persist in `userData/downloads.json`. File paths stay in main. Jobs that were active at shutdown load as failed (`Interrupted`).
- **`utils/ffpaths.ts`** — resolves `ffmpeg.exe`, `ffprobe.exe`, the bundled `yt-dlp.exe`, and `fontFilePath(id)` (the .ttf in `resources/fonts` that drawtext's `fontfile` uses; ids come from `src/shared/fonts.ts`).
  - Dev: `resources/`.
  - Packaged: `process.resourcesPath` (via `extraResources`).
  - Windows-only, because the `.exe` names are hardcoded.
- **`utils/test-ffpaths.ts`** — startup smoke test that runs `-version` on both binaries and logs the result.
- **`exportold.ts`** — earlier export implementation. Nothing imports it.

## Conventions and gotchas

- Types for requests and results come from `src/shared/types.ts`.
- Adding an IPC call means updating this directory's handlers, `src/preload/index.ts`, and `src/preload/index.d.ts`.
- `index.ts` and `export.ts` each define their own `probeVideo` and image-extension set, so changes to one don't carry over to the other.
