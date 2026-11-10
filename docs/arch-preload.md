# `src/preload` — Electron preload bridge

Sits between the main process (`src/main/index.ts`) and the renderer. It is the only place the renderer gets access to IPC. It holds no logic, only typed pass-throughs to `ipcRenderer`.

## Files

- **`index.ts`** — builds the `api` object and exposes it to the renderer.
  - With `process.contextIsolated`, it uses `contextBridge.exposeInMainWorld` for `window.electron` (from `@electron-toolkit/preload`) and `window.api`. Otherwise it assigns them directly onto `window`.
  - Each `api` method is a thin wrapper around `ipcRenderer.invoke(<channel>)`:

    | `window.api` method | IPC channel | Returns |
    | --- | --- | --- |
    | `videos.import()` | `videos:import` | `SourceVideo[]` |
    | `photos.choose()` | `photos:choose` | `FlashImageSelection | null` |
    | `library.load()` | `library:load` | `SavedEditorLibrary` |
    | `library.save(library)` | `library:save` | `void` |
    | `music.import()` | `music:import` | `MusicTrack[]` |
    | `export.run(request)` | `export:run` | `ExportResult \| null` |
    | `export.cancel()` | `export:cancel` | `void` |
    | `export.onProgress(listener)` | `export:progress` (event) | unsubscribe function |
    | `downloads.list()` | `downloads:list` | `DownloadItem[]` |
    | `downloads.start(urls, mode)` | `downloads:start` | `void` |
    | `downloads.retry(id)` / `cancel(id)` / `show(id)` | `downloads:retry` / `:cancel` / `:show` | `void` |
    | `downloads.getFolder()` | `downloads:get-folder` | `string` |
    | `downloads.chooseFolder()` | `downloads:choose-folder` | `string \| null` |
    | `downloads.onUpdate(listener)` | `downloads:update` (event) | unsubscribe function |
    | `downloads.removeMany(ids)` | `downloads:remove-many` | `boolean` (false if the user cancelled); permanently deletes the files |

  - `export.onProgress` and `downloads.onUpdate` are the push channels. Each subscribes with `ipcRenderer.on` and returns a function that removes the listener. Callers must invoke it on cleanup.
- **`index.d.ts`** — types for the renderer.
  - `AppApi` mirrors the `api` object in `index.ts`.
  - It augments the global `Window` with `electron: ElectronAPI` and `api: AppApi`.

## Rules

- **Adding an IPC call touches three places:** the handler in `src/main/index.ts`, the bridge in `index.ts`, and the type in `index.d.ts`. `index.ts` and `index.d.ts` are not checked against each other, so keep them in sync by hand.
- Payload and result types come from `src/shared/types.ts`, which is the contract with main and the renderer.
- The renderer never gets file paths to play. Media goes through the `media://<uuid>` protocol in main, and the preload only carries the ids and metadata.
- Keep the bridge to named, narrow methods. Don't expose `ipcRenderer` itself.
- `window.electron` (the electron-toolkit helper) is still exposed from the template. The app uses `window.api`.
