'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Node,
  Edge,
  Connection,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { StickerEdit } from '@/types/sticker'
import { sendFixedArtwork, markAsResolved, sendCreditEmail } from '@/lib/sticker-actions'
import { supabase } from '@/lib/supabase'
import { globalClientJobQueue, cancelJobsBySource } from '@/lib/client-job-queue'
import BottomToolbar from './BottomToolbar'
import FloatingNavigation from './FloatingNavigation'
import PromptNode from './nodes/PromptNode'
import ImageNode from './nodes/ImageNode'
import OutputNode from './nodes/OutputNode'
import EmailComposerNode from './nodes/EmailComposerNode'
import InternalNode from './nodes/InternalNode'
import UserInfoNode from './nodes/UserInfoNode'

interface ReactFlowCanvasProps {
  sticker: StickerEdit
  onNext: () => void
  onPrevious: () => void
  onComplete: (stickerId: string) => void
  currentIndex: number
  totalCount: number
}

const nodeTypes = {
  promptNode: PromptNode,
  imageNode: ImageNode,
  outputNode: OutputNode,
  emailComposerNode: EmailComposerNode,
  internalNode: InternalNode,
  userInfoNode: UserInfoNode,
}

// Utility functions for localStorage persistence
const saveOutputsToStorage = (modelRunId: string, outputs: Record<string, any>) => {
  try {
    localStorage.setItem(modelRunId, JSON.stringify(outputs))
  } catch (error) {
    console.warn('Failed to save outputs to localStorage:', error)
  }
}

const loadOutputsFromStorage = (modelRunId: string): Record<string, any> | null => {
  try {
    const stored = localStorage.getItem(modelRunId)
    return stored ? JSON.parse(stored) : null
  } catch (error) {
    console.warn('Failed to load outputs from localStorage:', error)
    return null
  }
}

