'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { InlineFluxEditor } from '@/components/InlineFluxEditor'
import { ReactSketchCanvas } from "react-sketch-canvas"
import { Brush, Eraser, Eye, EyeOff, RotateCcw, Wand2, Sparkles, Zap } from "lucide-react"

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
  const [isGeminiEditorOpen, setIsGeminiEditorOpen] = useState(false)
  const [isOpenAIEditorOpen, setIsOpenAIEditorOpen] = useState(false)
  
  // Flux editing state
  const [fluxPrompt, setFluxPrompt] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [maskDataUrl, setMaskDataUrl] = useState<string>("")
  const [showMaskOverlay, setShowMaskOverlay] = useState(false)
  const [tool, setTool] = useState<"brush" | "eraser">("brush")
  const [brushSize, setBrushSize] = useState<number>(50)
  
  // Gemini 2.5 editing state
  const [geminiPrompt, setGeminiPrompt] = useState("")
  const [isGeminiGenerating, setIsGeminiGenerating] = useState(false)
  
  // OpenAI editing state
  const [openAIPrompt, setOpenAIPrompt] = useState("Your task is to generate an image that adheres to the specified style. Attached are three reference images that exemplify this target style. The last image is a photo reference that dictates the content and subject to be generated. Your goal is to depict the subject in our specified style. Ignore background. The style is chibi sticker. You should aim to depict the photo reference subject in a flattering yet accurate way. Bodies: simplified torsos only (waist-up) like a sticker.")
  const [isOpenAIGenerating, setIsOpenAIGenerating] = useState(false)
  
  // Canvas and image refs for flux editing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sketchRef = useRef<any>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 })
  const [naturalDimensions, setNaturalDimensions] = useState({ width: 0, height: 0 })
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [pageSize] = useState(100)
  
  // Job states for each record
  const [jobStates, setJobStates] = useState<Record<string, JobState>>({})

  // Email functionality state
  const [selectedImages, setSelectedImages] = useState<string[]>([])
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  const [isSendingCreditEmail, setIsSendingCreditEmail] = useState(false)

  // Flux editing helper functions
  const scaleMaskToNaturalSize = useCallback(async (displayMaskDataUrl: string) => {
    return new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(displayMaskDataUrl);
          return;
        }
        canvas.width = naturalDimensions.width;
        canvas.height = naturalDimensions.height;
        ctx.drawImage(img, 0, 0, naturalDimensions.width, naturalDimensions.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = displayMaskDataUrl;
    });
  }, [naturalDimensions]);

  const createBinaryMask = useCallback(async (rawDataUrl: string) => {
    return new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha > 0) {
            data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
          } else {
            data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
          }
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = rawDataUrl;
    });
  }, []);

  const generateMaskDataUrl = useCallback(async () => {
    if (!sketchRef.current || naturalDimensions.width === 0) return;
    try {
      const rawDataUrl = await sketchRef.current.exportImage('png');
      const scaledMaskDataUrl = await scaleMaskToNaturalSize(rawDataUrl);
      const binaryMaskDataUrl = await createBinaryMask(scaledMaskDataUrl);
      setMaskDataUrl(binaryMaskDataUrl);
    } catch (error) {
      console.error('Error generating mask:', error);
    }
  }, [createBinaryMask, scaleMaskToNaturalSize, naturalDimensions]);

  const handleImageLoad = () => {
    if (imageRef.current) {
      const img = imageRef.current;
      setNaturalDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      
      // Get the actual displayed size
      const rect = img.getBoundingClientRect();
      setImageDimensions({ 
        width: Math.round(rect.width), 
        height: Math.round(rect.height) 
      });
    }
  };

  const clearMask = async () => {
    if (!sketchRef.current) return;
    try {
      await sketchRef.current.clearCanvas();
      setMaskDataUrl("");
    } catch (e) {
      console.error(e);
    }
  };

  // Keep eraser mode in sync
  useEffect(() => {
    if (sketchRef.current) {
      sketchRef.current.eraseMode(tool === 'eraser');
    }
  }, [tool]);

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

      // Query ALL records (no pagination limit) - we'll sort and paginate after
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
            if (aStickerEdit.urgency !== bStickerEdit.urgency) {
              // Map urgency text to numbers for comparison
              const urgencyMap = { 'do it now': 3, 'very high': 2, 'high': 1 }
              const aUrgencyNum = urgencyMap[aStickerEdit.urgency as keyof typeof urgencyMap] || 0
              const bUrgencyNum = urgencyMap[bStickerEdit.urgency as keyof typeof urgencyMap] || 0
              return bUrgencyNum - aUrgencyNum // Higher urgency first
            }
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

        // Apply pagination to the sorted data
        const offset = (page - 1) * pageSize
        const paginatedData = transformedData.slice(offset, offset + pageSize)
        
        setData(paginatedData)
        
        // Initialize job states for paginated records only
        const initialStates: Record<string, JobState> = {}
        paginatedData.forEach(edit => {
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
            if (aStickerEdit.urgency !== bStickerEdit.urgency) {
              // Map urgency text to numbers for comparison
              const urgencyMap = { 'do it now': 3, 'very high': 2, 'high': 1 }
              const aUrgencyNum = urgencyMap[aStickerEdit.urgency as keyof typeof urgencyMap] || 0
              const bUrgencyNum = urgencyMap[bStickerEdit.urgency as keyof typeof urgencyMap] || 0
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
    // Clear selected images when switching cards
    clearImageSelection()
  }

  const prevCard = () => {
    setCurrentCardIndex((prev) => (prev - 1 + cardData.length) % cardData.length)
    // Clear selected images when switching cards
    clearImageSelection()
  }

  const goToCard = (index: number) => {
    setCurrentCardIndex(Math.max(0, Math.min(index, cardData.length - 1)))
    // Clear selected images when switching cards
    clearImageSelection()
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
    // Close other editors if they're open
    if (!isFluxEditorOpen && isGeminiEditorOpen) {
      setIsGeminiEditorOpen(false)
      setGeminiPrompt("")
    }
    if (!isFluxEditorOpen && isOpenAIEditorOpen) {
      setIsOpenAIEditorOpen(false)
    }
    // Reset flux state when closing
    if (isFluxEditorOpen) {
      setFluxPrompt("")
      setMaskDataUrl("")
      setShowMaskOverlay(false)
      clearMask()
    }
  }

  // Handle Gemini editor toggle
  const handleGeminiEditorToggle = () => {
    setIsGeminiEditorOpen(!isGeminiEditorOpen)
    // Close other editors if they're open
    if (!isGeminiEditorOpen && isFluxEditorOpen) {
      setIsFluxEditorOpen(false)
      setFluxPrompt("")
      setMaskDataUrl("")
      setShowMaskOverlay(false)
      clearMask()
    }
    if (!isGeminiEditorOpen && isOpenAIEditorOpen) {
      setIsOpenAIEditorOpen(false)
    }
    // Reset Gemini state when closing
    if (isGeminiEditorOpen) {
      setGeminiPrompt("")
    }
  }

  // Handle OpenAI editor toggle
  const handleOpenAIEditorToggle = () => {
    setIsOpenAIEditorOpen(!isOpenAIEditorOpen)
    // Close other editors if they're open
    if (!isOpenAIEditorOpen && isFluxEditorOpen) {
      setIsFluxEditorOpen(false)
      setFluxPrompt("")
      setMaskDataUrl("")
      setShowMaskOverlay(false)
      clearMask()
    }
    if (!isOpenAIEditorOpen && isGeminiEditorOpen) {
      setIsGeminiEditorOpen(false)
      setGeminiPrompt("")
    }
    // Reset OpenAI state when closing (but keep the default prompt)
    if (isOpenAIEditorOpen) {
      setOpenAIPrompt("Your task is to generate an image that adheres to the specified style. Attached are three reference images that exemplify this target style. The last image is a photo reference that dictates the content and subject to be generated. Your goal is to depict the subject in our specified style. Ignore background. The style is chibi sticker. You should aim to depict the photo reference subject in a flattering yet accurate way. Bodies: simplified torsos only (waist-up) like a sticker.")
    }
  }

  // Handle flux generation
  const handleFluxGenerate = useCallback(async () => {
    if (!currentCard?.preprocessed_output_image_url) return;
    
    if (!fluxPrompt.trim()) {
      handleFluxEditorError("Please enter a prompt describing what you want to inpaint");
      return;
    }
    if (!maskDataUrl || maskDataUrl.length < 1000) {
      handleFluxEditorError("Please paint areas on the image to create a mask");
      return;
    }
    try {
      setIsGenerating(true);
      const formData = new FormData();
      formData.append('image_url', currentCard.preprocessed_output_image_url);
      formData.append('prompt', fluxPrompt.trim());
      const maskResponse = await fetch(maskDataUrl);
      const maskBlob = await maskResponse.blob();
      if (maskBlob.size < 1000) {
        throw new Error('Mask appears to be empty or too small. Please paint some areas white to create a mask.');
      }
      formData.append('mask', maskBlob, 'mask.png');
      const response = await fetch('/api/kontext-image', { method: 'POST', body: formData });
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}: Failed to process with FLUX Kontext LoRA`;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error) errorMessage = errorData.error;
        } catch {
          if (errorText) errorMessage = errorText;
        }
        throw new Error(errorMessage);
      }
      const result = await response.json();
      if (!result.success || !result.data?.imageUrl) throw new Error(result.error || 'No processed image URL in response');
      handleProcessedImage(result.data.imageUrl);
    } catch (e) {
      console.error('Flux generate error:', e);
      const msg = e instanceof Error ? e.message : 'Failed to process with FLUX Kontext LoRA';
      handleFluxEditorError(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [fluxPrompt, maskDataUrl, currentCard?.preprocessed_output_image_url]);

  // Handle Gemini generation
  const handleGeminiGenerate = useCallback(async () => {
    if (!currentCard?.preprocessed_output_image_url) return;
    
    if (!geminiPrompt.trim()) {
      handleFluxEditorError("Please enter a prompt describing what you want to edit");
      return;
    }
    
    try {
      setIsGeminiGenerating(true);
      const formData = new FormData();
      formData.append('prompt', geminiPrompt.trim());
      formData.append('image_urls', currentCard.preprocessed_output_image_url);
      formData.append('num_images', '1');
      formData.append('output_format', 'png');
      
      const response = await fetch('/api/gemini-25-edit', { 
        method: 'POST', 
        body: formData 
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}: Failed to process with Gemini 2.5`;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error) errorMessage = errorData.error;
        } catch {
          if (errorText) errorMessage = errorText;
        }
        throw new Error(errorMessage);
      }
      
      const result = await response.json();
      if (!result.success || !result.data?.images || result.data.images.length === 0) {
        throw new Error(result.error || 'No processed images in response');
      }
      
      // Use the first generated image
      const processedImageUrl = result.data.images[0].url;
      handleProcessedImage(processedImageUrl);
      
    } catch (e) {
      console.error('Gemini generate error:', e);
      const msg = e instanceof Error ? e.message : 'Failed to process with Gemini 2.5';
      handleFluxEditorError(msg);
    } finally {
      setIsGeminiGenerating(false);
    }
  }, [geminiPrompt, currentCard?.preprocessed_output_image_url]);

  // Handle OpenAI generation
  const handleOpenAIGenerate = useCallback(async () => {
    if (!currentCard?.preprocessed_output_image_url) return;
    
    if (!openAIPrompt.trim()) {
      handleFluxEditorError("Please enter a prompt for image generation");
      return;
    }
    
    try {
      setIsOpenAIGenerating(true);
      
      const requestBody = {
        inputImages: [
          {
            type: 'url',
            data: currentCard.preprocessed_output_image_url
          }
        ],
        prompt: openAIPrompt.trim()
      };
      
      const response = await fetch(
        `https://yqvsxaifoqoohljhidrp.supabase.co/functions/v1/generate-image`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}: Failed to process with OpenAI`;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error) errorMessage = errorData.error;
        } catch {
          if (errorText) errorMessage = errorText;
        }
        throw new Error(errorMessage);
      }
      
      const result = await response.json();
      if (!result.success || !result.imageData) {
        throw new Error(result.error || 'No processed image data in response');
      }
      
      // Convert base64 to buffer and upload to public storage so server can fetch for attachments
      const base64Data = result.imageData;
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);

      // Upload to our new upload-image API to obtain a public URL that server can fetch
      const uploadResp = await fetch('/api/upload-image', {
        method: 'POST',
        body: (() => {
          const fd = new FormData();
          const file = new File([byteArray], `openai-result-${Date.now()}.png`, { type: 'image/png' });
          fd.append('file', file);
          return fd;
        })()
      });

      if (uploadResp.ok) {
        const uploadData = await uploadResp.json();
        const uploadedUrl = uploadData?.url;
        if (uploadedUrl) {
          handleProcessedImage(uploadedUrl);
        } else {
          // Fallback: keep local blob if upload failed
          const blob = new Blob([byteArray], { type: 'image/png' });
          const localUrl = URL.createObjectURL(blob);
          handleProcessedImage(localUrl);
        }
      } else {
        // Fallback: keep local blob if upload failed
        const blob = new Blob([byteArray], { type: 'image/png' });
        const localUrl = URL.createObjectURL(blob);
        handleProcessedImage(localUrl);
      }
      
    } catch (e) {
      console.error('OpenAI generate error:', e);
      const msg = e instanceof Error ? e.message : 'Failed to process with OpenAI';
      handleFluxEditorError(msg);
    } finally {
      setIsOpenAIGenerating(false);
    }
  }, [openAIPrompt, currentCard?.preprocessed_output_image_url]);

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

  // Email functionality
  const toggleImageSelection = (imageUrl: string) => {
    setSelectedImages(prev => {
      if (prev.includes(imageUrl)) {
        return prev.filter(url => url !== imageUrl)
      } else {
        return [...prev, imageUrl]
      }
    })
  }

  const clearImageSelection = () => {
    setSelectedImages([])
  }

  const sendFixedArtwork = async () => {
    if (!currentCard || selectedImages.length === 0) {
      alert('Please select at least one image to send.')
      return
    }

    try {
      setIsSendingEmail(true)

      const emailData = {
        ticketId: currentCard.sticker_edit_id,
        ticketNumber: currentCard.model_run_id,
        customerEmail: currentCard.customer_email,
        customerName: currentCard.customer_name,
        feedback: currentCard.feedback_notes,
        correctionType: 'manual-correction',
        originalImageUrl: currentCard.preprocessed_output_image_url || currentCard.output_image_url,
        correctedImageUrls: selectedImages,
        isDraft: false,
        sendToCustomer: true,
        supportTeamName: 'MakeMeASticker.com',
        supportEmail: 'support@makemeasticker.com'
      }

      console.log('📧 Sending email with data:', {
        customerEmail: emailData.customerEmail,
        selectedImages: selectedImages.length,
        ticketNumber: emailData.ticketNumber
      })

      const response = await fetch('/api/send-front-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailData),
      })

      const result = await response.json()

      if (result.success) {
        alert(`Email sent successfully to ${currentCard.customer_email}!\n\nMessage ID: ${result.messageId}`)
        
        // Clear selection after successful send
        clearImageSelection()
        
        console.log('✅ Email sent successfully:', result)
      } else {
        console.error('❌ Email send failed:', result.error)
        alert(`Failed to send email: ${result.error}`)
      }
    } catch (error) {
      console.error('💥 Error sending email:', error)
      alert(`Error sending email: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSendingEmail(false)
    }
  }

  const sendCreditAndEmail = async () => {
    if (!currentCard) return
    try {
      setIsSendingCreditEmail(true)

      const emailData = {
        ticketId: currentCard.sticker_edit_id,
        ticketNumber: currentCard.model_run_id,
        customerEmail: currentCard.customer_email,
        customerName: currentCard.customer_name,
        feedback: currentCard.feedback_notes,
        correctionType: 'credit-issued',
        originalImageUrl: currentCard.preprocessed_output_image_url || currentCard.output_image_url,
        correctedImageUrls: selectedImages, // allow optional attachments if selected
        isDraft: false,
        sendToCustomer: true,
        supportTeamName: 'MakeMeASticker.com',
        supportEmail: 'support@makemeasticker.com',
        emailMode: 'credit'
      } as const

      console.log('📧 Sending credit email with data:', {
        customerEmail: emailData.customerEmail,
        selectedImages: selectedImages.length,
        ticketNumber: emailData.ticketNumber
      })

      const response = await fetch('/api/send-front-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emailData)
      })

      const result = await response.json()
      if (result.success) {
        alert(`Credit email sent to ${currentCard.customer_email}!\n\nMessage ID: ${result.messageId}`)
        clearImageSelection()
        console.log('✅ Credit email sent:', result)
      } else {
        console.error('❌ Credit email failed:', result.error)
        alert(`Failed to send credit email: ${result.error}`)
      }
    } catch (error) {
      console.error('💥 Error sending credit email:', error)
      alert(`Error sending credit email: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSendingCreditEmail(false)
    }
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
        {/* View Toggle (only show here for table view). Card view toggle is embedded in header. */}
        {viewMode === 'table' && (
          <div className="mb-4 grid grid-cols-3 items-center">
            {/* Left: pagination text */}
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, totalRecords)} of {totalRecords} records
            </div>
            {/* Center: toggle */}
            <div className="flex justify-center">
              <div className="flex bg-white dark:bg-gray-800 rounded-lg p-1 shadow-sm border border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setViewMode('card')}
                  className="px-4 py-2 rounded-md text-sm font-medium transition-colors text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                >
                  Card View
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-blue-500 text-white shadow-sm"
                >
                  Table View
                </button>
              </div>
            </div>
            {/* Right: prev/next */}
            <div className="flex justify-end items-center gap-2">
              <button
                onClick={goToPrevPage}
                disabled={currentPage === 1}
                className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span>Previous</span>
              </button>
              <button
                onClick={goToNextPage}
                disabled={currentPage >= Math.ceil(totalRecords / pageSize)}
                className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
              >
                <span>Next</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}

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
            {/* Pagination moved to unified header above */}
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
                        {((currentPage - 1) * pageSize) + index + 1}
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
            {/* Card Header Row: Left (card index + back), Center (toggle), Right (prev/next) */}
            <div className="mb-4 grid grid-cols-3 items-center">
              {/* Left */}
              <div className="flex items-center gap-4">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                 {globalCardIndex + 1} of {cardData.length || totalRecords}
                </div>
              </div>

              {/* Center */}
              <div className="flex justify-center">
                <div className="flex bg-white dark:bg-gray-800 rounded-lg p-1 shadow-sm border border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => setViewMode('card')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors bg-blue-500 text-white shadow-sm`}
                  >
                    Card View
                  </button>
                  <button
                    onClick={() => setViewMode('table')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white`}
                  >
                    Table View
                  </button>
                </div>
              </div>

              {/* Right */}
              <div className="flex justify-end items-center gap-2">
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
                <div className="flex items-center justify-between">
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
                  
                  {/* Email Controls */}
                  <div className="flex items-center space-x-3">
                    {/* Email Selection Info */}
                    {selectedImages.length > 0 && (
                      <div className="flex items-center space-x-2 text-xs text-gray-600">
                        <span>{selectedImages.length} image{selectedImages.length !== 1 ? 's' : ''} selected</span>
                        <button
                          onClick={clearImageSelection}
                          className="text-gray-500 hover:text-gray-700 underline"
                        >
                          Clear
                        </button>
                      </div>
                    )}
                    
                    {/* Give Credit and Email Button */}
                    <button
                      onClick={sendCreditAndEmail}
                      disabled={isSendingCreditEmail}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        isSendingCreditEmail
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-amber-600 text-white hover:bg-amber-700 shadow-sm'
                      }`}
                    >
                      {isSendingCreditEmail ? (
                        <span className="inline-flex items-center">
                          <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2"></span>
                          Sending...
                        </span>
                      ) : (
                        'Give Credit and Email'
                      )}
                    </button>

                    {/* Send Fixed Artwork Button */}
                    <button
                      onClick={sendFixedArtwork}
                      disabled={selectedImages.length === 0 || isSendingEmail}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        selectedImages.length === 0 || isSendingEmail
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-green-600 text-white hover:bg-green-700 shadow-sm'
                      }`}
                    >
                      {isSendingEmail ? (
                        <span className="inline-flex items-center">
                          <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2"></span>
                          Sending...
                        </span>
                      ) : (
                        'Send Fixed Artwork'
                      )}
                    </button>
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
                        {/* Image Container - Fixed height */}
                        <div className="bg-blue-500 w-full p-2.5" style={{ height: '600px' }}>
                          <div className="bg-gray-200 dark:bg-gray-300 w-full h-full relative">
                            <div className="w-full h-full flex items-center justify-center">
                              {currentCard.preprocessed_output_image_url ? (
                                <div className="relative">
                                  <img 
                                    ref={imageRef}
                                    src={currentCard.preprocessed_output_image_url} 
                                    alt="Preprocessed output" 
                                    className="max-w-full max-h-full object-contain"
                                    onLoad={handleImageLoad}
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none'
                                    }}
                                  />
                                  
                                  {/* Drawing Canvas Overlay - only when flux editor is open */}
                                  {isFluxEditorOpen && imageDimensions.width > 0 && (
                                    <div
                                      className="absolute top-0 left-0 pointer-events-auto"
                                      style={{ 
                                        width: imageDimensions.width, 
                                        height: imageDimensions.height,
                                        left: '50%',
                                        top: '50%',
                                        transform: 'translate(-50%, -50%)'
                                      }}
                                    >
                                      <ReactSketchCanvas
                                        ref={sketchRef}
                                        style={{ border: 'none', borderRadius: '0px' }}
                                        width={`${imageDimensions.width}px`}
                                        height={`${imageDimensions.height}px`}
                                        strokeWidth={brushSize}
                                        strokeColor="rgba(34, 197, 94, 0.6)"
                                        canvasColor="transparent"
                                        allowOnlyPointerType="all"
                                        onStroke={generateMaskDataUrl}
                                      />
                                    </div>
                                  )}
                                  
                                  {/* Mask Overlay */}
                                  {isFluxEditorOpen && showMaskOverlay && maskDataUrl && imageDimensions.width > 0 && (
                                    <div
                                      className="absolute top-0 left-0 pointer-events-none"
                                      style={{ 
                                        width: imageDimensions.width, 
                                        height: imageDimensions.height,
                                        left: '50%',
                                        top: '50%',
                                        transform: 'translate(-50%, -50%)'
                                      }}
                                    >
                                      <img
                                        src={maskDataUrl}
                                        alt="Binary mask visualization"
                                        className="object-contain opacity-70"
                                        style={{
                                          width: `${imageDimensions.width}px`,
                                          height: `${imageDimensions.height}px`,
                                          mixBlendMode: 'multiply',
                                          filter: 'hue-rotate(240deg) saturate(1.5)'
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-gray-500 dark:text-gray-600 text-sm">
                                  No preprocessed image
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        {/* Toolbar beneath the image */}
                        <div className="bg-white border-t border-gray-300 w-full p-3">
                          <div className="flex items-center justify-center gap-3">
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
                            
                            <button 
                              onClick={handleGeminiEditorToggle}
                              className={`px-4 py-2 rounded-lg font-medium transition-colors inline-flex items-center gap-2 ${
                                isGeminiEditorOpen 
                                  ? 'bg-purple-600 hover:bg-purple-700 text-white' 
                                  : 'bg-green-500 hover:bg-green-600 text-white'
                              }`}
                            >
                              <Sparkles className="w-4 h-4" />
                              {isGeminiEditorOpen ? 'Close Gemini' : 'Gemini 2.5 Edit'}
                            </button>
                            
                            <button 
                              onClick={handleOpenAIEditorToggle}
                              className={`px-4 py-2 rounded-lg font-medium transition-colors inline-flex items-center gap-2 ${
                                isOpenAIEditorOpen 
                                  ? 'bg-yellow-600 hover:bg-yellow-700 text-white' 
                                  : 'bg-indigo-500 hover:bg-indigo-600 text-white'
                              }`}
                            >
                              <Zap className="w-4 h-4" />
                              {isOpenAIEditorOpen ? 'Close OpenAI' : 'OpenAI Generate'}
                            </button>
                          </div>
                        </div>
                        
                        {/* Expandable Tools Section */}
                        {isFluxEditorOpen && (
                          <div className="bg-gray-50 border-t border-gray-300 w-full p-3 space-y-3" style={{ height: '140px' }}>
                            {/* Brush Controls */}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setTool('brush')}
                                className={`p-2 rounded ${tool === 'brush' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'} hover:bg-blue-500 hover:text-white`}
                                title="Brush (B)"
                              >
                                <Brush className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setTool('eraser')}
                                className={`p-2 rounded ${tool === 'eraser' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'} hover:bg-blue-500 hover:text-white`}
                                title="Eraser (E)"
                              >
                                <Eraser className="w-4 h-4" />
                              </button>

                              <div className="flex items-center gap-2 ml-2">
                                <span className="text-xs text-gray-600">Size</span>
                                <input
                                  type="range"
                                  min={5}
                                  max={200}
                                  value={brushSize}
                                  onChange={(e) => setBrushSize(Number(e.target.value))}
                                  className="w-20"
                                />
                                <span className="text-xs w-8 text-right font-mono">{brushSize}</span>
                              </div>

                              <button
                                onClick={() => setShowMaskOverlay((v) => !v)}
                                className={`p-2 rounded ${showMaskOverlay ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700'} hover:bg-purple-500 hover:text-white ml-2`}
                                title="Toggle mask overlay (M)"
                              >
                                {showMaskOverlay ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>

                              <button
                                onClick={clearMask}
                                className="p-2 rounded bg-red-600 text-white hover:bg-red-700"
                                title="Clear mask"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            </div>

                            {/* Prompt Input */}
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={fluxPrompt}
                                onChange={(e) => setFluxPrompt(e.target.value)}
                                placeholder="Describe what to inpaint…"
                                className="flex-1 px-3 py-2 text-sm border rounded"
                                maxLength={500}
                                disabled={isGenerating}
                              />
                              <button
                                onClick={handleFluxGenerate}
                                disabled={isGenerating || !fluxPrompt.trim() || !maskDataUrl}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
                              >
                                {isGenerating ? (
                                  <span className="inline-flex items-center gap-2">
                                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                                    Generating…
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-2">
                                    <Wand2 className="w-4 h-4" />
                                    Generate
                                  </span>
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                        
                        {/* Gemini 2.5 Tools Section */}
                        {isGeminiEditorOpen && (
                          <div className="bg-gray-50 border-t border-gray-300 w-full p-3" style={{ height: '80px' }}>
                            {/* Prompt Input for Gemini */}
                            <div className="flex items-center gap-2 h-full">
                              <input
                                type="text"
                                value={geminiPrompt}
                                onChange={(e) => setGeminiPrompt(e.target.value)}
                                placeholder="Describe how you want to edit this image…"
                                className="flex-1 px-3 py-2 text-sm border rounded"
                                maxLength={500}
                                disabled={isGeminiGenerating}
                              />
                              <button
                                onClick={handleGeminiGenerate}
                                disabled={isGeminiGenerating || !geminiPrompt.trim()}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                              >
                                {isGeminiGenerating ? (
                                  <span className="inline-flex items-center gap-2">
                                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                                    Generating…
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-2">
                                    <Sparkles className="w-4 h-4" />
                                    Generate
                                  </span>
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                        
                        {/* OpenAI Tools Section */}
                        {isOpenAIEditorOpen && (
                          <div className="bg-gray-50 border-t border-gray-300 w-full p-3 space-y-3" style={{ height: '120px' }}>
                            {/* Editable Prompt for OpenAI */}
                            <div className="flex flex-col gap-2 h-full">
                              <textarea
                                value={openAIPrompt}
                                onChange={(e) => setOpenAIPrompt(e.target.value)}
                                placeholder="Enter your custom prompt for OpenAI image generation…"
                                className="flex-1 px-3 py-2 text-sm border rounded resize-none"
                                maxLength={1000}
                                disabled={isOpenAIGenerating}
                                rows={2}
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setOpenAIPrompt("Your task is to generate an image that adheres to the specified style. Attached are three reference images that exemplify this target style. The last image is a photo reference that dictates the content and subject to be generated. Your goal is to depict the subject in our specified style. Ignore background. The style is chibi sticker. You should aim to depict the photo reference subject in a flattering yet accurate way. Bodies: simplified torsos only (waist-up) like a sticker.")}
                                  className="px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                                >
                                  Reset to Default
                                </button>
                                <button
                                  onClick={handleOpenAIGenerate}
                                  disabled={isOpenAIGenerating || !openAIPrompt.trim()}
                                  className="inline-flex items-center gap-2 px-4 py-2 rounded bg-yellow-600 text-white hover:bg-yellow-700 disabled:opacity-50"
                                >
                                  {isOpenAIGenerating ? (
                                    <span className="inline-flex items-center gap-2">
                                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                                      Generating…
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-2">
                                      <Zap className="w-4 h-4" />
                                      Generate
                                    </span>
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
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
                                      <div className="flex items-center space-x-2">
                                        <span className="text-xs text-gray-400">
                                          {index === 0 ? 'Most Recent' : ''}
                                        </span>
                                        {/* Checkbox for email selection */}
                                        <label className="flex items-center cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={selectedImages.includes(imageUrl)}
                                            onChange={() => toggleImageSelection(imageUrl)}
                                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                                          />
                                          <span className="ml-1 text-xs text-gray-600">Email</span>
                                        </label>
                                      </div>
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
