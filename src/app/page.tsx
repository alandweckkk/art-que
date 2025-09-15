"use client"

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import ReactFlowCanvas from '@/components/ReactFlowCanvas'
import JobManager from '@/components/JobManager'
import HelpTooltip from '@/components/HelpTooltip'
import GlobalSearch from '@/components/GlobalSearch'
import TableViewOverlay from '@/components/TableViewOverlay'
import { StickerEdit } from '@/types/sticker'

export default function Home() {
  const [stickerData, setStickerData] = useState<StickerEdit[]>([])
  const [loading, setLoading] = useState(true)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [sortMode, setSortMode] = useState<'priority' | 'newest'>('newest')
  const [isEditingPageNumber, setIsEditingPageNumber] = useState(false)
  const [pageNumberInput, setPageNumberInput] = useState('')
  const [showTableOverlay, setShowTableOverlay] = useState(false)

  useEffect(() => {
    fetchStickerData()
  }, [sortMode])

  const fetchStickerData = async () => {
    try {
      console.log('🔍 Fetching sticker data with original working query...')
      
      // Use the exact working query from the original interface
      const { data: stickerEdits, error } = await supabase
        .from('model_run')
        .select(`
          id,
          user_id,
          feedback_notes,
          input_image_url,
          output_image_url,
          preprocessed_output_image_url,
          created_at,
          updated_at,
          feedback_addressed,
          reaction,
          y_sticker_edits!y_sticker_edits_model_run_id_fkey (
            id,
            status,
            urgency,
            created_at,
            updated_at,
            image_history
          )
        `)
        .eq('reaction', 'negative')
        .not('feedback_addressed', 'is', true)
        .gte('created_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching sticker edits:', error)
        return
      }

      if (stickerEdits) {
        console.log(`📊 Found ${stickerEdits.length} records`)
        
        // Get unique user IDs to fetch email and spending data
        const userIds = [...new Set(stickerEdits
          .map(modelRun => modelRun.user_id)
          .filter(Boolean)
        )]

        // Fetch user emails
        const { data: userEmails, error: emailError } = await supabase
          .from('users_populated')
          .select('id, email')
          .in('id', userIds)

        const userEmailMap: Record<string, string> = {}
        if (userEmails && !emailError) {
          userEmails.forEach(user => {
            if (user.id && user.email) {
              userEmailMap[user.id] = user.email
            }
          })
        }

        // Fetch Stripe spending data
        const { data: stripeData, error: stripeError } = await supabase
          .from('stripe_captured_events')
          .select('user_id, amount, pack_type')
          .in('user_id', userIds)

        const userSpending: Record<string, number> = {}
        if (stripeData && !stripeError) {
          stripeData.forEach(event => {
            if (event.user_id && event.amount) {
              userSpending[event.user_id] = (userSpending[event.user_id] || 0) + event.amount
            }
          })
        }

        // Apply sorting based on sortMode
        let sortedEdits
        if (sortMode === 'newest') {
          sortedEdits = [...stickerEdits].sort((a, b) => {
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          })
        } else {
          // Priority sorting (4-bucket system)
          sortedEdits = [...stickerEdits].sort((a, b) => {
          const aStickerEdit = Array.isArray(a.y_sticker_edits) ? a.y_sticker_edits[0] : a.y_sticker_edits
          const bStickerEdit = Array.isArray(b.y_sticker_edits) ? b.y_sticker_edits[0] : b.y_sticker_edits
          
          const aSpending = userSpending[a.user_id.toString()] || 0
          const bSpending = userSpending[b.user_id.toString()] || 0
          
          const aHasMailOrder = stripeData?.some(event => 
            event.user_id === a.user_id.toString() && event.pack_type === 'mail_order'
          ) || false
          const bHasMailOrder = stripeData?.some(event => 
            event.user_id === b.user_id.toString() && event.pack_type === 'mail_order'
          ) || false
          
          // Bucket 1: Urgency records
          const aHasUrgency = aStickerEdit?.urgency !== null && aStickerEdit?.urgency !== undefined
          const bHasUrgency = bStickerEdit?.urgency !== null && bStickerEdit?.urgency !== undefined
          
          if (aHasUrgency && !bHasUrgency) return -1
          if (!aHasUrgency && bHasUrgency) return 1
          if (aHasUrgency && bHasUrgency) {
            // Sort by urgency level, then by oldest first
            const aUrgencyNum = parseFloat(aStickerEdit.urgency) || 0
            const bUrgencyNum = parseFloat(bStickerEdit.urgency) || 0
            if (aUrgencyNum !== bUrgencyNum) return bUrgencyNum - aUrgencyNum
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          }
          
          // Bucket 2: Mail order customers
          if (aHasMailOrder && !bHasMailOrder) return -1
          if (!aHasMailOrder && bHasMailOrder) return 1
          if (aHasMailOrder && bHasMailOrder) {
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          }
          
          // Bucket 3: Big spenders (>$9)
          const aIsBigSpender = aSpending > 9 && !aHasMailOrder
          const bIsBigSpender = bSpending > 9 && !bHasMailOrder
          if (aIsBigSpender && !bIsBigSpender) return -1
          if (!aIsBigSpender && bIsBigSpender) return 1
          if (aIsBigSpender && bIsBigSpender) {
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          }
          
          // Bucket 4: Everyone else
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          })
        }

        // Take first 201 records as per original logic
        const limitedEdits = sortedEdits.slice(0, 201)
        console.log(`📋 Using ${limitedEdits.length} prioritized records`)

        // Transform to interface format
        const transformedData = limitedEdits.map((modelRun) => {
          const stickerEdit = Array.isArray(modelRun.y_sticker_edits) ? modelRun.y_sticker_edits[0] : modelRun.y_sticker_edits
          const userEmail = userEmailMap[modelRun.user_id.toString()] || 'No email'
          const spending = userSpending[modelRun.user_id.toString()] || 0
          const hasMailOrder = stripeData?.some(event => 
            event.user_id === modelRun.user_id.toString() && event.pack_type === 'mail_order'
          ) || false
          
          // Determine bucket
          let bucket: 'Urgent' | 'Big Spender' | 'Print Order' | 'Remainder'
          if (stickerEdit?.urgency !== null && stickerEdit?.urgency !== undefined) {
            bucket = 'Urgent'
          } else if (hasMailOrder) {
            bucket = 'Print Order'
          } else if (spending > 9) {
            bucket = 'Big Spender'
          } else {
            bucket = 'Remainder'
          }

          return {
            sticker_edit_id: stickerEdit?.id?.toString() || modelRun.id,
            model_run_id: modelRun.id,
            status: stickerEdit?.status || 'unresolved',
            urgency: stickerEdit?.urgency || null,
            bucket: bucket,
            customer_email: userEmail,
            customer_name: `Customer ${modelRun.user_id.slice(0, 8)}`,
            feedback_notes: modelRun.feedback_notes || 'No feedback provided',
            input_image_url: modelRun.input_image_url || '',
            output_image_url: modelRun.output_image_url || '',
            preprocessed_output_image_url: modelRun.preprocessed_output_image_url || '',
            initial_edit_image_url: modelRun.output_image_url || '',
            image_history: stickerEdit?.image_history || [],
            amount_spent: spending,
            purchased_at: modelRun.created_at,
            edit_created_at: stickerEdit?.created_at || modelRun.created_at,
            edit_updated_at: stickerEdit?.updated_at || modelRun.updated_at,
            days_since_created: Math.floor((Date.now() - new Date(modelRun.created_at).getTime()) / (1000 * 60 * 60 * 24)),
            hours_since_created: Math.floor((Date.now() - new Date(modelRun.created_at).getTime()) / (1000 * 60 * 60)),
            minutes_since_created: Math.floor((Date.now() - new Date(modelRun.created_at).getTime()) / (1000 * 60)),
            time_spent_on_edit: 0,
            image_count: 1,
            urgency_priority: parseFloat(stickerEdit?.urgency || '0') || 0,
            last_activity_relative: `${Math.floor((Date.now() - new Date(modelRun.updated_at || modelRun.created_at).getTime()) / (1000 * 60 * 60))}h ago`,
            created_at_formatted: new Date(modelRun.created_at).toLocaleDateString(),
            purchase_to_edit_delay: 0
          }
        })

        setStickerData(transformedData)
        console.log(`✅ Loaded ${transformedData.length} sticker edits`)
        
        // Debug: Check if our specific record is in the results
        const targetRecord = transformedData.find(item => item.model_run_id === '3e0639e8-5701-45a9-9c98-66fb9865d8d8')
        if (targetRecord) {
          console.log('🎯 Found target record:', targetRecord)
        } else {
          console.log('❌ Target record 3e0639e8-5701-45a9-9c98-66fb9865d8d8 not found in results')
          console.log('📋 First 5 records:', transformedData.slice(0, 5).map(r => ({ id: r.model_run_id, feedback: r.feedback_notes })))
        }
      }
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  const currentSticker = stickerData[currentIndex]

  const handleNext = () => {
    if (currentIndex < stickerData.length - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    }
  }

  const handleComplete = (stickerId: string) => {
    // TODO: Mark as complete in database
    console.log('Completing sticker:', stickerId)
    handleNext()
  }

  const handlePageNumberSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const pageNum = parseInt(pageNumberInput)
    if (pageNum >= 1 && pageNum <= stickerData.length) {
      setCurrentIndex(pageNum - 1) // Convert to 0-based index
      setIsEditingPageNumber(false)
      setPageNumberInput('')
    }
  }

  const handlePageNumberClick = () => {
    setIsEditingPageNumber(true)
    setPageNumberInput((currentIndex + 1).toString())
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-lg text-gray-600">Loading stickers...</div>
      </div>
    )
  }

  if (!currentSticker) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-lg text-gray-600">No stickers to edit</div>
      </div>
    )
  }

  return (
    <div className="h-screen">
      {/* Floating header */}
      <div className="absolute top-4 left-4 right-4 z-50 flex items-center justify-end">
        <div className="flex items-center gap-4">
          <select
            value={sortMode}
            onChange={(e) => {
              setSortMode(e.target.value as 'priority' | 'newest')
              setCurrentIndex(0) // Reset to first record when sorting changes
            }}
            className="text-sm text-gray-600 bg-white px-3 py-1 rounded-lg shadow border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="priority">Priority</option>
            <option value="newest">Newest</option>
          </select>
          {isEditingPageNumber ? (
            <form onSubmit={handlePageNumberSubmit} className="text-sm text-gray-600 bg-white px-3 py-1 rounded-lg shadow">
              <input
                type="number"
                value={pageNumberInput}
                onChange={(e) => setPageNumberInput(e.target.value)}
                onBlur={() => {
                  setIsEditingPageNumber(false)
                  setPageNumberInput('')
                }}
                min="1"
                max={stickerData.length}
                className="w-12 text-center bg-transparent border-0 outline-0 focus:ring-0"
                autoFocus
              />
              <span> of {stickerData.length}</span>
            </form>
          ) : (
            <button
              onClick={handlePageNumberClick}
              className="text-sm text-gray-600 bg-white px-3 py-1 rounded-lg shadow hover:bg-gray-50 transition-colors"
            >
              {currentIndex + 1} of {stickerData.length}
            </button>
          )}
          <GlobalSearch onSelect={(result) => {
            if (typeof window !== 'undefined') {
              const w = window as Window & {
                openRecordByEmail?: (email: string, preferredModelRunId?: string) => void
              }
              if (w.openRecordByEmail) {
                w.openRecordByEmail(result.email, result.latest_model_run_id)
              }
            }
          }} />
        </div>
      </div>

      <ReactFlowCanvas
        sticker={currentSticker}
        onNext={handleNext}
        onPrevious={handlePrevious}
        onComplete={handleComplete}
        currentIndex={currentIndex}
        totalCount={stickerData.length}
      />

      <JobManager />

      {/* Floating Table View Button */}
      <div className="fixed top-4 left-4 z-[9999]">
        <button
          onClick={() => {
            console.log('Table view clicked')
            setShowTableOverlay(true)
          }}
          className="bg-blue-500 hover:bg-blue-600 text-white rounded-lg shadow-lg border border-blue-600 p-3 transition-all duration-200 flex items-center gap-2"
          style={{
            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)'
          }}
          title="Switch to table view"
        >
          <svg 
            width="20" 
            height="20" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            className="text-white"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="9" y1="9" x2="21" y2="9"/>
            <line x1="9" y1="15" x2="21" y2="15"/>
            <line x1="3" y1="9" x2="3" y2="9"/>
            <line x1="3" y1="15" x2="3" y2="15"/>
          </svg>
          <span className="text-sm font-medium text-white">Table View</span>
        </button>
      </div>

      {/* Table View Overlay */}
      {showTableOverlay && (
        <TableViewOverlay
          onClose={() => setShowTableOverlay(false)}
          onSelectRecord={(index, record) => {
            // Find the record in our current data and set the index
            const foundIndex = stickerData.findIndex(item => item.model_run_id === record.model_run_id)
            if (foundIndex >= 0) {
              setCurrentIndex(foundIndex)
            }
            setShowTableOverlay(false)
          }}
          currentRecordId={currentSticker?.model_run_id}
        />
      )}
    </div>
  )
}