export default function ReactFlowCanvas({ sticker, onNext, onPrevious, onComplete, currentIndex, totalCount }: ReactFlowCanvasProps) {
  // Helper function to update outputs in both RAM and localStorage
  const updateOutputs = (updater: (prev: Record<string, any>) => Record<string, any>) => {
    setOutputs(prev => {
      const newOutputs = updater(prev)
      // Save to localStorage
      saveOutputsToStorage(sticker.model_run_id, newOutputs)
      return newOutputs
    })
  }

  // Helper function to clear a specific output node
  const clearOutput = (tool: string) => {
    console.log(`🌸 Clearing ${tool} output`)
    
    // Remove from selected images if attached
    const outputImageUrl = outputs[tool]?.imageUrl
    if (outputImageUrl) {
      setSelectedImages(prev => prev.filter(img => img !== outputImageUrl))
      setAttachedNodes(prev => {
        const newSet = new Set(prev)
        newSet.delete(`${tool}-output`)
        return newSet
      })
    }
    
    // Reset the output state to idle
    updateOutputs(prev => ({
      ...prev,
      [tool]: { status: 'idle' }
    }))
  }

  // Prompt state - prefill with customer feedback
  const [globalPrompt, setGlobalPrompt] = useState(sticker.feedback_notes)
  const [useGlobalPrompt, setUseGlobalPrompt] = useState(true)
  const [fluxPrompt, setFluxPrompt] = useState(sticker.feedback_notes)
  const [geminiPrompt, setGeminiPrompt] = useState(sticker.feedback_notes)
  const [openaiPrompt, setOpenaiPrompt] = useState(sticker.feedback_notes)
  const [fluxMaxPrompt, setFluxMaxPrompt] = useState(sticker.feedback_notes)
  const [includeOriginalDesign, setIncludeOriginalDesign] = useState(true)
  const [includeInputImage, setIncludeInputImage] = useState(false)
  const [additionalImages, setAdditionalImages] = useState<string[]>([])
  const [internalNotes, setInternalNotes] = useState(sticker.internal_note || '')
  const [getOrderedImagesForAPI, setGetOrderedImagesForAPI] = useState<(() => string[]) | null>(null)

  // Reset all node states when sticker changes
  useEffect(() => {
    // Cancel any running jobs from the previous record
    const previousSource = `Canvas Record ${currentIndex}`
    const cancelledCount = cancelJobsBySource(previousSource)
    if (cancelledCount > 0) {
      console.log(`🚫 Cancelled ${cancelledCount} jobs from previous record`)
    }

    // Reset prompts
    setGlobalPrompt(sticker.feedback_notes)
    setFluxPrompt(sticker.feedback_notes)
    setGeminiPrompt(sticker.feedback_notes)
    setOpenaiPrompt(sticker.feedback_notes)
    setFluxMaxPrompt(sticker.feedback_notes)
    
    // Try to load outputs from localStorage first, fallback to idle state
    const storedOutputs = loadOutputsFromStorage(sticker.model_run_id)
    if (storedOutputs) {
      console.log('🔄 Loaded cached outputs from localStorage for:', sticker.model_run_id)
      setOutputs(storedOutputs)
    } else {
      // Reset to idle state if no cached outputs
      setOutputs({
        flux: { status: 'idle' },
        gemini: { status: 'idle' },
        openai: { status: 'idle' },
        flux_max: { status: 'idle' }
      })
    }
    
    // Reset email and selection states
    setSelectedImages([])
    setAttachedNodes(new Set())
    setEmailMode('artwork')
    
    // Reset image selection states
    setIncludeOriginalDesign(true)
    setIncludeInputImage(true)
    setAdditionalImages([])
    
    // Reset internal notes
    setInternalNotes(sticker.internal_note || '')
  }, [sticker.model_run_id, currentIndex]) // Use model_run_id as the key for when record changes

  // Pre-fill individual prompts when switching from global to individual
  useEffect(() => {
    if (!useGlobalPrompt && globalPrompt) {
      // Only pre-fill if individual prompts are empty
      if (!fluxPrompt) {
        setFluxPrompt(globalPrompt)
      }
      if (!geminiPrompt) {
        setGeminiPrompt(globalPrompt)
      }
      if (!openaiPrompt) {
        setOpenaiPrompt(globalPrompt)
      }
      if (!fluxMaxPrompt) {
        setFluxMaxPrompt(globalPrompt)
      }
    }
  }, [useGlobalPrompt, globalPrompt, fluxPrompt, geminiPrompt, openaiPrompt, fluxMaxPrompt])

  // Keyboard navigation
  useEffect(() => {
    const pressedKeys = new Set<string>()

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle shortcuts if no input/textarea is focused
      const activeElement = document.activeElement
      const isInputFocused = activeElement?.tagName === 'INPUT' || 
                            activeElement?.tagName === 'TEXTAREA' || 
                            (activeElement as any)?.contentEditable === 'true'
      
      if (isInputFocused) return

      pressedKeys.add(event.key)

      // Handle single key shortcuts
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault()
          if (currentIndex > 0) {
            onPrevious()
          }
          break
        case 'ArrowRight':
          event.preventDefault()
          if (currentIndex < totalCount - 1) {
            onNext()
          }
          break
      }

      // Handle combination shortcuts
      if (pressedKeys.has(' ') && pressedKeys.has('1')) {
        event.preventDefault()
        generateWithTool('gemini')
        pressedKeys.clear() // Clear to prevent repeated triggers
      }
      if (pressedKeys.has(' ') && pressedKeys.has('2')) {
        event.preventDefault()
        generateWithTool('openai')
        pressedKeys.clear() // Clear to prevent repeated triggers
      }
      if (pressedKeys.has(' ') && pressedKeys.has('3')) {
        event.preventDefault()
        generateWithTool('flux_max')
        pressedKeys.clear() // Clear to prevent repeated triggers
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      pressedKeys.delete(event.key)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [currentIndex, totalCount, onPrevious, onNext])

  // Output states
  const [outputs, setOutputs] = useState<Record<string, any>>({})
  
  // Email functionality state
  const [selectedImages, setSelectedImages] = useState<string[]>([])
  const [attachedNodes, setAttachedNodes] = useState<Set<string>>(new Set())
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  const [isSendingCreditEmail, setIsSendingCreditEmail] = useState(false)
  const [emailMode, setEmailMode] = useState<'artwork' | 'credit'>('artwork')

  // Function to save internal notes to database
  const saveInternalNotes = async (notes: string) => {
    try {
      const { error } = await supabase
        .from('y_sticker_edits')
        .update({ internal_note: notes })
        .eq('model_run_id', sticker.model_run_id)

      if (error) {
        console.error('Error saving internal notes:', error)
      } else {
        console.log('Internal notes saved successfully')
      }
    } catch (error) {
      console.error('Error saving internal notes:', error)
    }
  }

  // Debounced save for internal notes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (internalNotes !== (sticker.internal_note || '')) {
        saveInternalNotes(internalNotes)
      }
    }, 1000) // Save after 1 second of no changes

    return () => clearTimeout(timeoutId)
  }, [internalNotes, sticker.internal_note, sticker.model_run_id])

  // Generate with specific tool
  const generateWithTool = async (tool: 'flux' | 'gemini' | 'openai' | 'flux_max') => {
    const prompt = useGlobalPrompt ? globalPrompt : 
                  tool === 'flux' ? fluxPrompt :
                  tool === 'gemini' ? geminiPrompt :
                  tool === 'openai' ? openaiPrompt : fluxMaxPrompt

    if (!prompt.trim()) {
      console.warn('⚠️ No prompt provided for', tool)
      updateOutputs(prev => ({
        ...prev,
        [tool]: { 
          ...prev[tool], 
          status: 'failed',
          error: 'Please enter a prompt first'
        }
      }))
      return
    }

    // Prevent duplicate jobs - check if already processing
    const currentOutput = outputs[tool]
    if (currentOutput?.status === 'processing') {
      console.log(`⏳ ${tool} is already processing, skipping duplicate request`)
      return
    }

    // Immediately set processing state
    updateOutputs(prev => ({
      ...prev,
      [tool]: { status: 'processing', prompt, imageUrl: '', timestamp: new Date() }
    }))

    try {
      // Prepare job context for JobManager UI
      const jobContext = {
        model_run_id: sticker.model_run_id,
        original_image_url: sticker.preprocessed_output_image_url || sticker.output_image_url,
        feedback_notes: sticker.feedback_notes
      }

      const jobName = `${tool.charAt(0).toUpperCase() + tool.slice(1)} on ${sticker.model_run_id}`
      const source = `Canvas Record ${currentIndex + 1}`

      // Enqueue the job with the global job queue
      const result = await globalClientJobQueue.enqueue(jobName, source, async () => {
        if (tool === 'gemini') {
          // Gemini implementation with automatic postProcess chaining
          console.log('Starting Gemini → postProcess chain with prompt:', prompt)
          
          // Step 1: Call Gemini tool
          const geminiFormData = new FormData()
          geminiFormData.append('tool', 'gemini')
          geminiFormData.append('prompt', prompt)
          geminiFormData.append('debug', 'true')
          
          // Collect image URLs using the custom ordering from ImageNode
          const imageUrls: string[] = getOrderedImagesForAPI ? getOrderedImagesForAPI() : []
          console.log('Image URLs for Gemini:', imageUrls)
          
          if (imageUrls.length === 0) {
            throw new Error('No images selected. Please select at least one image to process.')
          }
          
          geminiFormData.append('imageUrls', imageUrls.join(','))

          console.log('Step 1: Calling Gemini API...')
          const geminiResponse = await fetch('https://tools.makemeasticker.com/api/universal', {
            method: 'POST',
            body: geminiFormData
          })

          const geminiResult = await geminiResponse.json()
          console.log('Gemini API response:', geminiResult)

          if (!geminiResponse.ok || geminiResult.error) {
            const errorMsg = geminiResult.error || `HTTP ${geminiResponse.status}: Failed to process with Gemini`
            console.error('Gemini API error:', errorMsg)
            if (geminiResult.debugInfo) {
              console.error('Gemini debug info:', geminiResult.debugInfo)
            }
            throw new Error(errorMsg)
          }

          if (!geminiResult.image && !geminiResult.processedImageUrl) {
            throw new Error('No image returned from Gemini API')
          }

          const geminiImageUrl = geminiResult.image || geminiResult.processedImageUrl
          console.log('Step 1 complete - Gemini generation successful:', geminiImageUrl)

          // Step 2: Call postProcess tool with Gemini result
          console.log('Step 2: Calling postProcess API...')
          const postProcessFormData = new FormData()
          postProcessFormData.append('tool', 'postProcess')
          postProcessFormData.append('imageUrl', geminiImageUrl)
          postProcessFormData.append('debug', 'true')

          const postProcessResponse = await fetch('https://tools.makemeasticker.com/api/universal', {
            method: 'POST',
            body: postProcessFormData
          })

          const postProcessResult = await postProcessResponse.json()
          console.log('PostProcess API response:', postProcessResult)

          if (!postProcessResponse.ok || postProcessResult.error) {
            const errorMsg = postProcessResult.error || `HTTP ${postProcessResponse.status}: Failed to post-process image`
            console.error('PostProcess API error:', errorMsg)
            if (postProcessResult.debugInfo) {
              console.error('PostProcess debug info:', postProcessResult.debugInfo)
            }
            throw new Error(errorMsg)
          }

          if (!postProcessResult.image && !postProcessResult.processedImageUrl) {
            throw new Error('No processed image returned from postProcess API')
          }

          const finalImageUrl = postProcessResult.image || postProcessResult.processedImageUrl
          console.log('Step 2 complete - PostProcess successful:', finalImageUrl)
          console.log('Gemini → postProcess chain completed successfully!')

          return { imageUrl: finalImageUrl, inputImages: imageUrls }

        } else if (tool === 'openai') {
          // Use our OpenAI GPT Image 1 API
          const formData = new FormData()
          formData.append('prompt', prompt)
          
          // Collect image URLs using the custom ordering from ImageNode
          const imageUrls: string[] = getOrderedImagesForAPI ? getOrderedImagesForAPI() : []
          
          // Add each imageUrl separately
          imageUrls.forEach(url => formData.append('imageUrls', url))

          const response = await fetch('/api/gpt-image-1', {
            method: 'POST',
            body: formData
          })

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Failed to process with OpenAI GPT Image 1`)
          }

          const result = await response.json()
          if (!result.success || !result.data?.image) {
            throw new Error(result.error || 'No image returned from OpenAI GPT Image 1')
          }

          return { imageUrl: result.data.image, inputImages: imageUrls }

        } else if (tool === 'flux_max') {
          // Use our FLUX.1 Kontext [max] API
          const formData = new FormData()
          formData.append('prompt', prompt)
          
          // For Flux Max, only use the original artwork (top input image)
          // Ignore the photo below it and any uploaded images
          if (sticker.output_image_url) {
            formData.append('imageUrls', sticker.output_image_url)
          } else {
            throw new Error('No original artwork available for Flux Max processing')
          }

          const response = await fetch('/api/flux-max-image', {
            method: 'POST',
            body: formData
          })

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Failed to process with FLUX.1 Kontext [max]`)
          }

          const result = await response.json()
          if (!result.success || !result.data?.imageUrl) {
            throw new Error(result.error || 'No image returned from FLUX.1 Kontext [max]')
          }

          return { 
            imageUrl: result.data.imageUrl, 
            inputImages: sticker.output_image_url ? [sticker.output_image_url] : [] 
          }

        } else {
          // TODO: Implement other tools (flux)
          await new Promise(resolve => setTimeout(resolve, 3000))
          return { imageUrl: sticker.output_image_url, inputImages: [] }
        }
      }, jobContext)

      // Job completed successfully - update the outputs
      updateOutputs(prev => ({
        ...prev,
        [tool]: { 
          ...prev[tool], 
          status: 'completed', 
          imageUrl: result.imageUrl,
          prompt: prompt,
          inputImages: result.inputImages
        }
      }))
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : `Failed to generate with ${tool}`
      const isCancelled = errorMessage.includes('cancelled') || errorMessage.includes('aborted')
      
      console.error(`${tool} generation error:`, error)
      
      updateOutputs(prev => ({
        ...prev,
        [tool]: { 
          ...prev[tool], 
          status: 'failed',
          error: errorMessage,
          cancelled: isCancelled
        }
      }))
      
      // Only show alert for non-cancelled errors
      if (!isCancelled) {
        console.warn(`❌ ${tool} failed:`, errorMessage)
      } else {
        console.log(`🚫 ${tool} job was cancelled`)
      }
    }
  }

  // Calculate dynamic positions based on node heights
  const nodePositions = useMemo(() => {
    const basePositions = {
      'prompt-1': { x: 50, y: 250 },
      'images-1': { x: 400, y: 250 },
      'gemini-output': { x: 750, y: 250 },
      'openai-output': { x: 750, y: 320 },
      'flux-max-output': { x: 750, y: 390 },
      'email-composer': { x: 1100, y: 250 },
      'internal-1': { x: 50, y: 500 },
      'user-info-1': { x: 50, y: 670 }
    }

    // Calculate heights based on node states
    const nodeHeights = {
      'prompt-1': 150, // Base height for prompt node
      'internal-1': 150, // Base height for internal node
      'user-info-1': 200, // Base height for user info node
      'images-1': 200, // Base height for image node
      'gemini-output': outputs.gemini?.imageUrl ? 400 : 150, // Expanded when has image
      'openai-output': outputs.openai?.imageUrl ? 400 : 150,
      'flux-max-output': outputs.flux_max?.imageUrl ? 400 : 150,
      'email-composer': 300
    }

    // Adjust positions to prevent overlap
    const adjustedPositions = { ...basePositions }
    
    // Adjust OpenAI position based on Gemini height
    const geminiBottom = adjustedPositions['gemini-output'].y + nodeHeights['gemini-output']
    adjustedPositions['openai-output'].y = Math.max(
      basePositions['openai-output'].y,
      geminiBottom + 10 // 10px gap
    )
    
    // Adjust Flux Max position based on OpenAI height
    const openaiBottom = adjustedPositions['openai-output'].y + nodeHeights['openai-output']
    adjustedPositions['flux-max-output'].y = Math.max(
      basePositions['flux-max-output'].y,
      openaiBottom + 10 // 10px gap
    )

    return adjustedPositions
  }, [outputs.gemini?.imageUrl, outputs.openai?.imageUrl, outputs.flux_max?.imageUrl])

  const initialNodes: Node[] = useMemo(() => [
    {
      id: 'prompt-1',
      type: 'promptNode',
      position: nodePositions['prompt-1'],
      data: { 
        globalPrompt,
        setGlobalPrompt,
        useGlobalPrompt,
        setUseGlobalPrompt,
        fluxPrompt,
        setFluxPrompt,
        geminiPrompt,
        setGeminiPrompt,
        openaiPrompt,
        setOpenaiPrompt,
        fluxMaxPrompt,
        setFluxMaxPrompt,
        additionalImages,
        setAdditionalImages,
      },
    },
    {
      id: 'internal-1',
      type: 'internalNode',
      position: nodePositions['internal-1'],
      data: {
        internalNotes,
        setInternalNotes,
        sticker,
      },
    },
    {
      id: 'user-info-1',
      type: 'userInfoNode',
      position: nodePositions['user-info-1'],
      data: {
        sticker,
      },
    },
    {
      id: 'images-1',
      type: 'imageNode',
      position: nodePositions['images-1'],
      data: { 
        sticker,
        includeOriginalDesign,
        setIncludeOriginalDesign,
        includeInputImage,
        setIncludeInputImage,
        additionalImages,
        setAdditionalImages,
        setGetOrderedImagesForAPI,
      },
    },
    // {
    //   id: 'flux-output',
    //   type: 'outputNode',
    //   position: { x: 600, y: 50 },
    //     data: { 
    //       title: 'Flux',
    //       tool: 'flux',
    //       output: outputs.flux,
    //       onGenerate: () => generateWithTool('flux'),
    //       onAttachToEmail: (imageUrl: string) => {
    //         console.log('Attaching Flux image:', imageUrl)
    //         if (!selectedImages.includes(imageUrl)) {
    //           setSelectedImages(prev => [...prev, imageUrl])
    //         }
    //         setAttachedNodes(prev => {
    //           const newSet = new Set([...prev, 'flux-output'])
    //           console.log('Updated attached nodes:', Array.from(newSet))
    //           return newSet
    //         })
    //       },
    //       useGlobalPrompt,
    //       individualPrompt: fluxPrompt,
    //       onPromptChange: setFluxPrompt,
    //     },
    // },
    {
      id: 'gemini-output',
      type: 'outputNode',
      position: nodePositions['gemini-output'],
        data: { 
          title: 'Gemini',
          tool: 'gemini',
          output: outputs.gemini,
          onGenerate: () => generateWithTool('gemini'),
          onAttachToEmail: (imageUrl: string) => {
            console.log('Attaching Gemini image:', imageUrl)
            if (!selectedImages.includes(imageUrl)) {
              setSelectedImages(prev => [...prev, imageUrl])
            }
            setAttachedNodes(prev => {
              const newSet = new Set([...prev, 'gemini-output'])
              console.log('Updated attached nodes:', Array.from(newSet))
              return newSet
            })
          },
          onClear: () => clearOutput('gemini'),
          useGlobalPrompt,
          individualPrompt: geminiPrompt,
          onPromptChange: setGeminiPrompt,
        },
    },
    {
      id: 'openai-output',
      type: 'outputNode',
      position: nodePositions['openai-output'],
        data: { 
          title: 'OpenAI',
          tool: 'openai',
          output: outputs.openai,
          onGenerate: () => generateWithTool('openai'),
          onAttachToEmail: (imageUrl: string) => {
            console.log('Attaching OpenAI image:', imageUrl)
            if (!selectedImages.includes(imageUrl)) {
              setSelectedImages(prev => [...prev, imageUrl])
            }
            setAttachedNodes(prev => {
              const newSet = new Set([...prev, 'openai-output'])
              console.log('Updated attached nodes:', Array.from(newSet))
              return newSet
            })
          },
          onClear: () => clearOutput('openai'),
          useGlobalPrompt,
          individualPrompt: openaiPrompt,
          onPromptChange: setOpenaiPrompt,
        },
    },
    {
      id: 'flux-max-output',
      type: 'outputNode',
      position: nodePositions['flux-max-output'],
        data: { 
          title: 'Flux Max',
          tool: 'flux_max',
          output: outputs.flux_max,
          onGenerate: () => generateWithTool('flux_max'),
          onAttachToEmail: (imageUrl: string) => {
            console.log('Attaching Flux Max image:', imageUrl)
            if (!selectedImages.includes(imageUrl)) {
              setSelectedImages(prev => [...prev, imageUrl])
            }
            setAttachedNodes(prev => {
              const newSet = new Set([...prev, 'flux-max-output'])
              console.log('Updated attached nodes:', Array.from(newSet))
              return newSet
            })
          },
          onClear: () => clearOutput('flux_max'),
          useGlobalPrompt,
          individualPrompt: fluxMaxPrompt,
          onPromptChange: setFluxMaxPrompt,
        },
    },
    {
      id: 'email-composer',
      type: 'emailComposerNode',
      position: nodePositions['email-composer'],
      data: {
        customerEmail: sticker.customer_email,
        customerName: sticker.customer_name,
        userId: sticker.model_run_id, // Using model_run_id as the identifier
        selectedImages: emailMode === 'credit' ? [] : selectedImages, // Clear attachments in credit mode
        onSend: async (emailData?: { toEmail?: string; subject?: string; body?: string; conversationId?: string; messageId?: string }) => {
          try {
            if (emailMode === 'credit') {
              await sendCreditEmail(sticker, [], setIsSendingCreditEmail, emailData)
            } else {
              await sendFixedArtwork(sticker, selectedImages, setIsSendingEmail, emailData)
            }
            setSelectedImages([]) // Clear selection after send
            setAttachedNodes(new Set()) // Clear attached nodes
            setEmailMode('artwork') // Reset to artwork mode after sending
            onNext() // Move to next after successful email
          } catch (error) {
            console.error('Failed to send email:', error)
          }
        },
        isSending: emailMode === 'credit' ? isSendingCreditEmail : isSendingEmail,
        emailMode,
        onDetachImage: (imageUrl: string) => {
          console.log('Detaching image:', imageUrl)
          setSelectedImages(prev => prev.filter(img => img !== imageUrl))
          
          // Find which node this image belongs to and remove it from attached nodes
          const fluxImage = outputs.flux?.imageUrl
          const geminiImage = outputs.gemini?.imageUrl
          const openaiImage = outputs.openai?.imageUrl
          const fluxMaxImage = outputs.flux_max?.imageUrl
          
          setAttachedNodes(prev => {
            const newSet = new Set(prev)
            if (imageUrl === fluxImage) newSet.delete('flux-output')
            if (imageUrl === geminiImage) newSet.delete('gemini-output')
            if (imageUrl === openaiImage) newSet.delete('openai-output')
            if (imageUrl === fluxMaxImage) newSet.delete('flux-max-output')
            console.log('Updated attached nodes after detach:', Array.from(newSet))
            return newSet
          })
        },
      },
    },
  ], [globalPrompt, useGlobalPrompt, fluxPrompt, geminiPrompt, openaiPrompt, fluxMaxPrompt, includeOriginalDesign, includeInputImage, additionalImages, internalNotes, outputs, sticker, selectedImages, isSendingEmail, isSendingCreditEmail, emailMode, attachedNodes, onNext, nodePositions])

  const initialEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [
      // Prompt to all outputs
      { id: 'prompt-flux', source: 'prompt-1', target: 'flux-output', animated: true, style: { stroke: '#8b5cf6' } },
      { id: 'prompt-gemini', source: 'prompt-1', target: 'gemini-output', animated: true, style: { stroke: '#f97316' } },
      { id: 'prompt-openai', source: 'prompt-1', target: 'openai-output', animated: true, style: { stroke: '#10b981' } },
      { id: 'prompt-flux-max', source: 'prompt-1', target: 'flux-max-output', animated: true, style: { stroke: '#6d28d9' } },
    ]

    // Add image edges if enabled
    if (includeOriginalDesign || includeInputImage) {
      edges.push(
        { id: 'images-flux', source: 'images-1', target: 'flux-output', animated: true, style: { stroke: '#3b82f6' } },
        { id: 'images-gemini', source: 'images-1', target: 'gemini-output', animated: true, style: { stroke: '#3b82f6' } },
        { id: 'images-openai', source: 'images-1', target: 'openai-output', animated: true, style: { stroke: '#3b82f6' } },
        { id: 'images-flux-max', source: 'images-1', target: 'flux-max-output', animated: true, style: { stroke: '#3b82f6' } }
      )
    }

    // Add connections to email composer for attached nodes only
    console.log('Building edges, attached nodes:', Array.from(attachedNodes))
    
    if (attachedNodes.has('flux-output')) {
      console.log('Adding Flux → Email edge')
      edges.push({ 
        id: 'flux-email', 
        source: 'flux-output', 
        target: 'email-composer', 
        animated: true, 
        style: { stroke: '#8b5cf6', strokeWidth: 3, strokeDasharray: '8,4' } 
      })
    }
    if (attachedNodes.has('gemini-output')) {
      console.log('Adding Gemini → Email edge')
      edges.push({ 
        id: 'gemini-email', 
        source: 'gemini-output', 
        target: 'email-composer', 
        animated: true, 
        style: { stroke: '#f97316', strokeWidth: 3, strokeDasharray: '8,4' } 
      })
    }
    if (attachedNodes.has('openai-output')) {
      console.log('Adding OpenAI → Email edge')
      edges.push({ 
        id: 'openai-email', 
        source: 'openai-output', 
        target: 'email-composer', 
        animated: true, 
        style: { stroke: '#10b981', strokeWidth: 3, strokeDasharray: '8,4' } 
      })
    }
    if (attachedNodes.has('flux-max-output')) {
      console.log('Adding Flux Max → Email edge')
      edges.push({ 
        id: 'flux-max-email', 
        source: 'flux-max-output', 
        target: 'email-composer', 
        animated: true, 
        style: { stroke: '#6d28d9', strokeWidth: 3, strokeDasharray: '8,4' } 
      })
    }
    
    console.log('Final edges:', edges.length, edges.map(e => e.id))

    return edges
  }, [includeOriginalDesign, includeInputImage, selectedImages, attachedNodes])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)


  // Update nodes and edges when state changes
  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  const onConnect = useCallback(
    (params: Edge | Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  )

  return (
    <div className="w-full h-screen">
      {/* React Flow Canvas */}
      <div className="w-full h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="bottom-left"
        >
          <Controls />
          <MiniMap />
          <Background variant={BackgroundVariant.Dots} />
        </ReactFlow>
      </div>

      {/* Bottom Toolbar */}
      <BottomToolbar
        selectedImages={selectedImages}
        isSendingEmail={isSendingEmail}
        isSendingCreditEmail={isSendingCreditEmail}
        emailMode={emailMode}
        onSendFixedArtwork={() => {
          console.log('Switching to artwork mode')
          setEmailMode('artwork')
        }}
        onSendCredit={() => {
          console.log('Switching to credit mode')
          setEmailMode('credit')
        }}
        onMarkResolved={async () => {
          try {
            await markAsResolved(sticker)
            onNext() // Move to next after resolving
          } catch (error) {
            console.error('Failed to mark as resolved:', error)
          }
        }}
        onSkipNext={() => onComplete(sticker.sticker_edit_id)}
      />

      {/* Floating Navigation */}
      <FloatingNavigation
        onPrevious={onPrevious}
        onNext={onNext}
        currentIndex={currentIndex}
        totalCount={totalCount}
      />
    </div>
  )
}
