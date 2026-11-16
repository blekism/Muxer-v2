/**
 * Returns a runner that starts at most `concurrency` tasks at once; the rest wait in order. Each call resolves or
 * rejects with its own task's result, and one failure never blocks the queue.
 */
export function createLimiter(concurrency: number): <T>(task: () => Promise<T>) => Promise<T> {
  const waiting: Array<() => void> = []
  let running = 0

  const next = (): void => {
    if (running >= concurrency) return
    const start = waiting.shift()
    if (!start) return
    running += 1
    start()
  }

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            running -= 1
            next()
          })
      })
      next()
    })
}
