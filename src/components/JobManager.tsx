'use client'

import { useState, useEffect } from 'react'

interface Job {
  id: string
  input: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startTime?: number
  endTime?: number
  result?: unknown
  source: string // Which view/component initiated the job
}

interface JobManagerProps {
  onJobUpdate?: (jobs: Job[]) => void
}

export default function JobManager({ onJobUpdate }: JobManagerProps) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [isVisible, setIsVisible] = useState(true)

  // Timer to update running job status
  useEffect(() => {
    const interval = setInterval(() => {
      setJobs(prevJobs => [...prevJobs]) // Force re-render to update elapsed time
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  // Notify parent of job updates
  useEffect(() => {
    if (onJobUpdate) {
      onJobUpdate(jobs)
    }
  }, [jobs, onJobUpdate])

  const addJob = (input: string, source: string) => {
    const newJob: Job = {
      id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      input,
      status: 'pending',
      source
    }
    setJobs(prev => [...prev, newJob])
    return newJob.id
  }

  const updateJobStatus = (jobId: string, status: Job['status'], result?: unknown) => {
    setJobs(prev => prev.map(job => {
      if (job.id === jobId) {
        const updatedJob = { ...job, status }
        if (status === 'running' && !job.startTime) {
          updatedJob.startTime = Date.now()
        }
        if ((status === 'completed' || status === 'failed') && !job.endTime) {
          updatedJob.endTime = Date.now()
          updatedJob.result = result
        }
        return updatedJob
      }
      return job
    }))
  }

  const clearCompletedJobs = () => {
    setJobs(prev => prev.filter(job => job.status === 'running' || job.status === 'pending'))
  }

  const clearAllJobs = () => {
    setJobs([])
  }

  const getElapsedTime = (job: Job) => {
    if (!job.startTime) return 0
    const endTime = job.endTime || Date.now()
    return Math.floor((endTime - job.startTime) / 1000)
  }

  const getStatusIcon = (status: Job['status']) => {
    switch (status) {
      case 'pending': return '⏸️'
      case 'running': return '🔄'
      case 'completed': return '✅'
      case 'failed': return '❌'
      default: return '❓'
    }
  }

  const getStatusColor = (status: Job['status']) => {
    switch (status) {
      case 'pending': return 'text-yellow-600 dark:text-yellow-400'
      case 'running': return 'text-blue-600 dark:text-blue-400'
      case 'completed': return 'text-green-600 dark:text-green-400'
      case 'failed': return 'text-red-600 dark:text-red-400'
      default: return 'text-gray-600 dark:text-gray-400'
    }
  }

  const runningJobs = jobs.filter(job => job.status === 'running').length
  const completedJobs = jobs.filter(job => job.status === 'completed').length
  const failedJobs = jobs.filter(job => job.status === 'failed').length

  // Make the component globally accessible for other components to use
  useEffect(() => {
    (window as unknown as { jobManager?: { addJob: typeof addJob; updateJobStatus: typeof updateJobStatus; jobs: Job[] } }).jobManager = {
      addJob,
      updateJobStatus,
      jobs
    }
  }, [jobs])

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        className="fixed bottom-4 right-4 w-12 h-12 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center z-50 transition-colors"
      >
        📊
      </button>
    )
  }

  return (
    <div className={`fixed bottom-4 right-4 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 transition-all duration-300 ${
      isExpanded ? 'w-96' : 'w-72'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-600">
        <div className="flex items-center space-x-2">
          <span className="text-lg">📊</span>
          <h3 className="font-semibold text-gray-900 dark:text-white">Job Manager</h3>
          {jobs.length > 0 && (
            <span className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-full text-gray-600 dark:text-gray-300">
              {jobs.length}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? '📉' : '📈'}
          </button>
          <button
            onClick={() => setIsVisible(false)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors text-gray-500 dark:text-gray-400"
            title="Minimize"
          >
            ➖
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="p-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
        <div className="flex justify-between text-sm">
          <span className="text-blue-600 dark:text-blue-400">Running: {runningJobs}</span>
          <span className="text-green-600 dark:text-green-400">Completed: {completedJobs}</span>
          <span className="text-red-600 dark:text-red-400">Failed: {failedJobs}</span>
        </div>
      </div>

      {/* Job List */}
      <div className={`${isExpanded ? 'max-h-96' : 'max-h-64'} overflow-y-auto`}>
        {jobs.length === 0 ? (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
            No jobs yet
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-600">
            {jobs.slice().reverse().map((job) => (
              <div key={job.id} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="text-sm">{getStatusIcon(job.status)}</span>
                      <span className={`text-xs font-medium ${getStatusColor(job.status)}`}>
                        {job.status.toUpperCase()}
                      </span>
                      {job.status === 'running' && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {getElapsedTime(job)}s
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-900 dark:text-white truncate" title={job.input}>
                      &quot;{job.input}&quot;
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        from {job.source}
                      </span>
                      {job.status === 'completed' && typeof job.result === 'object' && job.result && 'reversed' in job.result && (
                        <span className="text-xs text-green-600 dark:text-green-400" title={`Result: ${(job.result as { reversed?: string }).reversed ?? ''}`}>
                          → &quot;{(job.result as { reversed?: string }).reversed}&quot;
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      {jobs.length > 0 && (
        <div className="p-3 border-t border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
          <div className="flex space-x-2">
            <button
              onClick={clearCompletedJobs}
              className="flex-1 px-3 py-1 text-xs bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded transition-colors"
            >
              Clear Completed
            </button>
            <button
              onClick={clearAllJobs}
              className="flex-1 px-3 py-1 text-xs bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded transition-colors"
            >
              Clear All
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


