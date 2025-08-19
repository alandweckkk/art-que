'use client'

import { useState, useEffect } from 'react'

interface TableRow {
  id: string
  images: number
  preGenerated: boolean
  badge: string
  spent: number
  print: boolean
  recent: boolean
  customer: string
  urgency: 'Low' | 'Medium' | 'High'
  updatedAt: string
}

interface JobState {
  isRunning: boolean
  input: string
  result: any
  startTime?: number
}

const mockData: TableRow[] = [
  {
    id: '1',
    images: 12,
    preGenerated: true,
    badge: 'Premium',
    spent: 245.50,
    print: true,
    recent: false,
    customer: 'John Smith',
    urgency: 'High',
    updatedAt: '2024-01-15 14:30'
  },
  {
    id: '2',
    images: 8,
    preGenerated: false,
    badge: 'Standard',
    spent: 89.75,
    print: false,
    recent: true,
    customer: 'Sarah Johnson',
    urgency: 'Medium',
    updatedAt: '2024-01-15 12:15'
  },
  {
    id: '3',
    images: 24,
    preGenerated: true,
    badge: 'VIP',
    spent: 567.20,
    print: true,
    recent: true,
    customer: 'Mike Davis',
    urgency: 'Low',
    updatedAt: '2024-01-15 09:45'
  }
]

