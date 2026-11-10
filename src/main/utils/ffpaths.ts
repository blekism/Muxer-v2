import { app } from 'electron'
import path from 'node:path'

const ffmpegDirectory = app.isPackaged
  ? path.join(process.resourcesPath)
  : path.join(app.getAppPath(), 'resources')

export const ffmpegPath = path.join(ffmpegDirectory, 'ffmpeg.exe')

export const ffprobePath = path.join(ffmpegDirectory, 'ffprobe.exe')

/** Directory holding ffmpeg/ffprobe, passed to yt-dlp as `--ffmpeg-location`. */
export const ffmpegLocation = ffmpegDirectory

/** Read-only yt-dlp shipped with the app. It is copied to userData before use so it can self-update. */
export const bundledYtDlpPath = path.join(ffmpegDirectory, 'yt-dlp.exe')
