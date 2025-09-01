'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { InlineFluxEditor } from '@/components/InlineFluxEditor'

interface StickerEdit {
  sticker_edit_id: string
  model_run_id: string
  status: 'processing' | 'completed' | 'failed' | 'unresolved'
  urgency: string | null
  bucket: 'Urgent' | 'Big Spender' | 'Print Order' | 'Remainder'
  customer_email: string
  customer_name: string
  feedback_notes: string
  input_image_url: string
  output_image_url: string
  preprocessed_output_image_url: string
  initial_edit_image_url: string // First image from image_history array
  image_history: string[] // Full array of edit images
  amount_spent: number
  purchased_at: string
  edit_created_at: string
  edit_updated_at: string
  days_since_created: number
  hours_since_created: number
  minutes_since_created: number
  time_spent_on_edit: number // Minutes spent between creation and last update
  image_count: number
  urgency_priority: number
  last_activity_relative: string
  created_at_formatted: string
  purchase_to_edit_delay: number // Hours between purchase and edit request
}

interface JobState {
  isRunning: boolean
  input: string
  result: unknown
  startTime?: number
  globalJobId?: string
}

export default function Main() {
  const [data, setData] = useState<StickerEdit[]>([])
  const [cardData, setCardData] = useState<StickerEdit[]>([])
  const [loading, setLoading] = useState(true)
  const [cardLoading, setCardLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'card'>('card')
  const [currentCardIndex, setCurrentCardIndex] = useState(0)
  const [isFluxEditorOpen, setIsFluxEditorOpen] = useState(false)
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [pageSize] = useState(100)
  
  // Job states for each record
  const [jobStates, setJobStates] = useState<Record<string, JobState>>({})

  // Helper function to calculate relative time
  const getRelativeTime = (date: string) => {
    const now = new Date()
    const past = new Date(date)
    const diffMs = now.getTime() - past.getTime()
    
    const minutes = Math.floor(diffMs / (1000 * 60))
    const hours = Math.floor(diffMs / (1000 * 60 * 60))
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }

  // Fetch real data from Supabase with pagination
  const fetchStickerEdits = async (page: number = 1) => {
    setLoading(true)
    try {
      // First get total count
      const { count, error: countError } = await supabase
        .from('model_run')
        .select('*', { count: 'exact', head: true })
        .eq('reaction', 'negative')
        .not('feedback_addressed', 'is', true)
        .gte('created_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())

      if (countError) {
        console.error('Error getting count:', countError)
        return
      }

      setTotalRecords(count || 0)

      // Calculate offset for pagination
      const offset = (page - 1) * pageSize

      // Query records using the 4-bucket priority system - starting from model_run
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
        .range(offset, offset + pageSize - 1)

      if (error) {
        console.error('Error fetching sticker edits:', error)
        console.error('Error details:', JSON.stringify(error, null, 2))
        return
      }

      if (stickerEdits) {
        // Get unique user IDs to fetch Stripe spending data
        const userIds = [...new Set(stickerEdits
          .map(modelRun => modelRun.user_id)
          .filter(Boolean)
        )]

        // Fetch user emails from users_populated
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

        // Fetch Stripe spending data for all users
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

        // Sort the data using the 4-bucket priority system before transforming
        const sortedEdits = [...stickerEdits].sort((a, b) => {
          // Now a and b are model_run records, with optional y_sticker_edits data
          const aStickerEdit = Array.isArray(a.y_sticker_edits) ? a.y_sticker_edits[0] : a.y_sticker_edits
          const bStickerEdit = Array.isArray(b.y_sticker_edits) ? b.y_sticker_edits[0] : b.y_sticker_edits
          
          // Get user spending totals
          const aSpending = userSpending[a.user_id.toString()] || 0
          const bSpending = userSpending[b.user_id.toString()] || 0
          
          // Check for mail order customers
          const aHasMailOrder = stripeData?.some(event => 
            event.user_id === a.user_id.toString() && event.pack_type === 'mail_order'
          ) || false
          const bHasMailOrder = stripeData?.some(event => 
            event.user_id === b.user_id.toString() && event.pack_type === 'mail_order'
          ) || false
          
          // Bucket 1: Urgency records (urgency IS NOT NULL)
          const aHasUrgency = aStickerEdit?.urgency !== null && aStickerEdit?.urgency !== undefined
          const bHasUrgency = bStickerEdit?.urgency !== null && bStickerEdit?.urgency !== undefined
          
          if (aHasUrgency && !bHasUrgency) return -1
          if (!aHasUrgency && bHasUrgency) return 1
          if (aHasUrgency && bHasUrgency) {
            // Within urgency bucket: higher urgency first, then older created_at
            if (aStickerEdit.urgency !== bStickerEdit.urgency) return Number(bStickerEdit.urgency) - Number(aStickerEdit.urgency)
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          }
          
          // For non-urgency records, apply bucket logic
          // Bucket 2: Mail order customers (Print Order comes first)
          if (aHasMailOrder && !bHasMailOrder) return -1
          if (!aHasMailOrder && bHasMailOrder) return 1
          if (aHasMailOrder && bHasMailOrder) {
            // Both mail order: sort by created_at (older first)
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          }
          
          // Bucket 3: High spenders (>$9)
          const aIsHighSpender = aSpending > 9
          const bIsHighSpender = bSpending > 9
          
          if (aIsHighSpender && !bIsHighSpender) return -1
          if (!aIsHighSpender && bIsHighSpender) return 1
          if (aIsHighSpender && bIsHighSpender) {
            // Both high spenders: sort by created_at (older first)
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          }
          
          // Bucket 4: Remainder - sort by created_at (older first)
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        })

        // Transform the sorted data to match our interface with real Stripe spending data
        const transformedData = sortedEdits.map(modelRun => {
          const now = new Date()
          const createdAt = new Date(modelRun.created_at)
          const stickerEdit = Array.isArray(modelRun.y_sticker_edits) ? modelRun.y_sticker_edits[0] : modelRun.y_sticker_edits
          const updatedAt = stickerEdit?.updated_at ? new Date(stickerEdit.updated_at) : createdAt
          const userEmail = userEmailMap[modelRun.user_id] || null
          
          const diffMs = now.getTime() - createdAt.getTime()
          const updateDiffMs = updatedAt.getTime() - createdAt.getTime()
          const purchaseToEditMs = stickerEdit?.created_at ? 
            new Date(stickerEdit.created_at).getTime() - createdAt.getTime() : 0
          
          // Calculate bucket for this record
          const userSpendingAmount = userSpending[modelRun.user_id.toString()] || 0
          const hasMailOrder = stripeData?.some(event => 
            event.user_id === modelRun.user_id.toString() && event.pack_type === 'mail_order'
          ) || false
          
          let bucket: 'Urgent' | 'Big Spender' | 'Print Order' | 'Remainder'
          if (stickerEdit?.urgency !== null && stickerEdit?.urgency !== undefined) {
            bucket = 'Urgent'
          } else if (hasMailOrder) {
            bucket = 'Print Order'
          } else if (userSpendingAmount > 9) {
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
            customer_email: userEmail || 'No email',
            customer_name: `User ${modelRun.user_id}` || 'Unknown',
            feedback_notes: modelRun.feedback_notes || 'No feedback provided',
            input_image_url: modelRun.input_image_url || '',
            output_image_url: modelRun.output_image_url || '',
            preprocessed_output_image_url: modelRun.preprocessed_output_image_url || '',
            initial_edit_image_url: stickerEdit?.image_history && stickerEdit.image_history.length > 0 ? stickerEdit.image_history[0] : '',
            image_history: stickerEdit?.image_history || [],
            amount_spent: userSpending[modelRun.user_id.toString()] || 0, // Real Stripe spending data
            purchased_at: modelRun.created_at,
            edit_created_at: stickerEdit?.created_at || modelRun.created_at,
            edit_updated_at: stickerEdit?.updated_at || modelRun.created_at,
            
            // Enhanced timing calculations
            days_since_created: Math.floor(diffMs / (1000 * 60 * 60 * 24)),
            hours_since_created: Math.floor(diffMs / (1000 * 60 * 60)),
            minutes_since_created: Math.floor(diffMs / (1000 * 60)),
            time_spent_on_edit: Math.max(1, Math.floor(updateDiffMs / (1000 * 60))), // Minutes between creation and last update
            purchase_to_edit_delay: Math.floor(Math.abs(purchaseToEditMs) / (1000 * 60 * 60)), // Hours from purchase to edit request
            last_activity_relative: getRelativeTime(modelRun.created_at),
            created_at_formatted: new Date(modelRun.created_at).toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric', 
              hour: 'numeric', 
              minute: '2-digit',
              hour12: true 
            }),
            
            image_count: stickerEdit?.image_history ? stickerEdit.image_history.length : 1,
            urgency_priority: stickerEdit?.urgency ? Number(stickerEdit.urgency) : 5
          }
        })

        setData(transformedData)
        
        // Initialize job states for all records
        const initialStates: Record<string, JobState> = {}
        transformedData.forEach(edit => {
          initialStates[edit.sticker_edit_id] = {
            isRunning: false,
            input: '',
            result: null
          }
        })
        setJobStates(initialStates)
      }
    } catch (err) {
      console.error('Error fetching data:', err)
    } finally {
      setLoading(false)
    }
  }

  // Fetch ALL records for card view (no pagination, no image loading)
  const fetchCardViewData = async () => {
    setCardLoading(true)
    try {
      // Get total count (same as table view)
      const { count, error: countError } = await supabase
        .from('model_run')
        .select('*', { count: 'exact', head: true })
        .eq('reaction', 'negative')
        .not('feedback_addressed', 'is', true)
        .gte('created_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())

      if (countError) {
        console.error('Error getting card count:', countError)
        return
      }

      setTotalRecords(count || 0)

      // Query ALL records (no pagination limit) - same query as table view
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
        // NO .range() - fetch ALL records

      if (error) {
        console.error('Error fetching card data:', error)
        return
      }

      if (stickerEdits) {
        // Get unique user IDs to fetch Stripe spending data (same logic as table view)
        const userIds = [...new Set(stickerEdits
          .map(modelRun => modelRun.user_id)
          .filter(Boolean)
        )]

        // Fetch user emails from users_populated
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

        // Fetch Stripe spending data for all users
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

        // Sort using the same 4-bucket priority system
        const sortedEdits = [...stickerEdits].sort((a, b) => {
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
            if (aStickerEdit.urgency !== bStickerEdit.urgency) return Number(bStickerEdit.urgency) - Number(aStickerEdit.urgency)
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          }
          
          // Bucket 2: Mail order customers
          if (aHasMailOrder && !bHasMailOrder) return -1
          if (!aHasMailOrder && bHasMailOrder) return 1
          if (aHasMailOrder && bHasMailOrder) {
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          }
          
          // Bucket 3: High spenders
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

        // Transform data (same logic as table view)
        const transformedData = sortedEdits.map(modelRun => {
          const now = new Date()
          const createdAt = new Date(modelRun.created_at)
          const stickerEdit = Array.isArray(modelRun.y_sticker_edits) ? modelRun.y_sticker_edits[0] : modelRun.y_sticker_edits
          const updatedAt = stickerEdit?.updated_at ? new Date(stickerEdit.updated_at) : createdAt
          const userEmail = userEmailMap[modelRun.user_id] || null
          
          const diffMs = now.getTime() - createdAt.getTime()
          const updateDiffMs = updatedAt.getTime() - createdAt.getTime()
          const purchaseToEditMs = stickerEdit?.created_at ? 
            new Date(stickerEdit.created_at).getTime() - createdAt.getTime() : 0
          
          const userSpendingAmount = userSpending[modelRun.user_id.toString()] || 0
          const hasMailOrder = stripeData?.some(event => 
            event.user_id === modelRun.user_id.toString() && event.pack_type === 'mail_order'
          ) || false
          
          let bucket: 'Urgent' | 'Big Spender' | 'Print Order' | 'Remainder'
          if (stickerEdit?.urgency !== null && stickerEdit?.urgency !== undefined) {
            bucket = 'Urgent'
          } else if (hasMailOrder) {
            bucket = 'Print Order'
          } else if (userSpendingAmount > 9) {
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
            customer_email: userEmail || 'No email',
            customer_name: `User ${modelRun.user_id}` || 'Unknown',
            feedback_notes: modelRun.feedback_notes || 'No feedback provided',
            input_image_url: modelRun.input_image_url || '',
            output_image_url: modelRun.output_image_url || '',
            preprocessed_output_image_url: modelRun.preprocessed_output_image_url || '',
            initial_edit_image_url: stickerEdit?.image_history && stickerEdit.image_history.length > 0 ? stickerEdit.image_history[0] : '',
            image_history: stickerEdit?.image_history || [],
            amount_spent: userSpending[modelRun.user_id.toString()] || 0,
            purchased_at: modelRun.created_at,
            edit_created_at: stickerEdit?.created_at || modelRun.created_at,
            edit_updated_at: stickerEdit?.updated_at || modelRun.created_at,
            
            days_since_created: Math.floor(diffMs / (1000 * 60 * 60 * 24)),
            hours_since_created: Math.floor(diffMs / (1000 * 60 * 60)),
            minutes_since_created: Math.floor(diffMs / (1000 * 60)),
            time_spent_on_edit: Math.max(1, Math.floor(updateDiffMs / (1000 * 60))),
            purchase_to_edit_delay: Math.floor(Math.abs(purchaseToEditMs) / (1000 * 60 * 60)),
            last_activity_relative: getRelativeTime(modelRun.created_at),
            created_at_formatted: new Date(modelRun.created_at).toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric', 
              hour: 'numeric', 
              minute: '2-digit',
              hour12: true 
            }),
            
            image_count: stickerEdit?.image_history ? stickerEdit.image_history.length : 1,
            urgency_priority: stickerEdit?.urgency ? Number(stickerEdit.urgency) : 5
          }
        })

        setCardData(transformedData)
        console.log(`✅ Loaded ${transformedData.length} records for card view`)
      }
    } catch (err) {
      console.error('Error fetching card data:', err)
    } finally {
      setCardLoading(false)
    }
  }

  // Load data on component mount and when page changes
  useEffect(() => {
    fetchStickerEdits(currentPage)
  }, [currentPage])

  // Load card data when switching to card view
  useEffect(() => {
    if (viewMode === 'card' && cardData.length === 0) {
      fetchCardViewData()
    }
  }, [viewMode, cardData.length, fetchCardViewData])

  // Pagination navigation functions
  const goToNextPage = () => {
    const totalPages = Math.ceil(totalRecords / pageSize)
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1)
    }
  }

  const goToPrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1)
    }
  }

  const goToPage = (page: number) => {
    const totalPages = Math.ceil(totalRecords / pageSize)
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    }
  }

  const getUrgencyColor = (urgency: string | null) => {
    switch (urgency) {
      case 'do it now': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
      case 'very high': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
      case 'high': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
    }
  }

  const getBadgeColor = (amountSpent: number) => {
    if (amountSpent > 100) return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' // VIP
    if (amountSpent > 50) return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' // Premium
    return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' // Standard
  }

  const getBadgeText = (amountSpent: number) => {
    if (amountSpent > 100) return 'VIP'
    if (amountSpent > 50) return 'Premium'
    return 'Standard'
  }

  const getBucketColor = (bucket: string) => {
    switch (bucket) {
      case 'Urgent': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
      case 'Big Spender': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
      case 'Print Order': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      case 'Remainder': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
    }
  }

  // Function to render image history thumbnails
  const renderImageHistory = (imageHistory: string[], isCompact: boolean = true) => {
    if (!imageHistory || imageHistory.length === 0) {
      return (
        <div className="text-xs text-gray-400 dark:text-gray-500 italic">
          No edits yet
        </div>
      )
    }

    if (isCompact && imageHistory.length > 3) {
      // Show first 3 + count for table view
      return (
        <div className="flex items-center space-x-1">
          {imageHistory.slice(0, 3).map((url, index) => (
            <div key={`${url}-${index}`} className="w-6 h-6 rounded border border-gray-300 overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
              <img
                src={url}
                alt={`Edit ${index + 1}`}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            </div>
          ))}
          <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
            +{imageHistory.length - 3}
          </div>
        </div>
      )
    }

    // Show all images for card view or when <= 3 images
    return (
      <div className={`flex flex-wrap gap-1 ${isCompact ? 'max-w-24' : ''}`}>
        {imageHistory.map((url, index) => (
          <div key={index} className="relative group">
            <div className={`rounded border border-gray-300 overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center ${
              isCompact ? 'w-6 h-6' : 'w-16 h-16'
            }`}>
              <img
                src={url}
                alt={`Edit ${index + 1}`}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            </div>
            {!isCompact && (
              <div className="absolute -top-6 left-0 bg-black text-white text-xs px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                Edit {index + 1}
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  const nextCard = () => {
    setCurrentCardIndex((prev) => (prev + 1) % cardData.length)
  }

  const prevCard = () => {
    setCurrentCardIndex((prev) => (prev - 1 + cardData.length) % cardData.length)
  }

  const goToCard = (index: number) => {
    setCurrentCardIndex(Math.max(0, Math.min(index, cardData.length - 1)))
  }

  // Ensure currentCardIndex doesn't exceed cardData length when cardData changes
  useEffect(() => {
    if (currentCardIndex >= cardData.length && cardData.length > 0) {
      setCurrentCardIndex(0)
    }
  }, [cardData.length, currentCardIndex])

  // Calculate global card position (no pagination for cards - direct index)
  const globalCardIndex = currentCardIndex

  const currentCard = cardData[currentCardIndex]

  // Timer to update running job status
  useEffect(() => {
    const interval = setInterval(() => {
      // Force re-render to update elapsed time for running jobs
      setJobStates(prev => ({ ...prev }))
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  // Expose a global helper to open a record by email
  useEffect(() => {
    (window as Window & { openRecordByEmail?: (email: string, preferredModelRunId?: string) => void }).openRecordByEmail = async (email: string, preferredModelRunId?: string) => {
      try {
        // Ensure card data is loaded
        if (viewMode !== 'card') setViewMode('card')
        if (cardData.length === 0) {
          await fetchCardViewData()
        }

        // Try to locate by preferred model_run_id first
        let index = -1
        if (preferredModelRunId) {
          index = cardData.findIndex(c => c.model_run_id === preferredModelRunId)
        }

        // Fallback: find first by email
        if (index < 0) {
          index = cardData.findIndex(c => (c.customer_email || '').toLowerCase() === (email || '').toLowerCase())
        }

        if (index >= 0) {
          goToCard(index)
        } else {
          // If not found yet, refetch and try one more time
          await fetchCardViewData()
          const retryIndex = cardData.findIndex(c => (c.customer_email || '').toLowerCase() === (email || '').toLowerCase())
          if (retryIndex >= 0) goToCard(retryIndex)
        }
      } catch (e) {
        console.error('Failed to open record by email:', e)
      }
    }

    return () => {
      delete (window as Window & { openRecordByEmail?: (email: string, preferredModelRunId?: string) => void }).openRecordByEmail
    }
  }, [cardData, viewMode, fetchCardViewData, goToCard])

  const updateJobInput = (recordId: string, input: string) => {
    setJobStates(prev => ({
      ...prev,
      [recordId]: {
        ...prev[recordId],
        input
      }
    }))
  }

  // Handle flux editor toggle
  const handleFluxEditorToggle = () => {
    setIsFluxEditorOpen(!isFluxEditorOpen)
  }

  // Handle processed image from flux editor
  const handleProcessedImage = async (processedImageUrl: string) => {
    if (!currentCard) return
    
    try {
      // Add the new image to the beginning of the image_history array
      const updatedImageHistory = [processedImageUrl, ...currentCard.image_history]
      
      // Update the database
      const { error } = await supabase
        .from('y_sticker_edits')
        .update({ 
          image_history: updatedImageHistory,
          updated_at: new Date().toISOString()
        })
        .eq('model_run_id', currentCard.model_run_id)
      
      if (error) {
        console.error('Error updating image history:', error)
        return
      }
      
      // Update local state
      setCardData(prev => prev.map(card => 
        card.model_run_id === currentCard.model_run_id 
          ? { ...card, image_history: updatedImageHistory }
          : card
      ))
      
      // Close the flux editor
      setIsFluxEditorOpen(false)
      
      console.log('✅ Image added to history and flux editor closed')
      
    } catch (error) {
      console.error('Error handling processed image:', error)
    }
  }

  // Handle flux editor errors
  const handleFluxEditorError = (error: string) => {
    console.error('Flux editor error:', error)
    // You could add a toast notification here
    alert(error) // Simple error display for now
  }

  const submitJob = async (recordId: string) => {
    const jobInput = jobStates[recordId]?.input || 'hello'
    
    // Add job to global job manager
    const jobManager = (window as { jobManager?: { addJob: (input: string, source: string) => string; updateJobStatus: (id: string, status: 'pending' | 'running' | 'completed' | 'failed', result?: unknown) => void } }).jobManager
    const jobId = jobManager?.addJob(jobInput, `Card ${currentCardIndex + 1}`)
    
    // Update local job state to running
    setJobStates(prev => ({
      ...prev,
      [recordId]: {
        ...prev[recordId],
        isRunning: true,
        startTime: Date.now(),
        result: null,
        globalJobId: jobId // Store reference to global job
      }
    }))

    // Update global job manager
    if (jobManager && jobId) {
      jobManager.updateJobStatus(jobId, 'running')
    }

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
      
      const result: unknown = await response.json()
      
      // Update local job state with result
      setJobStates(prev => ({
        ...prev,
        [recordId]: {
          ...prev[recordId],
          isRunning: false,
          result
        }
      }))

      // Update global job manager
      if (jobManager && jobId) {
        jobManager.updateJobStatus(jobId, 'completed', result)
      }
    } catch (error) {
      const errorResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
      
      // Update local job state with error
      setJobStates(prev => ({
        ...prev,
        [recordId]: {
          ...prev[recordId],
          isRunning: false,
          result: errorResult
        }
      }))

      // Update global job manager
      if (jobManager && jobId) {
        jobManager.updateJobStatus(jobId, 'failed', errorResult)
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="mx-auto" style={{ maxWidth: '1700px' }}>
        {/* View Toggle */}
        <div className="mb-8 flex justify-center">
          <div className="flex bg-white dark:bg-gray-800 rounded-lg p-1 shadow-sm border border-gray-200 dark:border-gray-700">
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
          </div>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <span className="ml-3 text-gray-600 dark:text-gray-300">Loading sticker edits...</span>
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            No unresolved sticker edits found (all have been approved)
          </div>
        ) : (
          /* Content Area */
          viewMode === 'table' ? (
          /* Table Container */
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
            {/* Pagination Controls */}
            <div className="bg-gray-50 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    Page <span className="font-semibold">{currentPage}</span> of <span className="font-semibold">{Math.ceil(totalRecords / pageSize)}</span>
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, totalRecords)} of {totalRecords} records
                  </div>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={goToPrevPage}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-sm bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-md hover:bg-gray-50 dark:hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    onClick={goToNextPage}
                    disabled={currentPage >= Math.ceil(totalRecords / pageSize)}
                    className="px-3 py-1 text-sm bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-md hover:bg-gray-50 dark:hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full">
              {/* Table Header */}
              <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                <tr>
                  <th className="px-4 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    #
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Customer
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Bucket
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Feedback
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Images
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Edit History
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Spent
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Created At
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Urgency
                  </th>

                </tr>
              </thead>

              {/* Table Body */}
              <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                {data.map((edit, index) => (
                  <tr 
                    key={edit.sticker_edit_id} 
                    className={`transition-colors duration-200 cursor-pointer ${
                      index === currentCardIndex 
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500' 
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                    onClick={() => {
                      setViewMode('card')
                      // Find the corresponding record in cardData by model_run_id
                      const cardIndex = cardData.findIndex(cardItem => cardItem.model_run_id === edit.model_run_id)
                      if (cardIndex >= 0) {
                        goToCard(cardIndex)
                      } else {
                        // If card data not loaded yet, trigger load and set index to 0
                        if (cardData.length === 0) {
                          fetchCardViewData()
                        }
                        goToCard(0)
                      }
                    }}
                  >
                    {/* Position Number */}
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        index === currentCardIndex 
                          ? 'bg-blue-500 text-white' 
                          : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300'
                      }`}>
                        {index + 1}
                      </div>
                    </td>

                    {/* Customer */}
                    <td className="px-4 py-4">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full flex items-center justify-center">
                          <span className="text-white font-semibold text-sm">
                            {edit.customer_name ? edit.customer_name.substring(0, 2).toUpperCase() : 'U'}
                          </span>
                        </div>
                        <div className="ml-3">
                          <div className="text-xs text-gray-900 dark:text-gray-200">
                            {edit.customer_email}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                            User: {edit.customer_name.replace('User ', '')}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">
                            Run: {edit.model_run_id}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Bucket */}
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getBucketColor(edit.bucket)}`}>
                        {edit.bucket}
                      </span>
                    </td>

                    {/* Feedback */}
                    <td className="px-6 py-4">
                      <div className="max-w-xs">
                        <p className="text-sm text-gray-900 dark:text-white truncate">
                          {edit.feedback_notes}
                        </p>
                      </div>
                    </td>

                    {/* Images - Show main workflow images */}
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex items-center space-x-1">
                        {/* Input Image */}
                        {edit.input_image_url && (
                          <div className="relative group">
                            <div className="w-10 h-10 rounded border-2 border-green-400 overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                              <img 
                                src={edit.input_image_url} 
                                alt="Original" 
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none'
                                }}
                              />
                            </div>
                            <div className="absolute -top-6 left-0 bg-black text-white text-xs px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                              Original
                            </div>
                          </div>
                        )}
                        
                        {/* Arrow */}
                        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        
                        {/* Output Image */}
                        {edit.output_image_url && (
                          <div className="relative group">
                            <div className="w-10 h-10 rounded border-2 border-red-400 overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                              <img 
                                src={edit.output_image_url} 
                                alt="Generated" 
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none'
                                }}
                              />
                            </div>
                            <div className="absolute -top-6 left-0 bg-black text-white text-xs px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                              Generated
                            </div>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Edit History - Images from image_history array */}
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="space-y-1">
                        {edit.image_history && edit.image_history.length > 0 ? (
                          <div className="space-y-1">
                            {/* Show thumbnails from image_history array */}
                            <div className="flex items-center space-x-1">
                              {edit.image_history.slice(0, 3).map((historyUrl, index) => (
                                <div key={index} className="relative group">
                                  <div className="w-8 h-8 rounded border-2 border-purple-400 hover:border-purple-600 transition-colors cursor-pointer overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center"
                                       onClick={() => window.open(historyUrl, '_blank')}>
                                    <img
                                      src={historyUrl}
                                      alt={`Edit ${index + 1}`}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        e.currentTarget.style.display = 'none'
                                      }}
                                    />
                                  </div>
                                  <div className="absolute -top-6 left-0 bg-black text-white text-xs px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                                    Edit {index + 1}
                                  </div>
                                </div>
                              ))}
                              {edit.image_history.length > 3 && (
                                <div className="hidden"></div>
                              )}
                            </div>
                            
                            {/* Removed purple label and dot as requested */}
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
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className="text-gray-900 dark:text-white font-medium">
                        ${(edit.amount_spent || 0).toFixed(2)}
                      </span>
                    </td>

                    {/* Created At */}
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm">
                        <div className="text-gray-900 dark:text-white font-medium">
                          {edit.last_activity_relative}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {edit.created_at_formatted}
                        </div>
                      </div>
                    </td>

                    {/* Urgency */}
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getUrgencyColor(edit.urgency)}`}>
{edit.urgency}
                      </span>
                    </td>


                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          </div>
        ) : (
          /* Card View */
          <div className="w-full">
            {/* Navigation Header */}
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center space-x-4">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Card {globalCardIndex + 1} of {cardData.length || totalRecords}
                </div>
                <button
                  onClick={() => setViewMode('table')}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 underline"
                >
                  ← Back to Table (Row {currentCardIndex + 1})
                </button>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={prevCard}
                  disabled={currentCardIndex === 0 || cardLoading}
                  className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  <span>Previous</span>
                </button>
                <button
                  onClick={nextCard}
                  disabled={currentCardIndex === cardData.length - 1 || cardLoading}
                  className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
                >
                  <span>Next</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {cardLoading ? (
              <div className="flex justify-center items-center py-12">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="ml-3 text-gray-600 dark:text-gray-300">Loading all records for card view...</span>
              </div>
            ) : currentCard ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
              {/* Customer Info Header */}
              <div className="border-t-4 border-gray-600 dark:border-gray-500 rounded-t-xl p-4 bg-gray-50 dark:bg-gray-700/50">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full flex items-center justify-center">
                    <span className="text-white font-bold text-sm">
                      {currentCard.customer_name ? currentCard.customer_name.substring(0, 2).toUpperCase() : 'U'}
                    </span>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {currentCard.customer_name || 'Unknown Customer'}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {currentCard.customer_email}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500">
                      Created {currentCard.days_since_created} days ago
                    </div>
                  </div>
                </div>
              </div>

              {/* Feedback Notes Row */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Feedback Notes</div>
                <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                  {currentCard.feedback_notes || 'No feedback provided'}
                </div>
              </div>

              {/* Images - Two Column Layout */}
              <div className="mb-6" style={{ height: '1500px' }}>
                <div className="flex h-full">
                  {/* Left Column: Green Box */}
                  <div className="flex-1 border border-green-500 rounded-lg overflow-hidden h-full flex justify-center">
                    <div className="border border-gray-300 dark:border-gray-600 h-full flex justify-center" style={{ width: '650px' }}>
                      <div className="border border-orange-500 flex flex-col" style={{ width: '600px' }}>
                        <div className="bg-blue-500 w-full p-2.5" style={{ height: '600px' }}>
                          <div className="bg-gray-200 dark:bg-gray-300 w-full h-full">
                            {isFluxEditorOpen && currentCard.preprocessed_output_image_url ? (
                              <InlineFluxEditor
                                imageUrl={currentCard.preprocessed_output_image_url}
                                onProcessedImage={handleProcessedImage}
                                onError={handleFluxEditorError}
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                {currentCard.preprocessed_output_image_url ? (
                                  <img 
                                    src={currentCard.preprocessed_output_image_url} 
                                    alt="Preprocessed output" 
                                    className="max-w-full max-h-full object-contain"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none'
                                    }}
                                  />
                                ) : (
                                  <div className="text-gray-500 dark:text-gray-600 text-sm">
                                    No preprocessed image
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="bg-gray-800 w-full flex items-center justify-center" style={{ height: '200px' }}>
                          <button 
                            onClick={handleFluxEditorToggle}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                              isFluxEditorOpen 
                                ? 'bg-orange-600 hover:bg-orange-700 text-white' 
                                : 'bg-blue-500 hover:bg-blue-600 text-white'
                            }`}
                          >
                            {isFluxEditorOpen ? 'Close Editor' : 'Flux in painting'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Vertical Divider */}
                  <div className="w-px bg-gray-300 dark:bg-gray-600" style={{ height: '1500px' }}>
                  </div>

                  {/* Right Column: Blue Box */}
                  <div className="flex-1 border border-blue-500 rounded-lg overflow-hidden h-full flex justify-center">
                    <div className="border border-gray-300 dark:border-gray-600 h-full flex justify-center" style={{ width: '650px' }}>
                      <div className="border border-orange-500 flex flex-col overflow-hidden" style={{ width: '600px' }}>
                        {/* Image History - Scrollable list with most recent first */}
                        <div className="bg-gray-200 dark:bg-gray-300 w-full h-full overflow-y-auto p-2">
                          {currentCard.image_history && currentCard.image_history.length > 0 ? (
                            <div className="space-y-2">
                              {currentCard.image_history.map((imageUrl, index) => (
                                <div key={`${imageUrl}-${index}`} className="relative">
                                  <div className="bg-white rounded-lg p-2 shadow-sm border">
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-xs font-medium text-gray-600">
                                        {index === 0 ? 'Latest Edit' : `Edit ${index + 1}`}
                                      </span>
                                      <span className="text-xs text-gray-400">
                                        {index === 0 ? 'Most Recent' : ''}
                                      </span>
                                    </div>
                                    <div className="w-full aspect-square bg-gray-100 rounded overflow-hidden">
                                      <img 
                                        src={imageUrl} 
                                        alt={`Edit ${index + 1}`} 
                                        className="w-full h-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
                                        onClick={() => window.open(imageUrl, '_blank')}
                                        onError={(e) => {
                                          e.currentTarget.style.display = 'none'
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-600 text-sm">
                              No edit history yet
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>






            </div>
            ) : (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                No card data available
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
