"use client";

// Lightweight client-side job queue that integrates with the global JobManager widget.
// Use this to run operations with progress tracking per job.

type JobStatus = 'pending' | 'running' | 'completed' | 'failed'

interface QueueJob<T> {
  id: string
  input: string
  run: () => Promise<T>
  source: string
  cancelled?: boolean
  controller?: AbortController
}

export class ClientJobQueue {
  private concurrency: number
  private activeCount = 0
  private queue: QueueJob<unknown>[] = []
  private runningJobs: Map<string, QueueJob<unknown>> = new Map()

  constructor(concurrency = 3) {
    this.concurrency = Math.max(1, concurrency)
  }

  // Cancel a specific job by ID
  cancelJob(jobId: string): boolean {
    // Check if job is in queue
    const queueIndex = this.queue.findIndex(job => job.id === jobId)
    if (queueIndex !== -1) {
      const job = this.queue[queueIndex]
      job.cancelled = true
      this.queue.splice(queueIndex, 1)
      const jobManager = (window as { jobManager?: { updateJobStatus: (id: string, status: JobStatus, result?: unknown) => void } }).jobManager
      jobManager?.updateJobStatus(jobId, 'failed', { error: 'Job cancelled' })
      ;(job as unknown as { _reject: (e: unknown) => void })?._reject?.(new Error('Job cancelled'))
      return true
    }

    // Check if job is running
    const runningJob = this.runningJobs.get(jobId)
    if (runningJob) {
      runningJob.cancelled = true
      runningJob.controller?.abort()
      return true
    }

    return false
  }

  // Cancel all jobs for a specific source
  cancelJobsBySource(source: string): number {
    let cancelledCount = 0

    // Cancel queued jobs
    this.queue = this.queue.filter(job => {
      if (job.source === source) {
        job.cancelled = true
        const jobManager = (window as { jobManager?: { updateJobStatus: (id: string, status: JobStatus, result?: unknown) => void } }).jobManager
        jobManager?.updateJobStatus(job.id, 'failed', { error: 'Job cancelled' })
        ;(job as unknown as { _reject: (e: unknown) => void })?._reject?.(new Error('Job cancelled'))
        cancelledCount++
        return false
      }
      return true
    })

    // Cancel running jobs
    for (const [jobId, job] of this.runningJobs.entries()) {
      if (job.source === source) {
        job.cancelled = true
        job.controller?.abort()
        cancelledCount++
      }
    }

    return cancelledCount
  }

  // Cancel all jobs
  cancelAllJobs(): number {
    let cancelledCount = 0

    // Cancel queued jobs
    for (const job of this.queue) {
      job.cancelled = true
      const jobManager = (window as { jobManager?: { updateJobStatus: (id: string, status: JobStatus, result?: unknown) => void } }).jobManager
      jobManager?.updateJobStatus(job.id, 'failed', { error: 'Job cancelled' })
      ;(job as unknown as { _reject: (e: unknown) => void })?._reject?.(new Error('Job cancelled'))
      cancelledCount++
    }
    this.queue = []

    // Cancel running jobs
    for (const [jobId, job] of this.runningJobs.entries()) {
      job.cancelled = true
      job.controller?.abort()
      cancelledCount++
    }

    return cancelledCount
  }

  enqueue<T>(input: string, source: string, fn: () => Promise<T>, context?: Record<string, unknown>): Promise<T> {
    const jobManager = (window as { jobManager?: { addJob: (input: string, source: string, context?: Record<string, unknown>) => string; updateJobStatus: (id: string, status: JobStatus, result?: unknown) => void } }).jobManager
    const externalId = jobManager?.addJob ? jobManager.addJob(input, source, context) : `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const controller = new AbortController()
    const job: QueueJob<T> = { id: externalId, input, run: fn, source, controller }
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
      
      // Skip cancelled jobs
      if (job.cancelled) {
        continue
      }

      this.activeCount += 1
      this.runningJobs.set(job.id, job)
      
      const jobManager = (window as { jobManager?: { updateJobStatus: (id: string, status: JobStatus, result?: unknown) => void } }).jobManager
      jobManager?.updateJobStatus(job.id, 'running')
      
      try {
        // Check if job was cancelled before running
        if (job.cancelled) {
          throw new Error('Job cancelled')
        }
        
        const result = await job.run()
        
        // Check if job was cancelled during execution
        if (job.cancelled) {
          throw new Error('Job cancelled')
        }
        
        jobManager?.updateJobStatus(job.id, 'completed', result)
        ;(job as unknown as { _resolve: (v: unknown) => void })._resolve(result)
      } catch (error) {
        const isCancelled = job.cancelled || error instanceof Error && error.message === 'Job cancelled'
        const status = isCancelled ? 'failed' : 'failed'
        const errorResult = { error: error instanceof Error ? error.message : String(error) }
        
        jobManager?.updateJobStatus(job.id, status, errorResult)
        ;(job as unknown as { _reject: (e: unknown) => void })._reject(error)
      } finally {
        this.activeCount -= 1
        this.runningJobs.delete(job.id)
      }
    }
  }
}

// Singleton queue for convenience across the app
export const globalClientJobQueue = new ClientJobQueue(4)

// Export cancellation methods for global use
export const cancelJob = (jobId: string) => globalClientJobQueue.cancelJob(jobId)
export const cancelJobsBySource = (source: string) => globalClientJobQueue.cancelJobsBySource(source)
export const cancelAllJobs = () => globalClientJobQueue.cancelAllJobs()


