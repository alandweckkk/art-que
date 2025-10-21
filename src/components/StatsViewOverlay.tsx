'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

interface StatsViewOverlayProps {
  onClose: () => void
}

interface EmailRecord {
  id: string
  created_at: string
  subject_line: string
  message: string
  seen: boolean
  seen_at: string | null
  conversation_id: string
  model_run_id: string | null
  link_views: number | null
  payload: {
    recipients?: Array<{
      role: string
      handle: string
      name?: string
    }>
    target?: {
      data?: {
        recipients?: Array<{
          role: string
          handle: string
          name?: string
        }>
      }
    }
  }
}

export default function StatsViewOverlay({ onClose }: StatsViewOverlayProps) {
  const [emailData, setEmailData] = useState<EmailRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Extract recipient email from payload
  const getRecipientEmail = (email: EmailRecord): string => {
    try {
      // Try new webhook structure first (payload.recipients)
      let recipients = email.payload?.recipients || []
      
      // Fall back to old structure (payload.target.data.recipients)
      if (!recipients || recipients.length === 0) {
        recipients = email.payload?.target?.data?.recipients || []
      }
      
      const toRecipient = recipients.find(r => r.role === 'to')
      return toRecipient?.handle || 'N/A'
    } catch (err) {
      console.error('Error extracting recipient:', err)
      return 'N/A'
    }
  }

  // Load email history data
  useEffect(() => {
    const loadEmailHistory = async () => {
      setLoading(true)
      setError(null)
      
      try {
        console.log('📧 Fetching email history with link views...')
        
        // Get email history filtered by reason='sticker_edit' (artwork fixes sent to customers)
        const { data: emailHistory, error: fetchError } = await supabase
          .from('z_email_history')
          .select('id, created_at, subject_line, message, seen, seen_at, conversation_id, model_run_id, payload')
          .eq('source', 'front')
          .eq('type', 'outbound')
          .eq('reason', 'sticker_edit')
          .order('created_at', { ascending: false })
          .limit(50)

        if (fetchError) throw fetchError
        if (!emailHistory) throw new Error('No data returned')

        // Get unique model_run_ids
        const modelRunIds = [...new Set(emailHistory.map(e => e.model_run_id).filter(Boolean))] as string[]
        
        // Fetch link views for all model_runs in one query
        const { data: modelRuns } = await supabase
          .from('model_run')
          .select('id, sticker_edit_views')
          .in('id', modelRunIds)
        
        // Create lookup map
        const linkViewsMap: Record<string, number> = {}
        modelRuns?.forEach(mr => {
          if (mr.id) {
            linkViewsMap[mr.id] = mr.sticker_edit_views || 0
          }
        })
        
        // Merge link views into email data
        const enrichedData = emailHistory.map(email => ({
          ...email,
          link_views: email.model_run_id ? (linkViewsMap[email.model_run_id] ?? null) : null
        }))

        console.log(`✅ Loaded ${enrichedData.length} email records with link views`)
        setEmailData(enrichedData)
        
      } catch (err) {
        console.error('Error loading email history:', err)
        setError(err instanceof Error ? err.message : 'Failed to load email history')
      } finally {
        setLoading(false)
      }
    }

    loadEmailHistory()
  }, [])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Format date to readable format
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    // If within last hour, show minutes
    if (diffMins < 60) {
      return `${diffMins}m ago`
    }
    // If within last 24 hours, show hours
    if (diffHours < 24) {
      return `${diffHours}h ago`
    }
    // If within last 7 days, show days
    if (diffDays < 7) {
      return `${diffDays}d ago`
    }
    // Otherwise show date
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  // Truncate message for preview
  const truncateMessage = (message: string, maxLength: number = 100): string => {
    if (message.length <= maxLength) return message
    return message.substring(0, maxLength) + '...'
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-end justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 transition-opacity duration-300"
        onClick={onClose}
      />
      
      {/* Stats Container */}
      <div className="relative bg-white dark:bg-gray-800 rounded-t-2xl shadow-2xl w-full mx-2 mb-0 animate-slide-up h-[95vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Stats View - Email History
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {loading ? 'Loading...' : `${emailData.length} outbound emails from Front`}
            </p>
          </div>
          
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-400">Loading email history...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <p className="text-red-600 dark:text-red-400 mb-2">Error loading data</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
              </div>
            </div>
          ) : (
            <div className="overflow-auto h-full">
              <table className="w-full">
                {/* Table Header */}
                <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Sent
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Recipient
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Subject
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Message Preview
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Link Views
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Seen At
                    </th>
                  </tr>
                </thead>

                {/* Table Body */}
                <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                  {emailData.map((email, index) => (
                    <tr
                      key={email.id}
                      className="transition-colors duration-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      {/* Number */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/20 flex items-center justify-center text-sm font-medium text-purple-800 dark:text-purple-200">
                          {index + 1}
                        </div>
                      </td>

                      {/* Sent Time */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-gray-200">
                          {formatDate(email.created_at)}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {new Date(email.created_at).toLocaleTimeString('en-US', { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                          })}
                        </div>
                      </td>

                      {/* Recipient */}
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-900 dark:text-gray-200 font-medium">
                          {getRecipientEmail(email)}
                        </div>
                      </td>

                      {/* Subject */}
                      <td className="px-4 py-3 max-w-xs">
                        <div className="text-sm text-gray-900 dark:text-gray-200 truncate">
                          {email.subject_line || '(No subject)'}
                        </div>
                      </td>

                      {/* Message Preview */}
                      <td className="px-4 py-3 max-w-md">
                        <div className="text-sm text-gray-600 dark:text-gray-400 truncate">
                          {truncateMessage(email.message || '')}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        {email.seen ? (
                          <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-200">
                            ✓ Seen
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
                            ○ Not seen
                          </span>
                        )}
                      </td>

                      {/* Link Views */}
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        {email.link_views !== null && email.link_views !== undefined ? (
                          <div className="flex items-center justify-center">
                            <span className={`inline-flex items-center px-2 py-1 text-sm font-semibold rounded-full ${
                              email.link_views > 0 
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-200'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-900/20 dark:text-gray-400'
                            }`}>
                              👁️ {email.link_views}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400 dark:text-gray-500">-</span>
                        )}
                      </td>

                      {/* Seen At */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {email.seen_at ? (
                          <div>
                            <div className="text-sm text-gray-900 dark:text-gray-200">
                              {formatDate(email.seen_at)}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {new Date(email.seen_at).toLocaleTimeString('en-US', { 
                                hour: '2-digit', 
                                minute: '2-digit' 
                              })}
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400 dark:text-gray-500">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

