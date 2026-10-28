import { app } from 'electron'
import path from 'node:path'

const ffmpegDirectory = app.isPackaged
  ? path.join(process.resourcesPath)
  : path.join(app.getAppPath(), 'resources')

export const ffmpegPath = path.join(ffmpegDirectory, 'ffmpeg.exe')

export const ffprobePath = path.join(ffmpegDirectory, 'ffprobe.exe')
