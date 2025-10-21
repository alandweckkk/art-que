'use client'

import { useState, useEffect } from 'react'
import { StickerEdit } from '@/types/sticker'
import { supabase } from '@/lib/supabase'

interface TableViewOverlayProps {
  onClose: () => void
  onSelectRecord: (index: number, record: StickerEdit) => void
  currentRecordId?: string // To highlight current record
}

interface PaginatedData {
  records: StickerEdit[]
  totalCount: number
  currentPage: number
  pageSize: number
  sortMode: 'priority' | 'newest'
}

export default function TableViewOverlay({ onClose, onSelectRecord, currentRecordId }: TableViewOverlayProps) {
  const [tableData, setTableData] = useState<PaginatedData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load table data for specific page using the original working query
  const loadTablePage = async (page: number = 1, pageSize: number = 50, sortMode: 'priority' | 'newest' = 'newest') => {
    setLoading(true)
    setError(null)
    
    try {
      // Use the exact same query logic from the original working implementation
      console.log('🔍 Fetching table data with original working query...')
      
      // Step 1: Get all y_sticker_edits with model_run data
      const { data: stickerEdits, error: stickerError } = await supabase
        .from('y_sticker_edits')
        .select(`
          id,
          status,
          urgency,
          image_history,
          internal_note,
          created_at,
          updated_at,
          model_run!y_sticker_edits_model_run_id_fkey (
            id,
            user_id,
            feedback_notes,
            input_image_url,
            output_image_url,
            preprocessed_output_image_url,
            created_at,
            reaction,
            feedback_addressed
          )
        `)
        .gte('created_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())

      if (stickerError) throw stickerError
      if (!stickerEdits) throw new Error('No data returned')

      console.log(`📊 Found ${stickerEdits.length} records`)

      // Filter out records where model_run data is missing or doesn't meet criteria
      const validEdits = stickerEdits.filter(edit => {
        const modelRun = Array.isArray(edit.model_run) ? edit.model_run[0] : edit.model_run
        return modelRun && 
               modelRun.reaction === 'negative' && 
               !modelRun.feedback_addressed
      })

      // Step 2: Get user emails for all users
      const userIds = [...new Set(validEdits.map(edit => {
        const modelRun = Array.isArray(edit.model_run) ? edit.model_run[0] : edit.model_run
        return modelRun?.user_id?.toString()
      }).filter(Boolean))]
      
      const { data: userEmails, error: emailError } = await supabase
        .from('users_populated')
        .select('id, email')
        .in('id', userIds)

      // Create email lookup map
      const userEmailMap: Record<string, string> = {}
      if (userEmails && !emailError) {
        userEmails.forEach(user => {
          if (user.id && user.email) {
            userEmailMap[user.id] = user.email
          }
        })
      }

      // Step 3: Fetch Stripe spending data for all users
      const { data: stripeData, error: stripeError } = await supabase
        .from('stripe_captured_events')
        .select('user_id, amount, pack_type')
        .in('user_id', userIds)

      // Calculate total spending per user
      const userSpending: Record<string, number> = {}
      if (stripeData && !stripeError) {
        stripeData.forEach(event => {
          if (event.user_id && event.amount) {
            userSpending[event.user_id] = (userSpending[event.user_id] || 0) + event.amount
          }
        })
      }

      // Step 4: Apply sorting (same logic as original)
      let sortedEdits
      if (sortMode === 'newest') {
        sortedEdits = [...validEdits].sort((a, b) => {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        })
      } else {
        // Priority sorting (exact 4-bucket system from original)
        sortedEdits = [...validEdits].sort((a, b) => {
          const aModelRun = Array.isArray(a.model_run) ? a.model_run[0] : a.model_run
          const bModelRun = Array.isArray(b.model_run) ? b.model_run[0] : b.model_run
          
          // Get user spending totals
          const aSpending = userSpending[aModelRun?.user_id?.toString() || ''] || 0
          const bSpending = userSpending[bModelRun?.user_id?.toString() || ''] || 0
          
          // Check for mail order customers
          const aHasMailOrder = stripeData?.some(event => 
            event.user_id === aModelRun?.user_id?.toString() && event.pack_type === 'mail_order'
          ) || false
          const bHasMailOrder = stripeData?.some(event => 
            event.user_id === bModelRun?.user_id?.toString() && event.pack_type === 'mail_order'
          ) || false
          
          // Check for urgency
          const aHasUrgency = a.urgency !== null && a.urgency !== undefined
          const bHasUrgency = b.urgency !== null && b.urgency !== undefined
          
          // Bucket 1: Urgency items come first
          if (aHasUrgency && !bHasUrgency) return -1
          if (!aHasUrgency && bHasUrgency) return 1
          if (aHasUrgency && bHasUrgency) {
            // Within urgency bucket: higher urgency first, then older created_at
            if (a.urgency !== b.urgency) {
              const urgencyMap = { 'do it now': 3, 'very high': 2, 'high': 1 }
              const aUrgencyNum = urgencyMap[a.urgency as keyof typeof urgencyMap] || 0
              const bUrgencyNum = urgencyMap[b.urgency as keyof typeof urgencyMap] || 0
              return bUrgencyNum - aUrgencyNum // Higher urgency first
            }
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          }
          
          // Bucket 2: Mail order customers
          if (aHasMailOrder && !bHasMailOrder) return -1
          if (!aHasMailOrder && bHasMailOrder) return 1
          if (aHasMailOrder && bHasMailOrder) {
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          }
          
          // Bucket 3: High spenders (>$9)
          const aIsHighSpender = aSpending > 9
          const bIsHighSpender = bSpending > 9
          
          if (aIsHighSpender && !bIsHighSpender) return -1
          if (!aIsHighSpender && bIsHighSpender) return 1
          if (aIsHighSpender && bIsHighSpender) {
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          }
          
          // Bucket 4: Remainder
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        })
      }

      // Step 5: Apply pagination to sorted data
      const totalCount = sortedEdits.length
      const startIndex = (page - 1) * pageSize
      const endIndex = startIndex + pageSize
      const paginatedEdits = sortedEdits.slice(startIndex, endIndex)

      // Step 6: Transform to interface format (same as original)
      const transformedData: StickerEdit[] = paginatedEdits.map((stickerEdit) => {
        const modelRun = Array.isArray(stickerEdit.model_run) ? stickerEdit.model_run[0] : stickerEdit.model_run
        const userEmail = userEmailMap[modelRun?.user_id?.toString() || ''] || 'No email'
        const spending = userSpending[modelRun?.user_id?.toString() || ''] || 0
        const hasMailOrder = stripeData?.some(event => 
          event.user_id === modelRun?.user_id?.toString() && event.pack_type === 'mail_order'
        ) || false
        
        // Determine bucket (exact same logic as original)
        let bucket: 'Urgent' | 'Big Spender' | 'Print Order' | 'Remainder'
        if (stickerEdit.urgency !== null && stickerEdit.urgency !== undefined) {
          bucket = 'Urgent'
        } else if (hasMailOrder) {
          bucket = 'Print Order'
        } else if (spending > 9) {
          bucket = 'Big Spender'
        } else {
          bucket = 'Remainder'
        }

        return {
          sticker_edit_id: stickerEdit.id.toString(),
          model_run_id: modelRun?.id || '',
          status: stickerEdit.status || 'unresolved',
          urgency: stickerEdit.urgency || null,
          bucket,
          customer_email: userEmail,
          customer_name: `User ${modelRun?.user_id || 'unknown'}`,
          feedback_notes: modelRun?.feedback_notes || '',
          input_image_url: modelRun?.input_image_url || '',
          output_image_url: modelRun?.output_image_url || '',
          preprocessed_output_image_url: modelRun?.preprocessed_output_image_url || '',
          initial_edit_image_url: stickerEdit.image_history?.[0]?.image_url || '',
          image_history: stickerEdit.image_history || [],
          internal_note: stickerEdit.internal_note || null,
          amount_spent: spending,
          purchased_at: modelRun?.created_at || '',
          edit_created_at: stickerEdit.created_at,
          edit_updated_at: stickerEdit.updated_at,
          days_since_created: Math.floor((Date.now() - new Date(stickerEdit.created_at).getTime()) / (1000 * 60 * 60 * 24)),
          hours_since_created: Math.floor((Date.now() - new Date(stickerEdit.created_at).getTime()) / (1000 * 60 * 60)),
          minutes_since_created: Math.floor((Date.now() - new Date(stickerEdit.created_at).getTime()) / (1000 * 60)),
          time_spent_on_edit: stickerEdit.updated_at ? 
            Math.floor((new Date(stickerEdit.updated_at).getTime() - new Date(stickerEdit.created_at).getTime()) / (1000 * 60)) : 0,
          image_count: (stickerEdit.image_history || []).length,
          urgency_priority: stickerEdit.urgency || 0,
          last_activity_relative: formatTimeAgo(new Date(stickerEdit.updated_at)),
          created_at_formatted: new Date(stickerEdit.created_at).toLocaleDateString(),
          purchase_to_edit_delay: 0 // Could calculate if needed
        }
      })

      setTableData({
        records: transformedData,
        totalCount,
        currentPage: page,
        pageSize,
        sortMode
      })

      console.log(`✅ Loaded ${transformedData.length} table records for page ${page}`)

    } catch (err) {
      console.error('Error loading table data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load table data')
    } finally {
      setLoading(false)
    }
  }


  // Helper function to format time ago
  const formatTimeAgo = (date: Date): string => {
    const now = Date.now()
    const diffMs = now - date.getTime()
    const minutes = Math.floor(diffMs / (1000 * 60))
    
    if (minutes < 60) {
      return `${Math.max(1, minutes)} minute${minutes !== 1 ? 's' : ''} ago`
    }
    
    const hours = Math.floor(minutes / 60)
    if (hours < 24) {
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`
    }
    
    const days = Math.floor(hours / 24)
    return `${days} day${days !== 1 ? 's' : ''} ago`
  }

  // Load first page when component mounts (default to newest)
  useEffect(() => {
    loadTablePage(1, 50, 'newest')
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

  const getBucketColor = (bucket: string) => {
    switch (bucket) {
      case 'Urgent': return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-200'
      case 'Big Spender': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-200'
      case 'Print Order': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-200'
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-200'
    }
  }

  const getUrgencyColor = (urgency: string | number | null) => {
    if (!urgency) return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-200'
    
    const urgencyNum = typeof urgency === 'string' ? parseInt(urgency) : urgency
    
    if (urgencyNum >= 4) return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-200'
    if (urgencyNum >= 3) return 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-200'
    if (urgencyNum >= 2) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200'
    return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-200'
  }

  const totalPages = tableData ? Math.ceil(tableData.totalCount / tableData.pageSize) : 0

  return (
    <div className="fixed inset-0 z-[10000] flex items-end justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 transition-opacity duration-300"
        onClick={onClose}
      />
      
      {/* Table Container */}
      <div className="relative bg-white dark:bg-gray-800 rounded-t-2xl shadow-2xl w-full mx-2 mb-0 animate-slide-up h-[95vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Table View
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {tableData ? `${tableData.totalCount} records total` : 'Loading...'}
            </p>
          </div>
          
          {/* Sort and Pagination Controls */}
          {tableData && (
            <div className="flex items-center gap-4">
              {/* Sort Dropdown */}
              <select
                value={tableData.sortMode}
                onChange={(e) => {
                  const newSortMode = e.target.value as 'priority' | 'newest'
                  loadTablePage(1, tableData.pageSize, newSortMode)
                }}
                className="text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 px-3 py-1 rounded-lg shadow border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="newest">Newest</option>
                <option value="priority">Priority</option>
              </select>
              
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Page {tableData.currentPage} of {totalPages}
              </span>
              
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-400">Loading table data...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <p className="text-red-600 dark:text-red-400 mb-2">Error loading data</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
                <button
                  onClick={() => loadTablePage(tableData?.currentPage || 1, 50, tableData?.sortMode || 'newest')}
                  className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : tableData ? (
            <div className="overflow-auto h-full">
              <table className="w-full">
                {/* Table Header */}
                <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Customer
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Bucket
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Feedback
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Images
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Edit History
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Spent
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Created At
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Urgency
                    </th>
                  </tr>
                </thead>

                {/* Table Body */}
                <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                  {tableData.records.map((record, index) => (
                    <tr
                      key={record.sticker_edit_id}
                      className={`transition-colors duration-200 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${
                        record.model_run_id === currentRecordId
                          ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500'
                          : ''
                      }`}
                      onClick={() => onSelectRecord(index, record)}
                    >
                      {/* Position */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-sm font-medium">
                          {((tableData.currentPage - 1) * tableData.pageSize) + index + 1}
                        </div>
                      </td>

                      {/* Customer */}
                      <td className="px-4 py-3">
                        <div className="flex items-center">
                          <div className="w-8 h-8 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full flex items-center justify-center">
                            <span className="text-white font-semibold text-sm">
                              {record.customer_name ? record.customer_name.substring(0, 2).toUpperCase() : 'U'}
                            </span>
                          </div>
                          <div className="ml-3">
                            <div className="text-sm text-gray-900 dark:text-gray-200">
                              {record.customer_email}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {record.customer_name}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Bucket */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getBucketColor(record.bucket)}`}>
                          {record.bucket}
                        </span>
                      </td>

                      {/* Feedback */}
                      <td className="px-4 py-3 max-w-xs">
                        <p className="text-sm text-gray-900 dark:text-white truncate">
                          {record.feedback_notes}
                        </p>
                      </td>

                      {/* Images */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          {record.input_image_url && (
                            <img
                              src={record.input_image_url}
                              alt="Input"
                              className="w-10 h-10 rounded border object-cover"
                            />
                          )}
                          {record.output_image_url && (
                            <>
                              <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <img
                                src={record.output_image_url}
                                alt="Output"
                                className="w-10 h-10 rounded border object-cover"
                              />
                            </>
                          )}
                        </div>
                      </td>

                      {/* Edit History */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="space-y-1">
                          {record.image_history && record.image_history.length > 0 ? (
                            <div className="flex items-center space-x-1">
                              {record.image_history.slice(0, 3).map((historyEntry, histIndex) => (
                                <div key={histIndex} className="relative group">
                                  <div 
                                    className="w-8 h-8 rounded border-2 border-purple-400 hover:border-purple-600 transition-colors cursor-pointer overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center"
                                    onClick={() => window.open(historyEntry.image_url, '_blank')}
                                  >
                                    <img
                                      src={historyEntry.image_url}
                                      alt={`Edit ${histIndex + 1}`}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        e.currentTarget.style.display = 'none'
                                      }}
                                    />
                                  </div>
                                  <div className="absolute -top-6 left-0 bg-black text-white text-xs px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                                    Edit {histIndex + 1}
                                  </div>
                                </div>
                              ))}
                              {record.image_history.length > 3 && (
                                <div className="text-xs text-gray-500">+{record.image_history.length - 3}</div>
                              )}
                            </div>
                          ) : (
                            <div className="text-center">
                              <div className="text-xs text-gray-400 dark:text-gray-500 italic mb-1">
                                No edits yet
                              </div>
                              <div className="w-2 h-2 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto"></div>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Spent */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-gray-900 dark:text-white font-medium">
                          ${(record.amount_spent || 0).toFixed(2)}
                        </span>
                      </td>

                      {/* Created At */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm">
                          <div className="text-gray-900 dark:text-white font-medium">
                            {record.last_activity_relative}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {record.created_at_formatted}
                          </div>
                        </div>
                      </td>

                      {/* Urgency */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {record.urgency ? (
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getUrgencyColor(record.urgency)}`}>
                            {record.urgency}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* Footer with Pagination */}
        {tableData && totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Showing {((tableData.currentPage - 1) * tableData.pageSize) + 1} to{' '}
              {Math.min(tableData.currentPage * tableData.pageSize, tableData.totalCount)} of{' '}
              {tableData.totalCount} results
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={() => loadTablePage(tableData.currentPage - 1, tableData.pageSize, tableData.sortMode)}
                disabled={tableData.currentPage <= 1 || loading}
                className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                Previous
              </button>
              
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Page {tableData.currentPage} of {totalPages}
              </span>
              
              <button
                onClick={() => loadTablePage(tableData.currentPage + 1, tableData.pageSize, tableData.sortMode)}
                disabled={tableData.currentPage >= totalPages || loading}
                className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