export default function Main() {
  const [data, setData] = useState<TableRow[]>(mockData)
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table')
  const [currentCardIndex, setCurrentCardIndex] = useState(0)
  
  // Edge Function test states
  const [testWord, setTestWord] = useState('sticker')
  const [isTestLoading, setIsTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)
  
  // Job states for each record
  const [jobStates, setJobStates] = useState<Record<string, JobState>>(() => {
    const initialStates: Record<string, JobState> = {}
    mockData.forEach(row => {
      initialStates[row.id] = {
        isRunning: false,
        input: '',
        result: null
      }
    })
    return initialStates
  })

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'High': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
      case 'Medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
      case 'Low': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
    }
  }

  const getBadgeColor = (badge: string) => {
    switch (badge) {
      case 'VIP': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
      case 'Premium': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
      case 'Standard': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
    }
  }

  const nextCard = () => {
    setCurrentCardIndex((prev) => (prev + 1) % data.length)
  }

  const prevCard = () => {
    setCurrentCardIndex((prev) => (prev - 1 + data.length) % data.length)
  }

  const currentCard = data[currentCardIndex]

  // Timer to update running job status
  useEffect(() => {
    const interval = setInterval(() => {
      // Force re-render to update elapsed time for running jobs
      setJobStates(prev => ({ ...prev }))
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const testSleepFunction = async () => {
    setIsTestLoading(true)
    setTestResult(null)
    
    try {
      const response = await fetch(
        `https://yqvsxaifoqoohljhidrp.supabase.co/functions/v1/sleep?word=${encodeURIComponent(testWord)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      )
      
      const result = await response.json()
      setTestResult(result)
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setIsTestLoading(false)
    }
  }

  const updateJobInput = (recordId: string, input: string) => {
    setJobStates(prev => ({
      ...prev,
      [recordId]: {
        ...prev[recordId],
        input
      }
    }))
  }

  const submitJob = async (recordId: string) => {
    const jobInput = jobStates[recordId]?.input || 'hello'
    
    // Update job state to running
    setJobStates(prev => ({
      ...prev,
      [recordId]: {
        ...prev[recordId],
        isRunning: true,
        startTime: Date.now(),
        result: null
      }
    }))

    try {
      const response = await fetch(
        `https://yqvsxaifoqoohljhidrp.supabase.co/functions/v1/sleep?word=${encodeURIComponent(jobInput)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      )
      
      const result = await response.json()
      
      // Update job state with result
      setJobStates(prev => ({
        ...prev,
        [recordId]: {
          ...prev[recordId],
          isRunning: false,
          result
        }
      }))
    } catch (error) {
      // Update job state with error
      setJobStates(prev => ({
        ...prev,
        [recordId]: {
          ...prev[recordId],
          isRunning: false,
          result: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        }
      }))
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                Art Queue Dashboard
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                Manage your art projects and customer orders
              </p>
            </div>
            
            {/* View Toggle */}
            <div className="flex bg-white dark:bg-gray-800 rounded-lg p-1 shadow-sm border border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setViewMode('table')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'table'
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Table View
              </button>
              <button
                onClick={() => setViewMode('card')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'card'
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Card View
              </button>
            </div>
          </div>
        </div>

        {/* Edge Function Test Section */}
        <div className="mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              🚀 Sleep Edge Function Test
            </h3>
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Test Word
                </label>
                <input
                  type="text"
                  value={testWord}
                  onChange={(e) => setTestWord(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Enter a word to reverse..."
                />
              </div>
              <button
                onClick={testSleepFunction}
                disabled={isTestLoading}
                className="px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors duration-200 whitespace-nowrap"
              >
                {isTestLoading ? '⏳ Sleeping...' : '😴 Test Sleep (30s)'}
              </button>
            </div>
            
            {/* Results */}
            {testResult && (
              <div className="mt-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-700">
                {testResult.success ? (
                  <div className="space-y-2">
                    <div className="text-green-600 dark:text-green-400 font-medium">
                      ✅ Success!
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      <strong>Original:</strong> "{testResult.original}"
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      <strong>Reversed:</strong> "{testResult.reversed}"
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      <strong>Sleep Time:</strong> {Math.round(testResult.sleepTimeMs / 1000)}s
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {testResult.message}
                    </div>
                  </div>
                ) : (
                  <div className="text-red-600 dark:text-red-400">
                    ❌ Error: {testResult.error}
                  </div>
                )}
              </div>
            )}
            
            <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              This function sleeps for 30 seconds then returns your word with letters reversed.
            </div>
          </div>
        </div>

        {/* Content Area */}
        {viewMode === 'table' ? (
          /* Table Container */
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full">
              {/* Table Header */}
              <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Images
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Pre-Generated
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Badge
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Spent
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Print
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Recent?
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Customer
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Urgency
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Updated At
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Job Queue
                  </th>
                </tr>
              </thead>

              {/* Table Body */}
              <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                {data.map((row) => (
                  <tr 
                    key={row.id} 
                    className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200"
                  >
                    {/* Images */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                          <span className="text-blue-600 dark:text-blue-300 font-semibold text-sm">
                            {row.images}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Pre-Generated */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        {row.preGenerated ? (
                          <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        ) : (
                          <div className="w-5 h-5 bg-gray-300 dark:bg-gray-600 rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-gray-500 dark:text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Badge */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getBadgeColor(row.badge)}`}>
                        {row.badge}
                      </span>
                    </td>

                    {/* Spent */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-gray-900 dark:text-white font-medium">
                        ${row.spent.toFixed(2)}
                      </span>
                    </td>

                    {/* Print */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        {row.print ? (
                          <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" />
                            </svg>
                          </div>
                        ) : (
                          <div className="w-5 h-5 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
                        )}
                      </div>
                    </td>

                    {/* Recent */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        {row.recent ? (
                          <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                            Recent
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500 text-sm">-</span>
                        )}
                      </div>
                    </td>

                    {/* Customer */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full flex items-center justify-center">
                          <span className="text-white font-semibold text-sm">
                            {row.customer.split(' ').map(n => n[0]).join('').toUpperCase()}
                          </span>
                        </div>
                        <div className="ml-3">
                          <span className="text-gray-900 dark:text-white font-medium">
                            {row.customer}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Urgency */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getUrgencyColor(row.urgency)}`}>
                        {row.urgency}
                      </span>
                    </td>

                    {/* Updated At */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {row.updatedAt}
                    </td>

                    {/* Job Queue */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-2">
                        {/* Input and Submit */}
                        <div className="flex space-x-2">
                          <input
                            type="text"
                            value={jobStates[row.id]?.input || ''}
                            onChange={(e) => updateJobInput(row.id, e.target.value)}
                            placeholder="Enter text..."
                            disabled={jobStates[row.id]?.isRunning}
                            className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white disabled:opacity-50"
                          />
                          <button
                            onClick={() => submitJob(row.id)}
                            disabled={jobStates[row.id]?.isRunning || !jobStates[row.id]?.input?.trim()}
                            className="px-2 py-1 text-xs bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded transition-colors"
                          >
                            {jobStates[row.id]?.isRunning ? '⏳' : '▶️'}
                          </button>
                        </div>

                        {/* Job Status */}
                        {jobStates[row.id]?.isRunning && (
                          <div className="text-xs text-blue-600 dark:text-blue-400">
                            🔄 Running... ({Math.floor((Date.now() - (jobStates[row.id]?.startTime || 0)) / 1000)}s)
                          </div>
                        )}

                        {/* Results */}
                        {jobStates[row.id]?.result && (
                          <div className="text-xs">
                            {jobStates[row.id]?.result?.success ? (
                              <div className="text-green-600 dark:text-green-400">
                                ✅ "{jobStates[row.id]?.result?.reversed}"
                              </div>
                            ) : (
                              <div className="text-red-600 dark:text-red-400">
                                ❌ Error
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div className="bg-gray-50 dark:bg-gray-700 px-6 py-3 border-t border-gray-200 dark:border-gray-600">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Showing {data.length} results
              </div>
              <div className="flex space-x-2">
                <button className="px-3 py-1 text-sm bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-md hover:bg-gray-50 dark:hover:bg-gray-500 transition-colors">
                  Previous
                </button>
                <button className="px-3 py-1 text-sm bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-md hover:bg-gray-50 dark:hover:bg-gray-500 transition-colors">
                  Next
                </button>
              </div>
            </div>
            </div>
          </div>
        ) : (
          /* Card View */
          <div className="max-w-2xl mx-auto">
            {/* Navigation Header */}
            <div className="flex justify-between items-center mb-6">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Card {currentCardIndex + 1} of {data.length}
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={prevCard}
                  className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  <span>Previous</span>
                </button>
                <button
                  onClick={nextCard}
                  className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors flex items-center space-x-2"
                >
                  <span>Next</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Card */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 border border-gray-200 dark:border-gray-700">
              {/* Card Header */}
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full flex items-center justify-center">
                    <span className="text-white font-bold text-xl">
                      {currentCard.customer.split(' ').map(n => n[0]).join('').toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                      {currentCard.customer}
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400">
                      Updated {currentCard.updatedAt}
                    </p>
                  </div>
                </div>
                <span className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full ${getUrgencyColor(currentCard.urgency)}`}>
                  {currentCard.urgency} Priority
                </span>
              </div>

              {/* Card Content Grid */}
              <div className="grid md:grid-cols-2 gap-6">
                {/* Images */}
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Images</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                      <span className="text-blue-600 dark:text-blue-300 font-bold text-lg">
                        {currentCard.images}
                      </span>
                    </div>
                    <span className="text-2xl font-bold text-gray-900 dark:text-white">
                      {currentCard.images} Images
                    </span>
                  </div>
                </div>

                {/* Badge */}
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Badge</span>
                  </div>
                  <span className={`inline-flex px-4 py-2 text-lg font-semibold rounded-full ${getBadgeColor(currentCard.badge)}`}>
                    {currentCard.badge}
                  </span>
                </div>

                {/* Spent */}
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Amount Spent</span>
                  </div>
                  <span className="text-3xl font-bold text-gray-900 dark:text-white">
                    ${currentCard.spent.toFixed(2)}
                  </span>
                </div>

                {/* Status Indicators */}
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</span>
                  </div>
                  <div className="space-y-3">
                    {/* Pre-Generated */}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-700 dark:text-gray-300">Pre-Generated</span>
                      <div className="flex items-center">
                        {currentCard.preGenerated ? (
                          <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        ) : (
                          <div className="w-6 h-6 bg-gray-300 dark:bg-gray-600 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Print */}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-700 dark:text-gray-300">Print Ready</span>
                      <div className="flex items-center">
                        {currentCard.print ? (
                          <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" />
                            </svg>
                          </div>
                        ) : (
                          <div className="w-6 h-6 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
                        )}
                      </div>
                    </div>

                    {/* Recent */}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-700 dark:text-gray-300">Recent Activity</span>
                      <div className="flex items-center">
                        {currentCard.recent ? (
                          <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                            Recent
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500 text-sm">-</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Job Queue Section */}
                <div className="md:col-span-2 bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Job Queue</span>
                  </div>
                  
                  {/* Input and Submit */}
                  <div className="flex space-x-3 mb-3">
                    <input
                      type="text"
                      value={jobStates[currentCard.id]?.input || ''}
                      onChange={(e) => updateJobInput(currentCard.id, e.target.value)}
                      placeholder="Enter text to process..."
                      disabled={jobStates[currentCard.id]?.isRunning}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-600 dark:text-white disabled:opacity-50"
                    />
                    <button
                      onClick={() => submitJob(currentCard.id)}
                      disabled={jobStates[currentCard.id]?.isRunning || !jobStates[currentCard.id]?.input?.trim()}
                      className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded-md transition-colors font-medium"
                    >
                      {jobStates[currentCard.id]?.isRunning ? '⏳ Processing...' : '▶️ Submit Job'}
                    </button>
                  </div>

                  {/* Job Status */}
                  {jobStates[currentCard.id]?.isRunning && (
                    <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md">
                      <div className="flex items-center space-x-2">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                          Job running... ({Math.floor((Date.now() - (jobStates[currentCard.id]?.startTime || 0)) / 1000)}s elapsed)
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Results */}
                  {jobStates[currentCard.id]?.result && (
                    <div className={`p-3 rounded-md ${
                      jobStates[currentCard.id]?.result?.success 
                        ? 'bg-green-50 dark:bg-green-900/20' 
                        : 'bg-red-50 dark:bg-red-900/20'
                    }`}>
                      {jobStates[currentCard.id]?.result?.success ? (
                        <div className="space-y-2">
                          <div className="text-green-600 dark:text-green-400 font-medium flex items-center space-x-2">
                            <span>✅</span>
                            <span>Job completed successfully!</span>
                          </div>
                          <div className="text-sm text-gray-700 dark:text-gray-300">
                            <strong>Original:</strong> "{jobStates[currentCard.id]?.result?.original}"
                          </div>
                          <div className="text-sm text-gray-700 dark:text-gray-300">
                            <strong>Reversed:</strong> "{jobStates[currentCard.id]?.result?.reversed}"
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            Completed in {Math.round(jobStates[currentCard.id]?.result?.sleepTimeMs / 1000)}s
                          </div>
                        </div>
                      ) : (
                        <div className="text-red-600 dark:text-red-400 font-medium flex items-center space-x-2">
                          <span>❌</span>
                          <span>Job failed: {jobStates[currentCard.id]?.result?.error}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
