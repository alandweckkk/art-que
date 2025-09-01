"use client";

// Lightweight client-side job queue that integrates with the global JobManager widget.
// Use this to run operations with progress tracking per job.

type JobStatus = 'pending' | 'running' | 'completed' | 'failed'

interface QueueJob<T> {
  id: string
  input: string
  run: () => Promise<T>
  source: string
}

export class ClientJobQueue {
  private concurrency: number
  private activeCount = 0
  private queue: QueueJob<unknown>[] = []

  constructor(concurrency = 3) {
    this.concurrency = Math.max(1, concurrency)
  }

  enqueue<T>(input: string, source: string, fn: () => Promise<T>, context?: Record<string, unknown>): Promise<T> {
    const jobManager = (window as { jobManager?: { addJob: (input: string, source: string, context?: Record<string, unknown>) => string; updateJobStatus: (id: string, status: JobStatus, result?: unknown) => void } }).jobManager
    const externalId = jobManager?.addJob ? jobManager.addJob(input, source, context) : `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const job: QueueJob<T> = { id: externalId, input, run: fn, source }
    return new Promise<T>((resolve, reject) => {
      this.queue.push(job as QueueJob<unknown>)
      this.process().catch(() => {/* handled per job */})
      ;(job as unknown as { _resolve: (v: T) => void; _reject: (e: unknown) => void })._resolve = resolve
      ;(job as unknown as { _resolve: (v: T) => void; _reject: (e: unknown) => void })._reject = reject
    })
  }

  private async process(): Promise<void> {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!
      this.activeCount += 1
      const jobManager = (window as { jobManager?: { updateJobStatus: (id: string, status: JobStatus, result?: unknown) => void } }).jobManager
      jobManager?.updateJobStatus(job.id, 'running')
      try {
        const result = await job.run()
        jobManager?.updateJobStatus(job.id, 'completed', result)
        ;(job as unknown as { _resolve: (v: unknown) => void })._resolve(result)
      } catch (error) {
        jobManager?.updateJobStatus(job.id, 'failed', { error: error instanceof Error ? error.message : String(error) })
        ;(job as unknown as { _reject: (e: unknown) => void })._reject(error)
      } finally {
        this.activeCount -= 1
      }
    }
  }
}

// Singleton queue for convenience across the app
export const globalClientJobQueue = new ClientJobQueue(4)


