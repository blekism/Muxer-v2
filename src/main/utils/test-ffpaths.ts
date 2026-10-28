import { execFile } from 'node:child_process'
import { ffmpegPath, ffprobePath } from './ffpaths'

function testExecutable(name: string, executablePath: string) {
  console.log(`\nTesting ${name}`)
  console.log(`Path: ${executablePath}`)

  execFile(
    executablePath,
    ['-version'],
    {
      timeout: 10000,
      windowsHide: true
    },
    (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ ${name} failed:`, error.message)
        console.error(stderr)
        return
      }

      console.log(`✅ ${name} executed successfully`)
      console.log(stdout.split('\n')[0])
    }
  )
}

export function testFFmpeg() {
  testExecutable('FFmpeg', ffmpegPath)
  testExecutable('FFprobe', ffprobePath)
}
