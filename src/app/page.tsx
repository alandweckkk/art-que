"use client"

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import ReactFlowCanvas from '@/components/ReactFlowCanvas'
import HelpTooltip from '@/components/HelpTooltip'
import GlobalSearch from '@/components/GlobalSearch'
import TableViewOverlay from '@/components/TableViewOverlay'
import StatsViewOverlay from '@/components/StatsViewOverlay'
import { StickerEdit } from '@/types/sticker'

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [stickerData, setStickerData] = useState<StickerEdit[]>([])
  const [loading, setLoading] = useState(true)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [sortMode, setSortMode] = useState<'priority' | 'newest'>('newest')
  const [isEditingPageNumber, setIsEditingPageNumber] = useState(false)
  const [pageNumberInput, setPageNumberInput] = useState('')
  const [showTableOverlay, setShowTableOverlay] = useState(false)
  const [showStatsOverlay, setShowStatsOverlay] = useState(false)
  const [showSidePanel, setShowSidePanel] = useState(false)
  
  // Progressive loading state
  const [allRecordIds, setAllRecordIds] = useState<string[]>([]) // All available record IDs
  const [loadedCount, setLoadedCount] = useState(0) // How many records are fully loaded
  const [isBackgroundLoading, setIsBackgroundLoading] = useState(false)

  // Update URL when currentIndex changes
  useEffect(() => {
    const currentSticker = stickerData[currentIndex]
    if (currentSticker) {
      const params = new URLSearchParams()
      params.set('id', currentSticker.model_run_id)
      router.replace(`?${params.toString()}`, { scroll: false })
    }
  }, [currentIndex, stickerData, router])

  // Load record from URL on initial mount
  useEffect(() => {
    const modelRunId = searchParams.get('id')
    if (modelRunId && allRecordIds.length > 0 && stickerData.length > 0) {
      const recordIndex = stickerData.findIndex(record => record?.model_run_id === modelRunId)
      if (recordIndex >= 0 && recordIndex !== currentIndex) {
        setCurrentIndex(recordIndex)
      }
    }
  }, [searchParams, allRecordIds, stickerData])

  useEffect(() => {
    fetchStickerData()
  }, [sortMode])

  // Fetch just the IDs and basic info for all records (lightweight)
  const fetchAllRecordIds = async () => {
    try {
      console.log('🔍 Fetching all record IDs for progressive loading...')
      
      // Query from y_sticker_edits table with minimal data for sorting
      const { data: stickerEdits, error } = await supabase
        .from('y_sticker_edits')
        .select(`
          id,
          status,
          urgency,
          created_at,
          updated_at,
          model_run!y_sticker_edits_model_run_id_fkey (
            id,
            user_id,
            feedback_addressed,
            reaction
          )
        `)
        .gte('created_at', new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching record IDs:', error)
        return []
      }

      if (stickerEdits) {
        // Filter out records where model_run data is missing or doesn't meet criteria
        const validEdits = stickerEdits.filter(edit => {
          const modelRun = Array.isArray(edit.model_run) ? edit.model_run[0] : edit.model_run
          return modelRun && 
                 modelRun.reaction === 'negative' && 
                 !modelRun.feedback_addressed
        })
        
        // Get unique user IDs for spending data (needed for sorting)
        const userIds = [...new Set(validEdits
          .map(edit => {
            const modelRun = Array.isArray(edit.model_run) ? edit.model_run[0] : edit.model_run
            return modelRun?.user_id
          })
          .filter(Boolean)
        )]

        // Fetch Stripe spending data for sorting
        const { data: stripeData } = await supabase
          .from('stripe_captured_events')
          .select('user_id, amount, pack_type')
          .in('user_id', userIds)

        const userSpending: Record<string, number> = {}
        if (stripeData) {
          stripeData.forEach(event => {
            if (event.user_id && event.amount) {
              userSpending[event.user_id] = (userSpending[event.user_id] || 0) + event.amount
            }
          })
        }

        // Apply sorting based on sortMode
        let sortedEdits
        if (sortMode === 'newest') {
          sortedEdits = [...validEdits].sort((a, b) => {
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          })
        } else {
          // Priority sorting (4-bucket system)
          sortedEdits = [...validEdits].sort((a, b) => {
            const aModelRun = Array.isArray(a.model_run) ? a.model_run[0] : a.model_run
            const bModelRun = Array.isArray(b.model_run) ? b.model_run[0] : b.model_run
            
            const aSpending = userSpending[aModelRun?.user_id?.toString() || ''] || 0
            const bSpending = userSpending[bModelRun?.user_id?.toString() || ''] || 0
            
            const aHasMailOrder = stripeData?.some(event => 
              event.user_id === aModelRun?.user_id?.toString() && event.pack_type === 'mail_order'
            ) || false
            const bHasMailOrder = stripeData?.some(event => 
              event.user_id === bModelRun?.user_id?.toString() && event.pack_type === 'mail_order'
            ) || false
            
            // Bucket 1: Urgency records
            const aHasUrgency = a.urgency !== null && a.urgency !== undefined
            const bHasUrgency = b.urgency !== null && b.urgency !== undefined
            
            if (aHasUrgency && !bHasUrgency) return -1
            if (!aHasUrgency && bHasUrgency) return 1
            if (aHasUrgency && bHasUrgency) {
              const aUrgencyNum = parseFloat(a.urgency) || 0
              const bUrgencyNum = parseFloat(b.urgency) || 0
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

        // Take all records that match our criteria (no artificial limit)
        const recordIds = sortedEdits.map(edit => edit.id)
        setAllRecordIds(recordIds)
        console.log(`📋 Got ${recordIds.length} record IDs for progressive loading`)
        
        return recordIds
      }
      
      return []
    } catch (error) {
      console.error('Error fetching record IDs:', error)
      return []
    }
  }

  // Fetch full data for a specific record by ID
  const fetchSingleRecord = async (recordId: string, emailMap?: Record<string, string>): Promise<StickerEdit | null> => {
    try {
      const { data: stickerEdit, error } = await supabase
        .from('y_sticker_edits')
        .select(`
          id,
          status,
          urgency,
          created_at,
          updated_at,
          image_history,
          internal_note,
          model_run!y_sticker_edits_model_run_id_fkey (
            id,
            user_id,
            feedback_notes,
            input_image_url,
            output_image_url,
            preprocessed_output_image_url,
            created_at,
            updated_at,
            feedback_addressed,
            reaction
          )
        `)
        .eq('id', recordId)
        .single()

      if (error) throw error

      if (stickerEdit && stickerEdit.model_run) {
        const modelRun = Array.isArray(stickerEdit.model_run) ? stickerEdit.model_run[0] : stickerEdit.model_run
        
        // Fetch user email and spending data for this specific user
        let userEmail: string | null = null
        
        if (modelRun?.user_id) {
          // First check if email is in the provided emailMap (batch optimization)
          if (emailMap && emailMap[modelRun.user_id]) {
            userEmail = emailMap[modelRun.user_id]
            console.log(`✅ Using cached email for record ${recordId}:`, userEmail)
          } else {
            // Fallback: Fetch individually if not in map
            try {
              const { data: userData, error: emailError } = await supabase
                .from('users_populated')
                .select('email')
                .eq('id', modelRun.user_id)
                .maybeSingle()
              
              if (emailError) {
                console.warn(`⚠️ Failed to fetch email for user ${modelRun.user_id}:`, emailError.message)
              } else if (userData?.email) {
                userEmail = userData.email
                console.log(`✅ Fetched email individually for record ${recordId}:`, userEmail)
              } else {
                console.warn(`⚠️ No email found for user ${modelRun.user_id}`)
              }
            } catch (err) {
              console.error(`❌ Error fetching email for user ${modelRun.user_id}:`, err)
            }
          }
        }

        const { data: stripeData } = await supabase
          .from('stripe_captured_events')
          .select('amount, pack_type')
          .eq('user_id', modelRun?.user_id)

        const spending = stripeData?.reduce((sum, event) => sum + (event.amount || 0), 0) || 0
        const hasMailOrder = stripeData?.some(event => event.pack_type === 'mail_order') || false
        
        // Determine bucket
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
          model_run_id: modelRun.id,
          status: stickerEdit.status || 'unresolved',
          urgency: stickerEdit.urgency || null,
          bucket: bucket,
          customer_email: userEmail || `user-${modelRun?.user_id?.slice(0, 8) || 'unknown'}`,
          customer_name: `Customer ${modelRun?.user_id?.slice(0, 8) || 'unknown'}`,
          feedback_notes: modelRun.feedback_notes || 'No feedback provided',
          input_image_url: modelRun.input_image_url || '',
          output_image_url: modelRun.output_image_url || '',
          preprocessed_output_image_url: modelRun.preprocessed_output_image_url || '',
          initial_edit_image_url: modelRun.output_image_url || '',
          image_history: stickerEdit.image_history || [],
          internal_note: stickerEdit.internal_note || null,
          amount_spent: spending,
          purchased_at: modelRun.created_at,
          edit_created_at: stickerEdit.created_at,
          edit_updated_at: stickerEdit.updated_at,
          days_since_created: Math.floor((Date.now() - new Date(stickerEdit.created_at).getTime()) / (1000 * 60 * 60 * 24)),
          hours_since_created: Math.floor((Date.now() - new Date(stickerEdit.created_at).getTime()) / (1000 * 60 * 60)),
          minutes_since_created: Math.floor((Date.now() - new Date(stickerEdit.created_at).getTime()) / (1000 * 60)),
          time_spent_on_edit: stickerEdit.updated_at ? 
            Math.floor((new Date(stickerEdit.updated_at).getTime() - new Date(stickerEdit.created_at).getTime()) / (1000 * 60)) : 0,
          image_count: (stickerEdit.image_history || []).length,
          urgency_priority: parseFloat(stickerEdit.urgency || '0') || 0,
          last_activity_relative: `${Math.floor((Date.now() - new Date(stickerEdit.updated_at || stickerEdit.created_at).getTime()) / (1000 * 60 * 60))}h ago`,
          created_at_formatted: new Date(stickerEdit.created_at).toLocaleDateString(),
          purchase_to_edit_delay: 0
        }
      }
      
      return null
    } catch (error) {
      console.error('Error fetching single record:', error)
      return null
    }
  }

  // Progressive loading function
  const startProgressiveLoading = async () => {
    const recordIds = await fetchAllRecordIds()
    if (recordIds.length === 0) {
      setLoading(false)
      return
    }

    // Load first 3 records immediately
    console.log('🚀 Loading first 3 records immediately...')
    
    // OPTIMIZATION: Batch fetch emails for first 3 records
    const initialRecordIds = recordIds.slice(0, Math.min(3, recordIds.length))
    
    const { data: initialEdits } = await supabase
      .from('y_sticker_edits')
      .select('id, model_run!y_sticker_edits_model_run_id_fkey(id, user_id)')
      .in('id', initialRecordIds)
    
    const initialUserIds = [...new Set(
      initialEdits
        ?.map(edit => {
          const modelRun = Array.isArray(edit.model_run) ? edit.model_run[0] : edit.model_run
          return modelRun?.user_id
        })
        .filter(Boolean) || []
    )]
    
    const { data: initialEmails } = await supabase
      .from('users_populated')
      .select('id, email')
      .in('id', initialUserIds)
    
    const initialEmailMap: Record<string, string> = {}
    initialEmails?.forEach(user => {
      if (user.id && user.email) {
        initialEmailMap[user.id] = user.email
      }
    })
    console.log(`✅ Pre-fetched ${Object.keys(initialEmailMap).length} emails for initial batch`)
    
    const initialRecords: StickerEdit[] = []
    
    for (let i = 0; i < initialRecordIds.length; i++) {
      const record = await fetchSingleRecord(recordIds[i], initialEmailMap)
      if (record) {
        initialRecords[i] = record
      }
    }
    
    // Initialize stickerData array with proper length and fill first 3 positions
    const initialDataArray = new Array(recordIds.length).fill(null)
    initialRecords.forEach((record, index) => {
      if (record) {
        initialDataArray[index] = record
      }
    })
    
    setStickerData(initialDataArray)
    setLoadedCount(initialRecords.length)
    setLoading(false)
    
    // Preload images for the first 3 records immediately
    console.log('🖼️ Preloading images for first 3 records...')
    initialRecords.forEach(record => {
      if (record) {
        const imagesToPreload = [
          record.input_image_url,
          record.output_image_url, 
          record.preprocessed_output_image_url,
          ...record.image_history.map(entry => entry.image_url)
        ].filter(Boolean)
        
        imagesToPreload.forEach(imageUrl => {
          if (imageUrl) {
            const img = new Image()
            img.src = imageUrl
          }
        })
      }
    })

    // Wait 2 seconds, then load next 22 records all at once
    setTimeout(async () => {
      console.log('⏳ Loading next 22 records all at once...')
      setIsBackgroundLoading(true)
      
      const recordsToLoad = Math.min(22, recordIds.length - 3) // Next 22 or remaining
      
      // OPTIMIZATION: Batch fetch emails for all records first
      console.log('📧 Pre-fetching emails for batch...')
      const recordsToFetch = recordIds.slice(3, 3 + recordsToLoad)
      
      // Get user_ids for all records in this batch
      const { data: batchEdits } = await supabase
        .from('y_sticker_edits')
        .select('id, model_run!y_sticker_edits_model_run_id_fkey(id, user_id)')
        .in('id', recordsToFetch)
      
      const userIds = [...new Set(
        batchEdits
          ?.map(edit => {
            const modelRun = Array.isArray(edit.model_run) ? edit.model_run[0] : edit.model_run
            return modelRun?.user_id
          })
          .filter(Boolean) || []
      )]
      
      // Fetch all emails in ONE query
      const { data: batchEmails } = await supabase
        .from('users_populated')
        .select('id, email')
        .in('id', userIds)
      
      const emailMap: Record<string, string> = {}
      batchEmails?.forEach(user => {
        if (user.id && user.email) {
          emailMap[user.id] = user.email
        }
      })
      console.log(`✅ Pre-fetched ${Object.keys(emailMap).length} emails`)
      
      // Create all fetch promises at once (they'll use the email cache)
      const loadPromises: Promise<StickerEdit | null>[] = []
      for (let i = 3; i < 3 + recordsToLoad; i++) {
        loadPromises.push(fetchSingleRecord(recordIds[i], emailMap))
      }
      
      // Wait for all records to load
      const loadedRecords = await Promise.all(loadPromises)
      
      // Update state with all loaded records
      setStickerData(prev => {
        const newData = [...prev]
        loadedRecords.forEach((record, index) => {
          if (record) {
            newData[3 + index] = record
          }
        })
        return newData
      })
      
      setLoadedCount(3 + loadedRecords.filter(Boolean).length)
      setIsBackgroundLoading(false)
      console.log(`✅ Background loading complete! Loaded ${3 + loadedRecords.filter(Boolean).length} records total`)
      
      // Preload images for the loaded records in the background
      console.log('🖼️ Preloading images for background-loaded records...')
      loadedRecords.forEach((record, index) => {
        if (record) {
          // Preload all image URLs for this record
          const imagesToPreload = [
            record.input_image_url,
            record.output_image_url, 
            record.preprocessed_output_image_url,
            ...record.image_history.map(entry => entry.image_url)
          ].filter(Boolean) // Remove empty URLs
          
          imagesToPreload.forEach(imageUrl => {
            if (imageUrl) {
              const img = new Image()
              img.src = imageUrl
              // No need to do anything with the loaded image - browser will cache it
            }
          })
        }
      })
    }, 2000)
  }

  const fetchStickerData = async () => {
    console.log('🔄 Starting progressive loading strategy...')
    setLoading(true)
    setStickerData([])
    setLoadedCount(0)
    setIsBackgroundLoading(false)
    setCurrentIndex(0) // Reset to first record when switching filters
    
    await startProgressiveLoading()
  }

  const currentSticker = stickerData[currentIndex]

  const handleNext = async () => {
    const nextIndex = currentIndex + 1
    
    // If we're moving to record 26+ and it's not loaded yet, load it on-demand
    if (nextIndex >= 25 && nextIndex < allRecordIds.length && !stickerData[nextIndex]) {
      console.log(`📥 Loading record ${nextIndex + 1} on-demand...`)
      const record = await fetchSingleRecord(allRecordIds[nextIndex]) // No emailMap, will fetch individually
      if (record) {
        setStickerData(prev => {
          const newData = [...prev]
          newData[nextIndex] = record
          return newData
        })
        setLoadedCount(prev => Math.max(prev, nextIndex + 1))
      }
    }
    
    if (nextIndex < allRecordIds.length) {
      setCurrentIndex(nextIndex)
    }
  }

  const handlePrevious = async () => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1
      
      // If we're moving to a record that's not loaded yet, load it on-demand
      if (!stickerData[prevIndex]) {
        console.log(`📥 Loading record ${prevIndex + 1} on-demand (going backwards)...`)
        const record = await fetchSingleRecord(allRecordIds[prevIndex]) // No emailMap, will fetch individually
        if (record) {
          setStickerData(prev => {
            const newData = [...prev]
            newData[prevIndex] = record
            return newData
          })
          setLoadedCount(prev => Math.max(prev, prevIndex + 1))
        }
      }
      
      setCurrentIndex(prevIndex)
    }
  }

  const handleComplete = (stickerId: string) => {
    // TODO: Mark as complete in database
    console.log('Completing sticker:', stickerId)
    handleNext()
  }

  const handlePageNumberSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const pageNum = parseInt(pageNumberInput)
    const targetIndex = pageNum - 1 // Convert to 0-based index
    
    if (pageNum >= 1 && pageNum <= allRecordIds.length) {
      // If navigating to record 26+ and it's not loaded yet, load it on-demand
      if (targetIndex >= 25 && !stickerData[targetIndex]) {
        console.log(`📥 Loading record ${pageNum} on-demand via page navigation...`)
        const record = await fetchSingleRecord(allRecordIds[targetIndex]) // No emailMap, will fetch individually
        if (record) {
          setStickerData(prev => {
            const newData = [...prev]
            newData[targetIndex] = record
            return newData
          })
          setLoadedCount(prev => Math.max(prev, targetIndex + 1))
        }
      }
      
      setCurrentIndex(targetIndex)
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
                max={allRecordIds.length}
                className="w-12 text-center bg-transparent border-0 outline-0 focus:ring-0"
                autoFocus
              />
              <span> of {allRecordIds.length}</span>
            </form>
          ) : (
            <button
              onClick={handlePageNumberClick}
              className="text-sm text-gray-600 bg-white px-3 py-1 rounded-lg shadow hover:bg-gray-50 transition-colors"
            >
              {currentIndex + 1} of {allRecordIds.length}
              {isBackgroundLoading && (
                <span className="ml-2 text-xs text-blue-500">
                  (Loading {loadedCount}/25...)
                </span>
              )}
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
          <button
            onClick={() => setShowSidePanel(true)}
            className="inline-flex items-center cursor-pointer transition-all duration-200"
            title="Side Panel"
            style={{
              gap: '6px',
              padding: '6px 14px',
              backgroundColor: '#ffffff',
              border: '1px solid #e0e0e0',
              borderRadius: '12px',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              fontSize: '14px',
              color: '#666666'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f9f9f9';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#ffffff';
              e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
            }}
          >
            <span>Side-Panel</span>
          </button>
        </div>
      </div>

      <ReactFlowCanvas
        sticker={currentSticker}
        onNext={handleNext}
        onPrevious={handlePrevious}
        onComplete={handleComplete}
        currentIndex={currentIndex}
        totalCount={allRecordIds.length}
      />

      {/* Floating View Buttons */}
      <div className="fixed top-4 left-4 z-[9999] flex items-center gap-2">
        {/* Table View Button */}
        <button
          onClick={() => {
            console.log('Table view clicked')
            setShowTableOverlay(true)
          }}
          className="bg-gray-700 hover:bg-gray-600 text-gray-100 rounded-lg shadow-md p-3 transition-all duration-200 flex items-center gap-2"
          title="Switch to table view"
        >
          <svg 
            width="20" 
            height="20" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            className="text-gray-100"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="9" y1="9" x2="21" y2="9"/>
            <line x1="9" y1="15" x2="21" y2="15"/>
            <line x1="3" y1="9" x2="3" y2="9"/>
            <line x1="3" y1="15" x2="3" y2="15"/>
          </svg>
          <span className="text-sm font-medium text-gray-100">Table View</span>
        </button>

        {/* Stats View Button */}
        <button
          className="flex items-center gap-2 px-3 py-3 bg-gray-600 hover:bg-gray-500 text-gray-100 rounded-lg shadow-md transition-all duration-200"
          onClick={() => {
            setShowStatsOverlay(true)
          }}
          title="Switch to stats view"
        >
          <svg 
            width="20" 
            height="20" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            className="text-gray-100"
          >
            <path d="M3 3v18h18" />
            <path d="M18 17V9" />
            <path d="M13 17V5" />
            <path d="M8 17v-3" />
          </svg>
          <span className="text-sm font-medium text-gray-100">Stats View</span>
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

      {/* Stats View Overlay */}
      {showStatsOverlay && (
        <StatsViewOverlay
          onClose={() => setShowStatsOverlay(false)}
        />
      )}

      {/* Side Panel */}
      {showSidePanel && (
        <div 
          className="fixed top-0 right-0 w-[400px] bg-slate-800 z-[9999] shadow-2xl transition-transform duration-300 ease-in-out"
          style={{ height: '90vh' }}
        >
          {/* Close Button */}
          <div className="absolute top-4 right-4 z-10">
            <button
              onClick={() => setShowSidePanel(false)}
              className="text-white hover:text-gray-300 transition-colors bg-black bg-opacity-50 rounded-full p-2"
              title="Close Side Panel"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          
          {/* Iframe Content */}
          <iframe
            src="https://live-front-panel.vercel.app/"
            className="w-full h-full border-0"
            title="Live Front Panel"
            allow="clipboard-read; clipboard-write"
          />
        </div>
      )}
    </div>
  )
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <div className="text-lg text-gray-600">Loading...</div>
      </div>
    }>
      <HomeContent />
    </Suspense>
  )
}