'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { globalClientJobQueue } from '@/lib/client-job-queue'
import { InlineFluxEditor } from '@/components/InlineFluxEditor'
import { ReactSketchCanvas } from "react-sketch-canvas"
import { Brush, Eraser, Eye, EyeOff, RotateCcw, Wand2, Sparkles, Zap, Trash2 } from "lucide-react"

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
  internal_note: string | null
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

// Helper function to format time ago
const formatTimeAgo = (days: number, hours: number, minutes: number): string => {
  if (days > 0) {
    const remainingHours = hours % 24;
    const remainingMinutes = minutes % 60;
    
    let result = `${days} day${days !== 1 ? 's' : ''}`;
    if (remainingHours > 0) {
      result += ` ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`;
    }
    if (remainingMinutes > 0 && days < 7) { // Only show minutes for recent days
      result += ` ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
    }
    return result + ' ago';
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    let result = `${hours} hour${hours !== 1 ? 's' : ''}`;
    if (remainingMinutes > 0) {
      result += ` ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
    }
    return result + ' ago';
  } else {
    return `${Math.max(1, minutes)} minute${minutes !== 1 ? 's' : ''} ago`;
  }
};



export default function Main() {
  const [data, setData] = useState<StickerEdit[]>([])
  const [cardData, setCardData] = useState<StickerEdit[]>([])
  const [loading, setLoading] = useState(true)
  const [cardLoading, setCardLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'card'>('card')
  const [sortMode, setSortMode] = useState<'priority' | 'newest'>('newest')
  const [currentCardIndex, setCurrentCardIndex] = useState(0)
  const [isFluxEditorOpen, setIsFluxEditorOpen] = useState(false)
  const [isGeminiEditorOpen, setIsGeminiEditorOpen] = useState(true)
  const [isOpenAIEditorOpen, setIsOpenAIEditorOpen] = useState(false)
  
  // Flux editing state
  const [fluxPrompt, setFluxPrompt] = useState("")
  const [fluxBaseImageUrl, setFluxBaseImageUrl] = useState<string>("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [maskDataUrl, setMaskDataUrl] = useState<string>("")
  const [showMaskOverlay, setShowMaskOverlay] = useState(false)
  const [tool, setTool] = useState<"brush" | "eraser">("brush")
  const [brushSize, setBrushSize] = useState<number>(50)
  
  // Gemini 2.5 editing state
  const [geminiPrompt, setGeminiPrompt] = useState("")
  const [geminiInputImages, setGeminiInputImages] = useState<string[]>([])
  const [isGeminiGenerating, setIsGeminiGenerating] = useState(false)
  
  // OpenAI editing state
  const [openAIPrompt, setOpenAIPrompt] = useState("Your task is to generate an image that adheres to the specified style. Attached are three reference images that exemplify this target style. The last image is a photo reference that dictates the content and subject to be generated. Your goal is to depict the subject in our specified style. Ignore background. The style is chibi sticker. You should aim to depict the photo reference subject in a flattering yet accurate way. Bodies: simplified torsos only (waist-up) like a sticker.")
  const [openAIInputImages, setOpenAIInputImages] = useState<string[]>([])
  const [isOpenAIGenerating, setIsOpenAIGenerating] = useState(false)
  // Shared selection for tool inputs (Gemini/OpenAI); separate from email selection
  const [toolSelectedImages, setToolSelectedImages] = useState<string[]>([])
  
  // Enhanced prompts for images
  const [enhancedPrompts, setEnhancedPrompts] = useState<Record<string, string>>({})
  
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
  const fetchStickerEdits = useCallback(async (page: number = 1) => {
    setLoading(true)
    try {
      // First get total count from y_sticker_edits
      const { count, error: countError } = await supabase
        .from('y_sticker_edits')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())

      if (countError) {
        console.error('Error getting count:', countError)
        return
      }

      setTotalRecords(count || 0)

      // Query from y_sticker_edits table and join to model_run
      const { data: stickerEdits, error } = await supabase
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
            feedback_addressed,
            reaction
          )
        `)
        .gte('created_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching sticker edits:', error)
        console.error('Error details:', JSON.stringify(error, null, 2))
        return
      }

      if (stickerEdits) {
        // Filter out records where model_run data is missing or doesn't meet criteria
        const validEdits = stickerEdits.filter(edit => 
          edit.model_run && 
          edit.model_run.reaction === 'negative' && 
          !edit.model_run.feedback_addressed
        )
        
        // Get unique user IDs to fetch Stripe spending data
        const userIds = [...new Set(validEdits
          .map(edit => edit.model_run.user_id)
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

        // Sort the data using the selected sort mode
        let sortedEdits
        if (sortMode === 'newest') {
          sortedEdits = [...validEdits].sort((a, b) => {
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          })
        } else {
          // Priority sorting (existing 4-bucket system)
          sortedEdits = [...validEdits].sort((a, b) => {
            // Get user spending totals
            const aSpending = userSpending[a.model_run.user_id.toString()] || 0
            const bSpending = userSpending[b.model_run.user_id.toString()] || 0
            
            // Check for mail order customers
            const aHasMailOrder = stripeData?.some(event => 
              event.user_id === a.model_run.user_id.toString() && event.pack_type === 'mail_order'
            ) || false
            const bHasMailOrder = stripeData?.some(event => 
              event.user_id === b.model_run.user_id.toString() && event.pack_type === 'mail_order'
            ) || false
            
            // Bucket 1: Urgency records (urgency IS NOT NULL)
            const aHasUrgency = a.urgency !== null && a.urgency !== undefined
            const bHasUrgency = b.urgency !== null && b.urgency !== undefined
            
            if (aHasUrgency && !bHasUrgency) return -1
            if (!aHasUrgency && bHasUrgency) return 1
            if (aHasUrgency && bHasUrgency) {
              // Within urgency bucket: higher urgency first, then older created_at
              if (a.urgency !== b.urgency) {
                // Map urgency text to numbers for comparison
                const urgencyMap = { 'do it now': 3, 'very high': 2, 'high': 1 }
                const aUrgencyNum = urgencyMap[a.urgency as keyof typeof urgencyMap] || 0
                const bUrgencyNum = urgencyMap[b.urgency as keyof typeof urgencyMap] || 0
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
        }

        // Transform the sorted data to match our interface with real Stripe spending data
        const transformedData = sortedEdits.map(stickerEdit => {
          const modelRun = stickerEdit.model_run
          const now = new Date()
          const createdAt = new Date(stickerEdit.created_at)
          const updatedAt = stickerEdit.updated_at ? new Date(stickerEdit.updated_at) : createdAt
          const userEmail = userEmailMap[modelRun.user_id] || null
          console.log('Data transformation - user_id:', modelRun.user_id, 'userEmail:', userEmail, 'userEmailMap keys:', Object.keys(userEmailMap))
          
          const diffMs = now.getTime() - createdAt.getTime()
          const updateDiffMs = updatedAt.getTime() - createdAt.getTime()
          const purchaseToEditMs = createdAt.getTime() - new Date(modelRun.created_at).getTime()
          
          // Calculate bucket for this record
          const userSpendingAmount = userSpending[modelRun.user_id.toString()] || 0
          const hasMailOrder = stripeData?.some(event => 
            event.user_id === modelRun.user_id.toString() && event.pack_type === 'mail_order'
          ) || false
          
          let bucket: 'Urgent' | 'Big Spender' | 'Print Order' | 'Remainder'
          if (stickerEdit.urgency !== null && stickerEdit.urgency !== undefined) {
            bucket = 'Urgent'
          } else if (hasMailOrder) {
            bucket = 'Print Order'
          } else if (userSpendingAmount > 9) {
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
            customer_email: userEmail || 'No email',
            customer_name: `User ${modelRun.user_id}` || 'Unknown',
            user_email: userEmail || undefined, // Preloaded user email
            feedback_notes: modelRun.feedback_notes || 'No feedback provided',
            input_image_url: modelRun.input_image_url || '',
            output_image_url: modelRun.output_image_url || '',
            preprocessed_output_image_url: modelRun.preprocessed_output_image_url || '',
            initial_edit_image_url: stickerEdit.image_history && stickerEdit.image_history.length > 0 ? stickerEdit.image_history[0] : '',
            image_history: stickerEdit.image_history || [],
            internal_note: stickerEdit.internal_note || null,
            amount_spent: userSpending[modelRun.user_id.toString()] || 0, // Real Stripe spending data
            purchased_at: modelRun.created_at,
            edit_created_at: stickerEdit.created_at,
            edit_updated_at: stickerEdit.updated_at,
            
            // Enhanced timing calculations
            days_since_created: Math.floor(diffMs / (1000 * 60 * 60 * 24)),
            hours_since_created: Math.floor(diffMs / (1000 * 60 * 60)),
            minutes_since_created: Math.floor(diffMs / (1000 * 60)),
            time_spent_on_edit: Math.max(1, Math.floor(updateDiffMs / (1000 * 60))), // Minutes between creation and last update
            purchase_to_edit_delay: Math.floor(Math.abs(purchaseToEditMs) / (1000 * 60 * 60)), // Hours from purchase to edit request
            last_activity_relative: getRelativeTime(stickerEdit.created_at),
            created_at_formatted: new Date(stickerEdit.created_at).toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric', 
              hour: 'numeric', 
              minute: '2-digit',
              hour12: true 
            }),
            
            image_count: stickerEdit.image_history ? stickerEdit.image_history.length : 1,
            urgency_priority: stickerEdit.urgency ? Number(stickerEdit.urgency) : 5
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
  }, [sortMode, pageSize])

  // Fetch ALL records for card view (no pagination, no image loading)
  const fetchCardViewData = useCallback(async () => {
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
            image_history,
            internal_note
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

        // Sort using the selected sort mode  
        let sortedEdits
        if (sortMode === 'newest') {
          sortedEdits = [...stickerEdits].sort((a, b) => {
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          })
        } else {
          // Priority sorting (existing 4-bucket system)
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
        }

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
  }, [sortMode])

  // Load data on component mount and when page changes
  useEffect(() => {
    fetchStickerEdits(currentPage)
  }, [currentPage, sortMode, fetchStickerEdits])

  // Load card data when switching to card view or sort mode changes
  useEffect(() => {
    if (viewMode === 'card') {
      fetchCardViewData()
    }
  }, [viewMode, fetchCardViewData, sortMode])

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

  // Infer which tool created an edit based on the stored image URL/filename
  const getToolLabel = (imageUrl: string): string => {
    const lower = (imageUrl || '').toLowerCase()
    if (lower.includes('kontext') || lower.includes('flux')) return 'Flux Inpainting'
    if (lower.includes('gemini-25')) return 'Gemini 2.5'
    if (lower.includes('uploaded-image') || lower.includes('openai')) return 'OpenAI'
    return 'Edit'
  }

  // Get enhanced prompt for an image (for automated generations)
  const getEnhancedPrompt = async (imageUrl: string): Promise<string | null> => {
    if (!currentCard?.image_history || !currentCard.model_run_id) return null
    
    const index = currentCard.image_history.indexOf(imageUrl)
    if (index === -1) return null
    
    // For Gemini 2.5 images that might have enhanced prompts, fetch from y_sticker_edits metadata
    if (getToolLabel(imageUrl) === 'Gemini 2.5') {
      try {
        const { data, error } = await supabase
          .from('y_sticker_edits')
          .select('metadata')
          .eq('model_run_id', currentCard.model_run_id)
          .single()
        
        if (!error && data?.metadata?.enhanced_feedback) {
          return data.metadata.enhanced_feedback
        }
      } catch (e) {
        console.error('Error fetching enhanced prompt:', e)
      }
    }
    
    return null
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

  // Reset tool state when switching cards so each card starts fresh
  useEffect(() => {
    const card = cardData[currentCardIndex]
    // Prompts default to this record's feedback
    setFluxPrompt(card?.feedback_notes || '')
    setGeminiPrompt(card?.feedback_notes || '')
    setOpenAIPrompt(card?.feedback_notes || '')
    // Ensure Gemini editor is open with populated input
    setIsGeminiEditorOpen(true)
    // Explicitly close other editors when switching cards
    setIsFluxEditorOpen(false)
    setIsOpenAIEditorOpen(false)
    // Reset input selections for tools
    const defaultUrl = card?.preprocessed_output_image_url || card?.output_image_url || ''
    setFluxBaseImageUrl(defaultUrl)
    setGeminiInputImages(defaultUrl ? [defaultUrl] : [])
    setOpenAIInputImages(defaultUrl ? [defaultUrl] : [])
    setToolSelectedImages([])
    // Reset editor UI state/loading flags
    setIsGenerating(false)
    setIsGeminiGenerating(false)
    setIsOpenAIGenerating(false)
    setShowMaskOverlay(false)
    setMaskDataUrl('')
    setTool('brush')
    setBrushSize(50)
    // Clear canvas mask if present
    clearMask()
    
    // Load enhanced prompts for this card's images
    if (card?.model_run_id && card?.image_history?.length > 0) {
      loadEnhancedPrompts(card.model_run_id, card.image_history)
    }
  }, [currentCardIndex, cardData])

  // Load enhanced prompts for images
  const loadEnhancedPrompts = async (modelRunId: string, imageHistory: string[]) => {
    try {
      const { data, error } = await supabase
        .from('y_sticker_edits')
        .select('metadata')
        .eq('model_run_id', modelRunId)
        .single()
      
      if (!error && data?.metadata?.enhanced_feedback) {
        // For now, assume the first image (index 0) uses the enhanced prompt
        if (imageHistory.length > 0) {
          setEnhancedPrompts(prev => ({
            ...prev,
            [imageHistory[0]]: data.metadata.enhanced_feedback
          }))
        }
      }
    } catch (e) {
      console.error('Error loading enhanced prompts:', e)
    }
  }

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
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ modelRunId?: string }>).detail
      const modelRunId = detail?.modelRunId
      if (!modelRunId) return
      const idx = cardData.findIndex(c => c.model_run_id === modelRunId)
      if (idx >= 0) {
        if (viewMode !== 'card') setViewMode('card')
        goToCard(idx)
      }
    }
    window.addEventListener('open-record-by-model-run', handler as EventListener)
    return () => window.removeEventListener('open-record-by-model-run', handler as EventListener)
  }, [cardData, viewMode])

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
    const opening = !isFluxEditorOpen
    setIsFluxEditorOpen(opening)
    // Close other editors if they're open
    if (opening && isGeminiEditorOpen) {
      setIsGeminiEditorOpen(false)
      setGeminiPrompt("")
    }
    if (opening && isOpenAIEditorOpen) {
      setIsOpenAIEditorOpen(false)
    }
    // Prefill prompt with feedback notes when opening
    if (opening) {
      setFluxPrompt(currentCard?.feedback_notes || "")
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
    const opening = !isGeminiEditorOpen
    setIsGeminiEditorOpen(opening)
    // Close other editors if they're open
    if (opening && isFluxEditorOpen) {
      setIsFluxEditorOpen(false)
      setFluxPrompt("")
      setMaskDataUrl("")
      setShowMaskOverlay(false)
      clearMask()
    }
    if (opening && isOpenAIEditorOpen) {
      setIsOpenAIEditorOpen(false)
    }
    // Prefill prompt with feedback notes when opening
    if (opening) {
      setGeminiPrompt(currentCard?.feedback_notes || "")
    }
    // Reset Gemini state when closing
    if (isGeminiEditorOpen) {
      setGeminiPrompt("")
    }
  }

  // Handle OpenAI editor toggle
  const handleOpenAIEditorToggle = () => {
    const opening = !isOpenAIEditorOpen
    setIsOpenAIEditorOpen(opening)
    // Close other editors if they're open
    if (opening && isFluxEditorOpen) {
      setIsFluxEditorOpen(false)
      setFluxPrompt("")
      setMaskDataUrl("")
      setShowMaskOverlay(false)
      clearMask()
    }
    if (opening && isGeminiEditorOpen) {
      setIsGeminiEditorOpen(false)
      setGeminiPrompt("")
    }
    // Prefill OpenAI prompt with feedback notes when opening
    if (opening) {
      setOpenAIPrompt(currentCard?.feedback_notes || "")
    }
    // Reset OpenAI state when closing (revert to default prompt)
    if (isOpenAIEditorOpen) {
      setOpenAIPrompt("Your task is to generate an image that adheres to the specified style. Attached are three reference images that exemplify this target style. The last image is a photo reference that dictates the content and subject to be generated. Your goal is to depict the subject in our specified style. Ignore background. The style is chibi sticker. You should aim to depict the photo reference subject in a flattering yet accurate way. Bodies: simplified torsos only (waist-up) like a sticker.")
    }
  }

  // Handle flux generation
  const handleFluxGenerate = useCallback(async () => {
    if (!currentCard) return;
    const baseUrl = fluxBaseImageUrl || currentCard.preprocessed_output_image_url || currentCard.output_image_url
    if (!baseUrl) return;
    
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
      await globalClientJobQueue.enqueue(`Flux on ${currentCard.model_run_id}`, `Card ${currentCardIndex + 1}`, async () => {
        const formData = new FormData();
        formData.append('image_url', baseUrl);
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
        return { imageUrl: result.data.imageUrl } as const
      }, {
        model_run_id: currentCard.model_run_id,
        original_image_url: baseUrl,
        feedback_notes: currentCard.feedback_notes
      })
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
      
      await globalClientJobQueue.enqueue(`Gemini → PostProcess on ${currentCard.model_run_id}`, `Card ${currentCardIndex + 1}`, async () => {
        // Step 1: Call Gemini tool
        const geminiFormData = new FormData();
        geminiFormData.append('tool', 'gemini');
        geminiFormData.append('prompt', geminiPrompt);
        geminiFormData.append('debug', 'true');
        
        // Collect image URLs - use preprocessed output and input image if available
        const imageUrls = [];
        if (currentCard.preprocessed_output_image_url) {
          imageUrls.push(currentCard.preprocessed_output_image_url);
        }
        if (currentCard.input_image_url) {
          imageUrls.push(currentCard.input_image_url);
        }
        
        if (imageUrls.length === 0) {
          throw new Error('No images available for processing');
        }
        
        geminiFormData.append('imageUrls', imageUrls.join(','));

        console.log('MainScreen: Step 1 - Calling Gemini API...');
        const geminiResponse = await fetch('https://tools.makemeasticker.com/api/universal', {
          method: 'POST',
          body: geminiFormData
        });

        const geminiResult = await geminiResponse.json();
        console.log('MainScreen: Gemini API response:', geminiResult);

        if (!geminiResponse.ok || geminiResult.error) {
          throw new Error(geminiResult.error || `HTTP ${geminiResponse.status}: Failed to process with Gemini`);
        }

        if (!geminiResult.image && !geminiResult.processedImageUrl) {
          throw new Error('No image returned from Gemini');
        }

        const geminiImageUrl = geminiResult.image || geminiResult.processedImageUrl;
        console.log('MainScreen: Step 1 complete - Gemini generation successful:', geminiImageUrl);

        // Step 2: Call postProcess tool with Gemini result
        console.log('MainScreen: Step 2 - Calling postProcess API...');
        const postProcessFormData = new FormData();
        postProcessFormData.append('tool', 'postProcess');
        postProcessFormData.append('imageUrl', geminiImageUrl);
        postProcessFormData.append('debug', 'true');

        const postProcessResponse = await fetch('https://tools.makemeasticker.com/api/universal', {
          method: 'POST',
          body: postProcessFormData
        });

        const postProcessResult = await postProcessResponse.json();
        console.log('MainScreen: PostProcess API response:', postProcessResult);

        if (!postProcessResponse.ok || postProcessResult.error) {
          throw new Error(postProcessResult.error || `HTTP ${postProcessResponse.status}: Failed to post-process image`);
        }

        if (!postProcessResult.image && !postProcessResult.processedImageUrl) {
          throw new Error('No processed image returned from postProcess API');
        }

        const finalImageUrl = postProcessResult.image || postProcessResult.processedImageUrl;
        console.log('MainScreen: Step 2 complete - PostProcess successful:', finalImageUrl);
        console.log('MainScreen: Gemini → postProcess chain completed successfully!');

        handleProcessedImage(finalImageUrl);
        return { imageUrl: finalImageUrl } as const;
      }, {
        model_run_id: currentCard.model_run_id,
        original_image_url: currentCard.preprocessed_output_image_url,
        feedback_notes: currentCard.feedback_notes
      });
      
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
      await globalClientJobQueue.enqueue(`OpenAI on ${currentCard.model_run_id}`, `Card ${currentCardIndex + 1}`, async () => {
        const urls = (toolSelectedImages.length ? toolSelectedImages : (openAIInputImages.length ? openAIInputImages : [currentCard.preprocessed_output_image_url])).filter(Boolean).slice(0, 5)
        const requestBody = {
          inputImages: urls.map((u) => ({ type: 'url', data: u })),
          prompt: openAIPrompt.trim(),
        } as const
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
        )
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
        const base64Data = result.imageData
        const byteCharacters = atob(base64Data)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const uploadResp = await fetch('/api/upload-image', {
          method: 'POST',
          body: (() => {
            const fd = new FormData()
            const file = new File([byteArray], `openai-result-${Date.now()}.png`, { type: 'image/png' })
            fd.append('file', file)
            return fd
          })()
        })
        if (uploadResp.ok) {
          const uploadData = await uploadResp.json()
          const uploadedUrl = uploadData?.url
          if (uploadedUrl) {
            handleProcessedImage(uploadedUrl)
            return { imageUrl: uploadedUrl } as const
          }
        }
        const blob = new Blob([byteArray], { type: 'image/png' })
        const localUrl = URL.createObjectURL(blob)
        handleProcessedImage(localUrl)
        return { imageUrl: localUrl } as const
      }, {
        model_run_id: currentCard.model_run_id,
        original_image_url: currentCard.preprocessed_output_image_url || currentCard.output_image_url,
        feedback_notes: currentCard.feedback_notes
      })
      
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
    // Allow sending even without images (user may choose "Send Anyway")
    if (!currentCard) return

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

      const response = await globalClientJobQueue.enqueue(`Send email ${currentCard.model_run_id}`, `Card ${currentCardIndex + 1}`, async () => {
        const r = await fetch('/api/send-front-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(emailData)
        })
        return r
      }, {
        model_run_id: currentCard.model_run_id,
        original_image_url: currentCard.preprocessed_output_image_url || currentCard.output_image_url,
        feedback_notes: currentCard.feedback_notes
      })

      const result = await (response as Response).json()
      if (Array.isArray(result?.emailData?.processedUrls)) {
        result.emailData.processedUrls.forEach((u: string, idx: number) => {
          console.log(`🧼 RMBG URL ${idx + 1}:`, u)
        })
      }

      if (result.success) {
        alert(`Email sent successfully to ${currentCard.customer_email}!\n\nMessage ID: ${result.messageId}`)
        
        // Clear selection after successful send
        clearImageSelection()
        
        console.log('✅ Email sent successfully:', result)
      } else {
        console.error('❌ Email send failed:', result.error)
        throw new Error(`Failed to send email: ${result.error}`)
      }
    } catch (error) {
      console.error('💥 Error sending email:', error)
      setIsSendingEmail(false)
      throw error
    } finally {
      setIsSendingEmail(false)
    }
  }

  const markAsResolved = async () => {
    if (!currentCard) return

    await globalClientJobQueue.enqueue(`Mark as resolved ${currentCard.model_run_id}`, `Card ${currentCardIndex + 1}`, async () => {
      // Update the database to mark as resolved
      const { error } = await supabase
        .from('model_run')
        .update({ 
          feedback_addressed: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', currentCard.model_run_id)

      if (error) {
        console.error('Error marking as resolved:', error)
        throw new Error(`Failed to mark as resolved: ${error.message || 'Unknown error'}`)
      }

      console.log(`✅ Marked record ${currentCard.model_run_id} as resolved`)
      
      // Move to next record or refresh data
      if (viewMode === 'card') {
        // Remove from cardData array
        setCardData(prev => prev.filter(card => card.model_run_id !== currentCard.model_run_id))
        
        // Adjust current index if needed
        if (currentCardIndex >= cardData.length - 1) {
          setCurrentCardIndex(Math.max(0, currentCardIndex - 1))
        }
      } else {
        // Refresh table data
        fetchStickerEdits(currentPage)
      }

      // Clear any selections
      setSelectedImages([])
      setToolSelectedImages([])

      return "Marked as resolved"
    }, {
      model_run_id: currentCard.model_run_id,
      original_image_url: currentCard.preprocessed_output_image_url || currentCard.output_image_url,
      feedback_notes: currentCard.feedback_notes
    })
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

      const response = await globalClientJobQueue.enqueue(`Send credit ${currentCard.model_run_id}`, `Card ${currentCardIndex + 1}`, async () => {
        const r = await fetch('/api/send-front-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(emailData)
        })
        return r
      }, {
        model_run_id: currentCard.model_run_id,
        original_image_url: currentCard.preprocessed_output_image_url || currentCard.output_image_url,
        feedback_notes: currentCard.feedback_notes
      })

      const result = await (response as Response).json()
      if (Array.isArray(result?.emailData?.processedUrls)) {
        result.emailData.processedUrls.forEach((u: string, idx: number) => {
          console.log(`🧼 RMBG URL ${idx + 1}:`, u)
        })
      }
      if (result.success) {
        clearImageSelection()
        console.log('✅ Credit email sent:', result)
      } else {
        console.error('❌ Credit email failed:', result.error)
        throw new Error(`Failed to send credit email: ${result.error}`)
      }
    } catch (error) {
      console.error('💥 Error sending credit email:', error)
      setIsSendingCreditEmail(false)
      throw error
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

  // Remove a URL from current tool selections
  const removeToolImage = (url: string) => {
    setToolSelectedImages(prev => prev.filter(u => u !== url))
    setOpenAIInputImages(prev => prev.filter(u => u !== url))
    setGeminiInputImages(prev => prev.filter(u => u !== url))
  }

  return (
    <div className="min-h-screen bg-white p-6">
      <div className="mx-auto" style={{ maxWidth: '1700px' }}>
        {/* View Toggle (only show here for table view). Card view toggle is embedded in header. */}
        {viewMode === 'table' && (
          <div className="mb-4 grid grid-cols-3 items-center">
            {/* Left: pagination text */}
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, totalRecords)} of {totalRecords} records
            </div>
            {/* Center: toggle */}
            <div className="flex justify-center items-center gap-4">
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
              
              {/* Sort Dropdown */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">Sort:</span>
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as 'priority' | 'newest')}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  <option value="priority">Priority</option>
                  <option value="newest">Newest</option>
                </select>
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
                            <div className="w-10 h-10 rounded overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
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
              <div className="flex justify-center items-center gap-4">
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
                
                {/* Sort Dropdown */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Sort:</span>
                  <select
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as 'priority' | 'newest')}
                    className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  >
                    <option value="priority">Priority</option>
                    <option value="newest">Newest</option>
                  </select>
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
            <div className="bg-white rounded-xl shadow-lg border border-gray-200">
              {/* Customer Info Header */}
              <div className="rounded-t-xl bg-white" style={{ padding: '16px' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full flex items-center justify-center">
                      <span className="text-white font-bold text-sm">
                        {currentCard.customer_name ? currentCard.customer_name.substring(0, 2).toUpperCase() : 'U'}
                      </span>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        {currentCard.customer_name || 'Unknown Customer'}
                      </div>
                      <div className="text-xs" style={{ color: '#222222' }}>
                        {currentCard.customer_email}
                      </div>
                      <div className="text-xs font-mono" style={{ color: '#666666' }}>
                        Model Run {currentCard.model_run_id}
                      </div>
                      <div className="text-xs" style={{ color: '#666666' }}>
                        Created {formatTimeAgo(currentCard.days_since_created, currentCard.hours_since_created, currentCard.minutes_since_created)}
                      </div>
                    </div>
                  </div>
                  
                  {/* Email Controls */}
                  <div className="flex items-center space-x-3">
                    {/* Resolved Button */}
                    <button
                      onClick={markAsResolved}
                      className="px-4 py-2 text-sm font-medium transition-colors text-white shadow-sm"
                      style={{ 
                        backgroundColor: '#EAF7EA',
                        color: '#2E7D32',
                        borderRadius: '9999px',
                        border: 'none'
                      }}
                      title="Mark as resolved without sending emails"
                    >
                      Resolved
                    </button>

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
                      className="px-4 py-2 text-sm font-medium transition-colors shadow-sm"
                      style={{ 
                        backgroundColor: isSendingCreditEmail ? '#f3f4f6' : '#FFF3E0',
                        color: isSendingCreditEmail ? '#6b7280' : '#E65100',
                        borderRadius: '9999px',
                        border: 'none',
                        cursor: isSendingCreditEmail ? 'not-allowed' : 'pointer'
                      }}
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
                      className="px-4 py-2 text-sm font-medium transition-colors"
                      style={{ 
                        backgroundColor: selectedImages.length === 0 || isSendingEmail ? '#f3f4f6' : 'white',
                        color: selectedImages.length === 0 || isSendingEmail ? '#6b7280' : '#222222',
                        border: selectedImages.length === 0 || isSendingEmail ? '1px solid #DDDDDD' : '1px solid #DDDDDD',
                        borderRadius: '4px',
                        cursor: selectedImages.length === 0 || isSendingEmail ? 'not-allowed' : 'pointer'
                      }}
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
              <div className="border-b border-gray-200" style={{ padding: '16px' }}>
                <div className="whitespace-pre-wrap" style={{ fontSize: '14px', fontWeight: '400', color: '#222222', lineHeight: '1.5' }}>
                  {currentCard.feedback_notes || 'No feedback provided'}
                </div>
              </div>

              {/* Images - Two Column Layout */}
              <div className="mb-6" 
                   style={{ 
                     height: '1500px',
                     backgroundImage: `radial-gradient(circle, #EDEDED 1px, transparent 1px)`,
                     backgroundSize: '20px 20px',
                     backgroundPosition: '0 0',
                     padding: '24px'
                   }}>
                <div className="flex h-full justify-center">
                  {/* Left Column: Image Container */}
                  <div className="rounded-lg overflow-hidden h-full flex justify-center" style={{ width: '750px' }}>
                    <div className="h-full flex justify-center" 
                         style={{ 
                           width: '650px',
                           border: '1px solid #E0E0E0'
                         }}>
                      <div className="flex flex-col" style={{ width: '600px' }}>
                        {/* Image Container - Enforce exact square size */}
                        <div className="w-full aspect-square bg-white relative" 
                             style={{ border: '1px solid #E0E0E0' }}>
                          <div className="absolute inset-0 flex items-center justify-center">
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
                        
                        {/* Unified AI Tools Section */}
                        <div className={`w-full transition-all duration-500 ${
                          isGeminiEditorOpen 
                            ? 'bg-gradient-to-br from-purple-50 via-purple-100 to-violet-50 dark:from-purple-900/20 dark:via-purple-800/20 dark:to-violet-900/20 border-t border-purple-200 dark:border-purple-700' 
                            : isOpenAIEditorOpen
                            ? 'bg-gradient-to-br from-emerald-50 via-green-100 to-teal-50 dark:from-emerald-900/20 dark:via-green-800/20 dark:to-teal-900/20 border-t border-emerald-200 dark:border-emerald-700'
                            : isFluxEditorOpen
                            ? 'bg-gradient-to-br from-blue-50 via-blue-100 to-indigo-50 dark:from-blue-900/20 dark:via-blue-800/20 dark:to-indigo-900/20 border-t border-blue-200 dark:border-blue-700'
                            : 'bg-gradient-to-br from-gray-50 to-white dark:from-gray-900 dark:to-gray-800 border-t border-gray-100 dark:border-gray-700'
                        }`}>
                          {/* Toolbar Header */}
                          <div className="px-6 py-3">
                            <div className="flex flex-col items-center space-y-2">
                              {/* Main Action Buttons Row */}
                              <div className="flex items-center gap-4">
                                {/* Gemini Button */}
                                <button 
                                  onClick={handleGeminiEditorToggle}
                                  className="px-6 py-3 font-medium transition-colors inline-flex items-center gap-3"
                                  style={{
                                    backgroundColor: isGeminiEditorOpen ? '#3B82F6' : '#3B82F6',
                                    color: 'white',
                                    borderRadius: '4px',
                                    border: 'none'
                                  }}
                                >
                                  <Sparkles className="w-5 h-5" />
                                  <span className="text-sm font-medium">
                                    {isGeminiEditorOpen ? 'Close Gemini' : 'Gemini 2.5'}
                                  </span>
                                </button>

                                {/* OpenAI Button */}
                                <button 
                                  onClick={handleOpenAIEditorToggle}
                                  className="px-6 py-3 font-medium transition-colors inline-flex items-center gap-3"
                                  style={{
                                    backgroundColor: 'white',
                                    color: '#222222',
                                    border: '1px solid #DDDDDD',
                                    borderRadius: '4px'
                                  }}
                                >
                                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>
                                  </svg>
                                  <span className="text-sm font-medium">
                                    {isOpenAIEditorOpen ? 'Close OpenAI' : 'OpenAI'}
                                  </span>
                                </button>

                                {/* Flux Inpainting Button */}
                                <button 
                                  onClick={handleFluxEditorToggle}
                                  className="px-6 py-3 font-medium transition-colors inline-flex items-center gap-3"
                                  style={{
                                    backgroundColor: 'white',
                                    color: '#222222',
                                    border: '1px solid #DDDDDD',
                                    borderRadius: '4px'
                                  }}
                                >
                                  <Brush className="w-5 h-5" />
                                  <span className="text-sm font-medium">
                                    {isFluxEditorOpen ? 'Close Flux' : 'Flux Inpainting'}
                                  </span>
                                </button>
                              </div>
                              

                            </div>
                          </div>
                        
                        {/* Expandable Tools Section */}
                        {isFluxEditorOpen && (
                          <div className="bg-gradient-to-br from-blue-50 via-blue-100 to-indigo-50 dark:from-blue-900/20 dark:via-blue-800/20 dark:to-indigo-900/20 border-t border-blue-200 dark:border-blue-700 w-full p-2 space-y-2" style={{ height: '120px' }}>
                            {/* Prompt Input */}
                            <div className="relative">
                              <textarea
                                value={fluxPrompt}
                                onChange={(e) => setFluxPrompt(e.target.value)}
                                placeholder="Describe what to inpaint…"
                                className="w-full px-3 py-2 pr-24 text-sm border rounded resize-none bg-white"
                                maxLength={500}
                                disabled={isGenerating}
                                rows={3}
                              />
                              <button
                                onClick={handleFluxGenerate}
                                disabled={isGenerating || !fluxPrompt.trim() || !maskDataUrl}
                                className="absolute bottom-2 right-2 inline-flex items-center gap-2 px-3 py-1.5 rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 text-sm"
                              >
                                {isGenerating ? (
                                  <span className="inline-flex items-center gap-2">
                                    <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></span>
                                    <span className="text-xs">Generating…</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1">
                                    <Wand2 className="w-3 h-3" />
                                    <span className="text-xs">Generate</span>
                                  </span>
                                )}
                              </button>
                            </div>

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
                                className="p-2 rounded bg-red-600 text-white hover:bg-red-700 focus:outline-none focus:ring-0"
                                title="Clear mask"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )}
                        
                        {/* Gemini 2.5 Tools Section */}
                        {isGeminiEditorOpen && (
                          <div className="bg-gradient-to-br from-purple-50 via-purple-100 to-violet-50 dark:from-purple-900/20 dark:via-purple-800/20 dark:to-violet-900/20 border-t border-purple-200 dark:border-purple-700 w-full p-2" style={{ height: '60px' }}>
                            {/* Prompt Input for Gemini */}
                            <div className="relative">
                              <textarea
                                value={geminiPrompt}
                                onChange={(e) => setGeminiPrompt(e.target.value)}
                                placeholder="Describe how you want to edit this image…"
                                className="w-full px-3 py-2 pr-24 text-sm border rounded resize-none bg-white"
                                maxLength={500}
                                disabled={isGeminiGenerating}
                                rows={3}
                              />
                              <button
                                onClick={handleGeminiGenerate}
                                disabled={isGeminiGenerating || !geminiPrompt.trim()}
                                className="absolute bottom-2 right-2 inline-flex items-center gap-2 px-3 py-1.5 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 text-sm"
                              >
                                {isGeminiGenerating ? (
                                  <span className="inline-flex items-center gap-2">
                                    <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></span>
                                    <span className="text-xs">Generating…</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" />
                                    <span className="text-xs">Generate</span>
                                  </span>
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                        
                        {/* OpenAI Tools Section */}
                        {isOpenAIEditorOpen && (
                          <div className="bg-gradient-to-br from-emerald-50 via-green-100 to-teal-50 dark:from-emerald-900/20 dark:via-green-800/20 dark:to-teal-900/20 border-t border-emerald-200 dark:border-emerald-700 w-full p-2 space-y-2">
                            {/* Inputs */}
                            <div className="flex items-start gap-3">
                              <div className="flex-1 relative">
                                <textarea
                                  value={openAIPrompt}
                                  onChange={(e) => setOpenAIPrompt(e.target.value)}
                                  placeholder="Describe what to generate…"
                                  className="w-full px-3 py-2 pr-24 text-sm border rounded resize-none focus:ring-2 focus:ring-yellow-500 bg-white"
                                  maxLength={1000}
                                  disabled={isOpenAIGenerating}
                                  rows={3}
                                />
                                <button
                                  onClick={handleOpenAIGenerate}
                                  disabled={isOpenAIGenerating || !openAIPrompt.trim()}
                                  className="absolute bottom-2 right-2 inline-flex items-center gap-2 px-3 py-1.5 rounded bg-yellow-600 text-white hover:bg-yellow-700 disabled:opacity-50 text-sm"
                                >
                                  {isOpenAIGenerating ? (
                                    <span className="inline-flex items-center gap-2">
                                      <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></span>
                                      <span className="text-xs">Generating…</span>
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1">
                                      <Zap className="w-3 h-3" />
                                      <span className="text-xs">Generate</span>
                                    </span>
                                  )}
                                </button>
                              </div>
                              {/* no payload preview per request */}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setOpenAIPrompt("Your task is to generate an image that adheres to the specified style. Attached are three reference images that exemplify this target style. The last image is a photo reference that dictates the content and subject to be generated. Your goal is to depict the subject in our specified style. Ignore background. The style is chibi sticker. You should aim to depict the photo reference subject in a flattering yet accurate way. Bodies: simplified torsos only (waist-up) like a sticker.")}
                                className="px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                              >
                                Reset to Default
                              </button>
                              {/* Selected image chips */}
                              <div className="flex flex-wrap gap-2">
                                {(toolSelectedImages.length ? toolSelectedImages : openAIInputImages).slice(0,5).map((url) => (
                                  <div key={url} className="relative w-20 h-20 rounded border overflow-hidden">
                                    <img src={url} alt="sel" className="w-full h-full object-cover" />
                                    <button
                                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 text-xs"
                                      title="Remove"
                                      onClick={() => removeToolImage(url)}
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Original Input Image - Below all tool sections */}
                        {currentCard.input_image_url && (
                          <div className="w-full mt-3">
                            <div className="mb-2"></div>
                            <div className="w-full bg-white border border-gray-300 rounded overflow-hidden">
                              <div className="w-full aspect-square bg-white">
                                <img 
                                  src={currentCard.input_image_url}
                                  alt="Original input"
                                  className="w-full h-full object-contain"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none'
                                  }}
                                />
                              </div>
                              <div className="h-[40px] w-full flex items-center justify-end px-2 border-t bg-white">
                                <button
                                  onClick={() => setToolSelectedImages(prev => prev.includes(currentCard.input_image_url) ? prev.filter(u => u !== currentCard.input_image_url) : [...prev, currentCard.input_image_url])}
                                  className={`group relative px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-200 transform hover:scale-105 flex items-center gap-2 ${
                                    toolSelectedImages.includes(currentCard.input_image_url)
                                      ? 'bg-gradient-to-r from-purple-500 to-violet-600 text-white shadow-lg shadow-purple-200 dark:shadow-purple-900/30'
                                      : 'bg-gradient-to-r from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600 text-gray-700 dark:text-gray-300 hover:from-purple-50 hover:to-violet-50 dark:hover:from-purple-900/20 dark:hover:to-violet-900/20 border border-gray-200 dark:border-gray-600'
                                  }`}
                                  title={toolSelectedImages.includes(currentCard.input_image_url) ? "Remove from AI tool input" : "Use as AI tool input"}
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                  </svg>
                                  <span>{toolSelectedImages.includes(currentCard.input_image_url) ? 'Selected' : 'AI Tool'}</span>
                                  {toolSelectedImages.includes(currentCard.input_image_url) && (
                                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full flex items-center justify-center">
                                      <svg className="w-2 h-2 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                      </svg>
                                    </div>
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Vertical Divider */}
                  <div className="w-px" style={{ height: '1500px', backgroundColor: '#E0E0E0' }}>
                  </div>

                  {/* Right Column: Image History */}
                  <div className="rounded-lg overflow-hidden h-full flex justify-center" style={{ width: '750px' }}>
                    <div className="h-full flex justify-center" 
                         style={{ 
                           width: '650px',
                           border: '1px solid #E0E0E0'
                         }}>
                      <div className="flex flex-col overflow-hidden" style={{ width: '600px' }}>
                        {/* Modern Image History Gallery */}
                        <div className="bg-white w-full h-full overflow-y-auto">
                          {currentCard.image_history && currentCard.image_history.length > 0 ? (
                            <div className="space-y-4">


                              {/* Image Grid */}
                              {currentCard.image_history.map((imageUrl, index) => (
                                <div key={`${imageUrl}-${index}`} className="relative">
                                  <div>
                                    {/* Image Container */}
                                    <div className="relative w-full aspect-square bg-white" 
                                         style={{ border: '1px solid #E0E0E0' }}>
                                      <img 
                                        src={imageUrl} 
                                        alt={`Edit ${index + 1}`} 
                                        className="w-full h-full object-contain cursor-pointer"
                                        onClick={() => window.open(imageUrl, '_blank')}
                                        onError={(e) => {
                                          e.currentTarget.style.display = 'none'
                                        }}
                                      />



                                    </div>

                                    {/* Enhanced Control Panel */}
                                    <div className="bg-white px-4 py-3" style={{ borderTop: '1px solid #E0E0E0' }}>
                                      {/* Enhanced Prompt Display */}
                                      {enhancedPrompts[imageUrl] && (
                                        <div className="mb-3">
                                          <div className="mb-1" style={{ fontSize: '13px', fontWeight: '400', color: '#666666' }}>Enhanced Prompt:</div>
                                          <div className="line-clamp-4" style={{ fontSize: '14px', fontWeight: '400', color: '#222222', lineHeight: '1.5' }}>
                                            {enhancedPrompts[imageUrl]}
                                          </div>
                                        </div>
                                      )}
                                      
                                      <div className="flex items-center justify-end mb-3">
                                        <div className="flex items-center gap-2">
                                          <div className="w-2 h-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full"></div>
                                          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                            {getToolLabel(imageUrl)}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Action Controls */}
                                      <div className="flex items-center justify-end gap-2">
                                        <div className="flex items-center gap-2">
                                          {/* Delete Button */}
                                          <button
                                            title="Delete image"
                                            className="group/delete p-2 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-500 hover:text-red-600 transition-all duration-200 hover:scale-110"
                                            onClick={async () => {
                                              if (!currentCard) return
                                              const confirmDelete = confirm('Remove this generated image from history?')
                                              if (!confirmDelete) return
                                              const newHistory = currentCard.image_history.filter((u) => u !== imageUrl)
                                              const { error } = await supabase
                                                .from('y_sticker_edits')
                                                .update({ image_history: newHistory, updated_at: new Date().toISOString() })
                                                .eq('model_run_id', currentCard.model_run_id)
                                              if (!error) {
                                                setCardData(prev => prev.map(card => card.model_run_id === currentCard.model_run_id ? { ...card, image_history: newHistory } : card))
                                              } else {
                                                alert('Failed to delete image')
                                              }
                                            }}
                                          >
                                            <Trash2 className="w-4 h-4 transition-transform group-hover/delete:scale-110" />
                                          </button>

                                          {/* AI Tool Input Button */}
                                          <button
                                            onClick={() => setToolSelectedImages(prev => prev.includes(imageUrl) ? prev.filter(u => u !== imageUrl) : [...prev, imageUrl])}
                                            className={`group relative px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-200 transform hover:scale-105 flex items-center gap-2 ${
                                              toolSelectedImages.includes(imageUrl)
                                                ? 'bg-gradient-to-r from-purple-500 to-violet-600 text-white shadow-lg shadow-purple-200 dark:shadow-purple-900/30'
                                                : 'bg-gradient-to-r from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600 text-gray-700 dark:text-gray-300 hover:from-purple-50 hover:to-violet-50 dark:hover:from-purple-900/20 dark:hover:to-violet-900/20 border border-gray-200 dark:border-gray-600'
                                            }`}
                                            title={toolSelectedImages.includes(imageUrl) ? "Remove from AI tool input" : "Use as AI tool input"}
                                          >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                            </svg>
                                            <span>{toolSelectedImages.includes(imageUrl) ? 'Input' : 'AI Tool'}</span>
                                            {toolSelectedImages.includes(imageUrl) && (
                                              <div className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full flex items-center justify-center">
                                                <svg className="w-2 h-2 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                              </div>
                                            )}
                                          </button>

                                          {/* Email to Customer Button */}
                                          <button
                                            onClick={() => toggleImageSelection(imageUrl)}
                                            className={`group relative px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-200 transform hover:scale-105 flex items-center gap-2 ${
                                              selectedImages.includes(imageUrl)
                                                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-200 dark:shadow-emerald-900/30'
                                                : 'bg-gradient-to-r from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600 text-gray-700 dark:text-gray-300 hover:from-emerald-50 hover:to-teal-50 dark:hover:from-emerald-900/20 dark:hover:to-teal-900/20 border border-gray-200 dark:border-gray-600'
                                            }`}
                                            title={selectedImages.includes(imageUrl) ? "Remove from customer email" : "Add to customer email"}
                                          >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                            </svg>
                                            <span>{selectedImages.includes(imageUrl) ? 'Selected' : 'Email'}</span>
                                            {selectedImages.includes(imageUrl) && (
                                              <div className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full flex items-center justify-center">
                                                <svg className="w-2 h-2 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                              </div>
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                    
                                    {/* Horizontal Divider */}
                                    <div className="flex justify-center py-2">
                                      <div className="w-[90%] h-px bg-gray-400 dark:bg-gray-500"></div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center h-full text-center">
                              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center mb-4">
                                <svg className="w-8 h-8 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                              <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-400 mb-2">No edits yet</h3>
                              <p className="text-sm text-gray-500 dark:text-gray-500 max-w-xs">
                                Start editing with the tools on the left to see your generated images here
                              </p>
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
