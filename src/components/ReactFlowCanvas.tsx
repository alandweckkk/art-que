'use client'

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
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
import BottomToolbar from './BottomToolbar'
import FloatingNavigation from './FloatingNavigation'
import PromptNode from './nodes/PromptNode'
import PromptNodeDuplicate from './nodes/PromptNodeDuplicate'
import PromptNodeCopy from './nodes/PromptNodeCopy'
import InputImagesNode from './nodes/InputImagesNode'
import OutputNode from './nodes/OutputNode'
import EmailComposerNode from './nodes/EmailComposerNode'
import InternalNode from './nodes/InternalNode'
import UserInfoNode from './nodes/UserInfoNode'
import GeminiNode from './nodes/GeminiNode'
import TextPromptNode from './nodes/TextPromptNode'

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
  promptNodeDuplicate: PromptNodeDuplicate,
  promptNodeCopy: PromptNodeCopy,
  inputImagesNode: InputImagesNode,
  outputNode: OutputNode,
  emailComposerNode: EmailComposerNode,
  internalNode: InternalNode,
  userInfoNode: UserInfoNode,
  geminiNode: GeminiNode,
  textPromptNode: TextPromptNode,
}

export default function ReactFlowCanvas({ sticker, onNext, onPrevious, onComplete, currentIndex, totalCount }: ReactFlowCanvasProps) {
  // Simple state - just track what's currently displayed
  const [generations, setGenerations] = useState<any[]>([])
  const [isPolling, setIsPolling] = useState(false)

  // Simple function to create a new generation record
  const createGeneration = async (
    nodeId: string,
    prompt: string,
    inputImages: string[]
  ) => {
    try {
      const generationId = `${sticker.model_run_id}-${nodeId}-${Date.now()}`
      
      const { error } = await supabase
        .from('y_sticker_edits_generations')
        .insert({
          model_run_id: sticker.model_run_id,
          node_id: nodeId,
          generation_id: generationId,
          status: 'processing',
          prompt: prompt,
          input_images: inputImages,
          started_at: new Date().toISOString(),
          action: 'visible'
        })

      if (error) {
        console.error('Failed to create generation:', error)
        throw error
      }
      
      console.log(`✅ Created generation ${generationId}`)
      return generationId
    } catch (error) {
      console.error('Error creating generation:', error)
      throw error
    }
  }

  // Simple helper to get current output for a node from generations
  const getNodeOutput = (nodeId: string) => {
    // Find the most recent generation for this node
    const nodeGenerations = generations
      .filter(g => g.node_id === nodeId && g.action === 'visible')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    
    const latest = nodeGenerations[0]
    if (!latest) return { status: 'idle' }
    
    return {
      status: latest.status,
      imageUrl: latest.output_image_url,
      prompt: latest.prompt,
      inputImages: latest.input_images,
      generation_id: latest.generation_id
    }
  }

  // Removed deprecated functions - now using database as single source of truth

  // Helper function to append generated image to image_history
  const appendToImageHistory = async (imageUrl: string, nodeId: string = 'g1') => {
    try {
      console.log(`📸 Adding image to history for model_run_id: ${sticker.model_run_id}`)
      
      // Get current image_history
      const { data: currentData } = await supabase
        .from('y_sticker_edits')
        .select('image_history')
        .eq('model_run_id', sticker.model_run_id)
        .single()

      const currentHistory = (currentData?.image_history || []) as Array<any>

      // Append new entry
      const newEntry = {
        node_id: nodeId,
        image_url: imageUrl,
        state: 'visible' as const
      }

      const updatedHistory = [...currentHistory, newEntry]

      const { error } = await supabase
        .from('y_sticker_edits')
        .update({ 
          image_history: updatedHistory,
          updated_at: new Date().toISOString()
        })
        .eq('model_run_id', sticker.model_run_id)

      if (error) throw error
      console.log(`✅ Added image to history: ${imageUrl.substring(0, 60)}...`)
    } catch (error) {
      console.error('Error appending to image_history:', error)
    }
  }

  // Helper function to mark image as deleted in image_history
  const markImageAsDeleted = async (imageUrl: string) => {
    try {
      console.log(`🗑️ Marking image as deleted for model_run_id: ${sticker.model_run_id}`)
      
      // Get current image_history
      const { data: currentData } = await supabase
        .from('y_sticker_edits')
        .select('image_history')
        .eq('model_run_id', sticker.model_run_id)
        .single()

      const currentHistory = (currentData?.image_history || []) as Array<any>

      // Find and update the entry's state
      const updatedHistory = currentHistory.map((entry: any) => {
        if (entry.image_url === imageUrl) {
          return {
            ...entry,
            state: 'deleted' as const
          }
        }
        return entry
      })

      const { error } = await supabase
        .from('y_sticker_edits')
        .update({ 
          image_history: updatedHistory,
          updated_at: new Date().toISOString()
        })
        .eq('model_run_id', sticker.model_run_id)

      if (error) throw error
      console.log(`✅ Marked image as deleted: ${imageUrl.substring(0, 60)}...`)
    } catch (error) {
      console.error('Error marking image as deleted:', error)
    }
  }

  // Simple function to hide a generation
  const hideGeneration = async (nodeId: string) => {
    console.log(`🌸 Hiding output for node ${nodeId}`)
    
    // Find the latest visible generation for this node
    const generation = generations
      .filter(g => g.node_id === nodeId && g.action === 'visible')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
    
    if (generation) {
      // Mark as hidden in database
      try {
        const { error } = await supabase
          .from('y_sticker_edits_generations')
          .update({ 
            action: 'hidden',
            updated_at: new Date().toISOString()
          })
          .eq('generation_id', generation.generation_id)
        
        if (error) throw error
        console.log(`✅ Marked generation ${generation.generation_id} as hidden`)
        
        // Mark as deleted in image_history if it has an output
        if (generation.output_image_url) {
          await markImageAsDeleted(generation.output_image_url)
          
          // Remove from email attachments if selected
          setSelectedImages(prev => prev.filter(img => img !== generation.output_image_url))
          setAttachedNodes(prev => {
            const newSet = new Set(prev)
            // Map node_id to attachment key
            const attachmentKey = nodeId === 'g-1' ? 'gemini-node' : 
                                 nodeId === 'g-2' ? 'gemini-node-2' : 
                                 nodeId
            newSet.delete(attachmentKey)
            return newSet
          })
        }
        
        // Reload generations to update UI
        loadGenerations()
      } catch (error) {
        console.error('Error hiding generation:', error)
      }
    }
  }

  // Prompt state - prefill with customer feedback
  const [globalPrompt, setGlobalPrompt] = useState(sticker.feedback_notes)
  const [textPrompt, setTextPrompt] = useState('')
  const [includeOriginalDesign, setIncludeOriginalDesign] = useState(true)
  const [includeInputImage, setIncludeInputImage] = useState(false)
  const [additionalImages, setAdditionalImages] = useState<string[]>([])
  const [internalNotes, setInternalNotes] = useState(sticker.internal_note || '')

  // Helper function to get selected images
  const getSelectedImages = () => {
    const images: string[] = []
    if (includeOriginalDesign && sticker.preprocessed_output_image_url) {
      images.push(sticker.preprocessed_output_image_url)
    }
    if (includeInputImage && sticker.input_image_url) {
      images.push(sticker.input_image_url)
    }
    // Add selected additional images
    additionalImages.forEach(img => images.push(img))
    return images
  }

  // Reset everything when sticker changes
  useEffect(() => {
    console.log('🔄 Record changed, resetting all state')
    
    // Clear all state
    setGenerations([])
    setIsPolling(false)
    
    // Reset prompts
    setGlobalPrompt(sticker.feedback_notes)
    setTextPrompt('')
    
    // Reset email and selection states
    setSelectedImages([])
    setAttachedNodes(new Set())
    setEmailMode('artwork')
    
    // Reset image selection states
    setIncludeOriginalDesign(true)
    setIncludeInputImage(true)
    setAdditionalImages([])
    
    // Set preprocessed_output_image_url as selected by default
    const defaultSelectedImages: string[] = []
    if (sticker.preprocessed_output_image_url) {
      defaultSelectedImages.push(sticker.preprocessed_output_image_url)
    }
    setSelectedInputImages(defaultSelectedImages)
    
    // Reset internal notes
    setInternalNotes(sticker.internal_note || '')
  }, [sticker.model_run_id]) // Only depend on model_run_id

  // Keyboard navigation
  useEffect(() => {
    const pressedKeys = new Set<string>()

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle shortcuts if no input/textarea is focused
      const activeElement = document.activeElement
      const isInputFocused = activeElement?.tagName === 'INPUT' || 
                            activeElement?.tagName === 'TEXTAREA' || 
                            (activeElement as HTMLElement)?.contentEditable === 'true'
      
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

      // Handle combination shortcuts - DISABLED FOR NOW
      // if (pressedKeys.has(' ') && pressedKeys.has('1')) {
      //   event.preventDefault()
      //   // TODO: Trigger Gemini node generation
      //   pressedKeys.clear() // Clear to prevent repeated triggers
      // }
      // if (pressedKeys.has(' ') && pressedKeys.has('2')) {
      //   event.preventDefault()
      //   // TODO: Trigger OpenAI node generation
      //   pressedKeys.clear() // Clear to prevent repeated triggers
      // }
      // if (pressedKeys.has(' ') && pressedKeys.has('3')) {
      //   event.preventDefault()
      //   // TODO: Trigger Flux Max node generation
      //   pressedKeys.clear() // Clear to prevent repeated triggers
      // }
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

  // Removed complex output state - now using database directly
  
  // Input image selection state (for passing to generation APIs)
  const [selectedInputImages, setSelectedInputImages] = useState<string[]>([])
  
  // Email functionality state
  const [selectedImages, setSelectedImages] = useState<string[]>([])
  const [attachedNodes, setAttachedNodes] = useState<Set<string>>(new Set())
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  const [isSendingCreditEmail, setIsSendingCreditEmail] = useState(false)
  const [emailMode, setEmailMode] = useState<'artwork' | 'credit'>('artwork')

  // Simple function to load generations from database
  const loadGenerations = async () => {
    try {
      const { data, error } = await supabase
        .from('y_sticker_edits_generations')
        .select('*')
        .eq('model_run_id', sticker.model_run_id)
        .eq('action', 'visible')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error loading generations:', error)
        return
      }

      setGenerations(data || [])
      
      // Check if any are processing
      const hasProcessing = data?.some(g => g.status === 'processing')
      setIsPolling(!!hasProcessing)
    } catch (error) {
      console.error('Error loading generations:', error)
    }
  }

  // Load generations on mount and start polling if needed
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null
    let mounted = true

    // Initial load
    loadGenerations()

    // Simple polling - only when we have processing generations
    const checkAndPoll = () => {
      if (mounted && isPolling) {
        pollInterval = setInterval(() => {
          if (mounted) {
            loadGenerations()
          }
        }, 2000) // Poll every 2 seconds
      }
    }

    checkAndPoll()

    // Cleanup
    return () => {
      mounted = false
      if (pollInterval) {
        clearInterval(pollInterval)
      }
    }
  }, [sticker.model_run_id, isPolling])

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

  // TODO: Debounced save for additional images - needs redesign
  // useEffect(() => {
  //   // Additional images handling will be redesigned
  // }, [additionalImages, sticker.model_run_id])

  // Removed deprecated generateWithTool - each node handles its own generation now

  // Calculate dynamic positions based on node heights
  const nodePositions = useMemo(() => {
    const basePositions = {
      'text-prompt': { x: 50, y: 250 },
      'images-1': { x: 400, y: 250 },
      'gemini-node': { x: 750, y: 250 },
      'gemini-node-2': { x: 750, y: 520 },  // Second Gemini node below the first
      'seedream-node': { x: 750, y: 790 },  // Seedream node below Gemini 2
      'reve-remix-node': { x: 750, y: 1060 },  // Reve Remix node below Seedream
      'gemini-output': { x: 750, y: 250 },
      'openai-output': { x: 750, y: 320 },
      'flux-max-output': { x: 750, y: 390 },
      'seedream-output': { x: 750, y: 460 },
      'email-composer': { x: 1100, y: 250 },
      'internal-1': { x: 50, y: 500 },
      'user-info-1': { x: 50, y: 700 }
    }

    // Calculate heights based on node states  
    const nodeHeights = {
      'internal-1': 150, // Base height for internal node
      'user-info-1': 200, // Base height for user info node
      'images-1': 200, // Base height for image node
      'gemini-node': getNodeOutput('g-1').imageUrl ? 400 : 150, // Expanded when has image
      'gemini-node-2': getNodeOutput('g-2').imageUrl ? 400 : 150,
      'seedream-node': getNodeOutput('s-1').imageUrl ? 400 : 150,
      'reve-remix-node': getNodeOutput('r-1').imageUrl ? 400 : 150,
      'email-composer': 300
    }

    // Adjust positions to prevent overlap
    const adjustedPositions = { ...basePositions }
    
    // Adjust second Gemini position if first has image
    if (getNodeOutput('g-1').imageUrl) {
      const geminiBottom = adjustedPositions['gemini-node'].y + nodeHeights['gemini-node']
      adjustedPositions['gemini-node-2'].y = Math.max(
        basePositions['gemini-node-2'].y,
        geminiBottom + 10 // 10px gap
      )
    }
    
    // Adjust Seedream position if Gemini 2 has image
    if (getNodeOutput('g-2').imageUrl) {
      const gemini2Bottom = adjustedPositions['gemini-node-2'].y + nodeHeights['gemini-node-2']
      adjustedPositions['seedream-node'].y = Math.max(
        basePositions['seedream-node'].y,
        gemini2Bottom + 10 // 10px gap
      )
    }
    
    // Adjust Reve Remix position if Seedream has image
    if (getNodeOutput('s-1').imageUrl) {
      const seedreamBottom = adjustedPositions['seedream-node'].y + nodeHeights['seedream-node']
      adjustedPositions['reve-remix-node'].y = Math.max(
        basePositions['reve-remix-node'].y,
        seedreamBottom + 10 // 10px gap
      )
    }

    return adjustedPositions
  }, [generations]) // Depend on generations to recalculate when outputs change

  // Create generation handlers outside of useMemo to avoid stale closures
  const handleGeminiGenerate = async () => {
    if (selectedInputImages.length === 0) {
      alert('Please select at least one image from the Input Images node')
      return
    }

    const promptToUse = textPrompt.trim() || globalPrompt.trim()
    console.log('🎨 Gemini Generation - Using prompt:', {
      textPrompt: textPrompt,
      globalPrompt: globalPrompt,
      promptToUse: promptToUse
    })
    
    if (!promptToUse) {
      alert('Please enter a prompt')
      return
    }

    try {
      const generationId = await createGeneration('g-1', promptToUse, selectedInputImages)
      await loadGenerations()
      
      const formData = new FormData()
      formData.append('prompt', promptToUse)
      formData.append('modelRunId', sticker.model_run_id)
      formData.append('nodeId', 'g-1')
      formData.append('generationId', generationId)
      selectedInputImages.forEach(url => formData.append('imageUrls', url))

      const response = await fetch('/api/new-fal-gemini-2.5', {
        method: 'POST',
        body: formData
      })

      const result = await response.json()
      
      if (result.success && result.data.imageUrl) {
        await appendToImageHistory(result.data.imageUrl, 'g-1')
        await loadGenerations()
      } else {
        throw new Error(result.error || 'Failed to generate image')
      }
    } catch (error) {
      console.error('Gemini generation error:', error)
      alert(error instanceof Error ? error.message : 'Failed to generate image')
      await loadGenerations()
    }
  }

  const handleGemini2Generate = async () => {
    if (selectedInputImages.length === 0) {
      alert('Please select at least one image from the Input Images node')
      return
    }

    const promptToUse = textPrompt.trim() || globalPrompt.trim()
    console.log('🎨 Gemini 2 Generation - Using prompt:', {
      textPrompt: textPrompt,
      globalPrompt: globalPrompt,
      promptToUse: promptToUse
    })
    
    if (!promptToUse) {
      alert('Please enter a prompt')
      return
    }

    try {
      const generationId = await createGeneration('g-2', promptToUse, selectedInputImages)
      await loadGenerations()
      
      const formData = new FormData()
      formData.append('prompt', promptToUse)
      formData.append('modelRunId', sticker.model_run_id)
      formData.append('nodeId', 'g-2')
      formData.append('generationId', generationId)
      selectedInputImages.forEach(url => formData.append('imageUrls', url))

      const response = await fetch('/api/new-fal-gemini-2.5', {
        method: 'POST',
        body: formData
      })

      const result = await response.json()
      
      if (result.success && result.data.imageUrl) {
        await appendToImageHistory(result.data.imageUrl, 'g-2')
        await loadGenerations()
      } else {
        throw new Error(result.error || 'Failed to generate image')
      }
    } catch (error) {
      console.error('Gemini 2 generation error:', error)
      alert(error instanceof Error ? error.message : 'Failed to generate image')
      await loadGenerations()
    }
  }

  const handleSeedreamGenerate = async () => {
    if (selectedInputImages.length === 0) {
      alert('Please select at least one image from the Input Images node')
      return
    }

    const promptToUse = textPrompt.trim() || globalPrompt.trim()
    console.log('🎨 Seedream Generation - Using prompt:', {
      textPrompt: textPrompt,
      globalPrompt: globalPrompt,
      promptToUse: promptToUse
    })
    
    if (!promptToUse) {
      alert('Please enter a prompt')
      return
    }

    try {
      const generationId = await createGeneration('s-1', promptToUse, selectedInputImages)
      await loadGenerations()
      
      const formData = new FormData()
      formData.append('prompt', promptToUse)
      formData.append('modelRunId', sticker.model_run_id)
      formData.append('nodeId', 's-1')
      formData.append('generationId', generationId)
      selectedInputImages.forEach(url => formData.append('imageUrls', url))

      const response = await fetch('/api/seedream-v4-edit', {
        method: 'POST',
        body: formData
      })

      const result = await response.json()
      
      if (result.success && result.data.imageUrl) {
        await appendToImageHistory(result.data.imageUrl, 's-1')
        await loadGenerations()
      } else {
        throw new Error(result.error || 'Failed to generate image')
      }
    } catch (error) {
      console.error('Seedream generation error:', error)
      alert(error instanceof Error ? error.message : 'Failed to generate image')
      await loadGenerations()
    }
  }

  const handleReveRemixGenerate = async () => {
    if (selectedInputImages.length === 0) {
      alert('Please select at least one image from the Input Images node')
      return
    }

    if (selectedInputImages.length > 4) {
      alert('Reve Remix supports a maximum of 4 images')
      return
    }

    const promptToUse = textPrompt.trim() || globalPrompt.trim()
    console.log('🎨 Reve Remix Generation - Using prompt:', {
      textPrompt: textPrompt,
      globalPrompt: globalPrompt,
      promptToUse: promptToUse
    })
    
    if (!promptToUse) {
      alert('Please enter a prompt')
      return
    }

    try {
      const generationId = await createGeneration('r-1', promptToUse, selectedInputImages)
      await loadGenerations()
      
      const formData = new FormData()
      formData.append('prompt', promptToUse)
      formData.append('modelRunId', sticker.model_run_id)
      formData.append('nodeId', 'r-1')
      formData.append('generationId', generationId)
      selectedInputImages.forEach(url => formData.append('imageUrls', url))

      const response = await fetch('/api/reve-remix', {
        method: 'POST',
        body: formData
      })

      const result = await response.json()
      
      if (result.success && result.data.imageUrl) {
        await appendToImageHistory(result.data.imageUrl, 'r-1')
        await loadGenerations()
      } else {
        throw new Error(result.error || 'Failed to generate image')
      }
    } catch (error) {
      console.error('Reve Remix generation error:', error)
      alert(error instanceof Error ? error.message : 'Failed to generate image')
      await loadGenerations()
    }
  }

  const initialNodes: Node[] = useMemo(() => [
    {
      id: 'text-prompt',
      type: 'textPromptNode',
      position: nodePositions['text-prompt'],
      data: {
        setText: setTextPrompt,
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
      type: 'inputImagesNode',
      position: nodePositions['images-1'],
      data: { 
        sticker,
        includeOriginalDesign,
        setIncludeOriginalDesign,
        includeInputImage,
        setIncludeInputImage,
        additionalImages,
        setAdditionalImages,
        selectedImages: selectedInputImages,
        setSelectedImages: setSelectedInputImages,
      },
    },
    /* COMMENTED OUT - OLD CODE FROM HERE TO LINE 957
            method: 'POST',
            body: geminiFormData
          }).catch(networkError => {
            console.group('🌐 NETWORK ERROR - GEMINI API')
            console.error('❌ Network Error:', networkError)
            console.error('🔗 Failed URL:', 'https://tools.makemeasticker.com/api/universal')
            console.error('⏰ Timestamp:', new Date().toISOString())
            console.groupEnd()
            throw networkError
          })

          const geminiResult = await geminiResponse.json().catch(parseError => {
            console.group('📝 JSON PARSE ERROR - GEMINI API')
            console.error('❌ Parse Error:', parseError)
            console.error('📊 Response Status:', geminiResponse.status)
            console.error('📄 Response Text Length:', geminiResponse.body ? 'Has body' : 'No body')
            console.groupEnd()
            throw parseError
          })
          
          // 🐛 DEBUG: Log successful response
          console.group('📥 GEMINI API RESPONSE DEBUG')
          console.log('✅ Status:', geminiResponse.status, geminiResponse.statusText)
          console.log('📦 Response:', geminiResult)
          console.log('🖼️ Has Image:', !!(geminiResult.image || geminiResult.processedImageUrl))
          console.log('❌ Has Error:', !!geminiResult.error)
          console.groupEnd()

          if (!geminiResponse.ok || geminiResult.error) {
            const errorMsg = geminiResult.error || `HTTP ${geminiResponse.status}: Failed to process with Gemini`
            
            // 🐛 COMPREHENSIVE DEBUG LOGGING
            console.group('🔴 GEMINI API FAILURE - FULL DEBUG INFO')
            console.error('❌ Error Message:', errorMsg)
            console.error('📊 Response Status:', geminiResponse.status, geminiResponse.statusText)
            console.error('📋 Response Headers:', Object.fromEntries(geminiResponse.headers.entries()))
            console.error('📦 Full Response Body:', geminiResult)
            console.error('🖼️ Images Sent:', imageUrls)
            console.error('💬 Prompt Sent:', prompt)
            console.error('🔧 FormData Contents:')
            for (const [key, value] of geminiFormData.entries()) {
              if (key === 'imageUrls') {
                console.error(`  ${key}:`, value)
              } else {
                console.error(`  ${key}:`, typeof value === 'string' ? value : `[${typeof value}]`)
              }
            }
            console.error('🌐 Request URL:', 'https://tools.makemeasticker.com/api/universal')
            console.error('⚙️ Request Method:', 'POST')
            
            if (geminiResult.debugInfo) {
              console.error('🔍 API Debug Info:', geminiResult.debugInfo)
            }
            
            // Additional debugging for image URLs
            console.error('🖼️ Image URL Analysis:')
            imageUrls.forEach((url, index) => {
              console.error(`  Image ${index + 1}:`, url)
              console.error(`    Length: ${url.length} chars`)
              console.error(`    Protocol: ${url.startsWith('https://') ? 'HTTPS' : url.startsWith('http://') ? 'HTTP' : 'OTHER'}`)
              console.error(`    Domain: ${url.split('/')[2] || 'UNKNOWN'}`)
            })
            
            console.groupEnd()
            
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
            
            // 🐛 COMPREHENSIVE DEBUG LOGGING FOR POSTPROCESS
            console.group('🔴 POSTPROCESS API FAILURE - FULL DEBUG INFO')
            console.error('❌ Error Message:', errorMsg)
            console.error('📊 Response Status:', postProcessResponse.status, postProcessResponse.statusText)
            console.error('📋 Response Headers:', Object.fromEntries(postProcessResponse.headers.entries()))
            console.error('📦 Full Response Body:', postProcessResult)
            console.error('🖼️ Input Image URL:', geminiImageUrl)
            console.error('🔧 FormData Contents:')
            for (const [key, value] of postProcessFormData.entries()) {
              console.error(`  ${key}:`, typeof value === 'string' ? value : `[${typeof value}]`)
            }
            console.error('🌐 Request URL:', 'https://tools.makemeasticker.com/api/universal')
            console.error('⚙️ Request Method:', 'POST')
            
            if (postProcessResult.debugInfo) {
              console.error('🔍 API Debug Info:', postProcessResult.debugInfo)
            }
            
            console.groupEnd()
            
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
          
          // Use selectedInputImages which is managed by InputImagesNode
          const imageUrls: string[] = selectedInputImages.length > 0 ? selectedInputImages : getSelectedImages()
          
          // Add each imageUrl separately
          imageUrls.forEach(url => formData.append('imageUrls', url))

          // 🐛 DEBUG: Log OpenAI request
          console.group('📤 OPENAI API REQUEST DEBUG')
          console.log('🌐 URL:', '/api/gpt-image-1')
          console.log('🖼️ Images:', imageUrls.length, 'images')
          console.log('💬 Prompt:', prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''))
          console.groupEnd()

          const response = await fetch('/api/gpt-image-1', {
            method: 'POST',
            body: formData
          }).catch(networkError => {
            console.group('🌐 NETWORK ERROR - OPENAI API')
            console.error('❌ Network Error:', networkError)
            console.error('🔗 Failed URL:', '/api/gpt-image-1')
            console.groupEnd()
            throw networkError
          })

          if (!response.ok) {
            console.group('🔴 OPENAI API FAILURE')
            console.error('📊 Status:', response.status, response.statusText)
            console.error('📋 Headers:', Object.fromEntries(response.headers.entries()))
            console.groupEnd()
            throw new Error(`HTTP ${response.status}: Failed to process with OpenAI GPT Image 1`)
          }

          const result = await response.json()
          
          // 🐛 DEBUG: Log OpenAI response
          console.group('📥 OPENAI API RESPONSE DEBUG')
          console.log('✅ Success:', result.success)
          console.log('📦 Full Result:', result)
          console.log('🖼️ Has Image:', !!(result.data?.image))
          console.groupEnd()

          if (!result.success || !result.data?.image) {
            console.group('🔴 OPENAI API ERROR DETAILS')
            console.error('❌ Error:', result.error)
            console.error('📦 Full Response:', result)
            console.groupEnd()
            throw new Error(result.error || 'No image returned from OpenAI GPT Image 1')
          }

          return { imageUrl: result.data.image, inputImages: imageUrls }

        } else if (tool === 'flux_max') {
          // Use our FLUX.1 Kontext [max] API
          const formData = new FormData()
          formData.append('prompt', prompt)
          
          // For Flux Max, only use the original artwork (top input image)
          // Ignore the photo below it and any uploaded images
          if (sticker.preprocessed_output_image_url) {
            formData.append('imageUrls', sticker.preprocessed_output_image_url)
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
            inputImages: sticker.preprocessed_output_image_url ? [sticker.preprocessed_output_image_url] : [] 
          }

        } else if (tool === 'seedream') {
          // Use our SeeDream v4 Edit API
          const formData = new FormData()
          formData.append('prompt', prompt)
          
          // Use selectedInputImages which is managed by InputImagesNode
          const imageUrls: string[] = selectedInputImages.length > 0 ? selectedInputImages : getSelectedImages()
          
          // Add each imageUrl separately
          imageUrls.forEach(url => formData.append('imageUrls', url))

          // 🐛 DEBUG: Log SeeDream request
          console.group('📤 SEEDREAM API REQUEST DEBUG')
          console.log('🌐 URL:', '/api/seedream-edit')
          console.log('🖼️ Images:', imageUrls.length, 'images')
          console.log('💬 Prompt:', prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''))
          console.groupEnd()

          const response = await fetch('/api/seedream-edit', {
            method: 'POST',
            body: formData
          }).catch(networkError => {
            console.group('🌐 NETWORK ERROR - SEEDREAM API')
            console.error('❌ Network Error:', networkError)
            console.error('🔗 Failed URL:', '/api/seedream-edit')
            console.groupEnd()
            throw networkError
          })

          if (!response.ok) {
            console.group('🔴 SEEDREAM API FAILURE')
            console.error('📊 Status:', response.status, response.statusText)
            console.error('📋 Headers:', Object.fromEntries(response.headers.entries()))
            console.groupEnd()
            throw new Error(`HTTP ${response.status}: Failed to process with SeeDream v4 Edit`)
          }

          const result = await response.json()
          
          // 🐛 DEBUG: Log SeeDream response
          console.group('📥 SEEDREAM API RESPONSE DEBUG')
          console.log('✅ Success:', result.success)
          console.log('📦 Full Result:', result)
          console.log('🖼️ Has Image:', !!(result.data?.imageUrl))
          console.groupEnd()

          if (!result.success || !result.data?.imageUrl) {
            console.group('🔴 SEEDREAM API ERROR DETAILS')
            console.error('❌ Error:', result.error)
            console.error('📦 Full Response:', result)
            console.groupEnd()
            throw new Error(result.error || 'No image returned from SeeDream v4 Edit')
          }

          return { imageUrl: result.data.imageUrl, inputImages: imageUrls }

        } else {
        // TODO: Implement other tools (flux)
        await new Promise(resolve => setTimeout(resolve, 3000))
        result = { imageUrl: sticker.preprocessed_output_image_url || '', inputImages: [] }
      }

      // Generation completed successfully - update the outputs
      updateOutputs(prev => ({
        ...prev,
        [tool]: { 
          ...(prev[tool] as object || {}), 
          model_run_id: currentModelRunIdRef.current,
          status: 'completed', 
          imageUrl: result.imageUrl,
          prompt: prompt,
          inputImages: result.inputImages
        }
      }))

      // Save to image_history
      await appendToImageHistory(result.imageUrl, 'g1')
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : `Failed to generate with ${tool}`
      const isCancelled = errorMessage.includes('cancelled') || errorMessage.includes('aborted')
      
      console.error(`${tool} generation error:`, error)
      
      updateOutputs(prev => ({
        ...prev,
        [tool]: { 
          ...(prev[tool] as object || {}), 
          model_run_id: currentModelRunIdRef.current,
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
  // Calculate dynamic positions based on node heights
  const nodePositions = useMemo(() => {
    const basePositions = {
      'prompt-1': { x: 50, y: 250 },
      'images-1': { x: 400, y: 250 },
      'gemini-node': { x: 750, y: 250 },
      'gemini-node-2': { x: 750, y: 520 },  // Second Gemini node below the first
      'gemini-output': { x: 750, y: 250 },
      'openai-output': { x: 750, y: 320 },
      'flux-max-output': { x: 750, y: 390 },
      'seedream-output': { x: 750, y: 460 },
      'email-composer': { x: 1100, y: 250 },
      'internal-1': { x: 50, y: 500 },
      'user-info-1': { x: 50, y: 670 }
    }

    // Calculate heights based on node states
    const nodeHeights = {
      'internal-1': 150, // Base height for internal node
      'user-info-1': 200, // Base height for user info node
      'images-1': 200, // Base height for image node
      'gemini-output': (outputs.gemini as { imageUrl?: string })?.imageUrl ? 400 : 150, // Expanded when has image
      'openai-output': (outputs.openai as { imageUrl?: string })?.imageUrl ? 400 : 150,
      'flux-max-output': (outputs.flux_max as { imageUrl?: string })?.imageUrl ? 400 : 150,
      'seedream-output': (outputs.seedream as { imageUrl?: string })?.imageUrl ? 400 : 150,
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
    
    // Adjust SeeDream position based on Flux Max height
    const fluxMaxBottom = adjustedPositions['flux-max-output'].y + nodeHeights['flux-max-output']
    adjustedPositions['seedream-output'].y = Math.max(
      basePositions['seedream-output'].y,
      fluxMaxBottom + 10 // 10px gap
    )

    return adjustedPositions
  }, [(outputs.gemini as { imageUrl?: string })?.imageUrl, (outputs.openai as { imageUrl?: string })?.imageUrl, (outputs.flux_max as { imageUrl?: string })?.imageUrl, (outputs.seedream as { imageUrl?: string })?.imageUrl])

  const initialNodes: Node[] = useMemo(() => [
    {
      id: 'prompt-1',
      type: 'promptNode',
      position: nodePositions['prompt-1'],
      data: { 
        globalPrompt,
        setGlobalPrompt,
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
      type: 'inputImagesNode',
      position: nodePositions['images-1'],
      data: { 
        sticker,
        includeOriginalDesign,
        setIncludeOriginalDesign,
        includeInputImage,
        setIncludeInputImage,
        additionalImages,
        setAdditionalImages,
        selectedImages: selectedInputImages,
        setSelectedImages: setSelectedInputImages,
      },
    },
    END OF COMMENTED OUT OLD CODE */
    {
      id: 'gemini-node',
      type: 'geminiNode',
      position: nodePositions['gemini-node'],
      data: { 
        title: 'Gemini',
        tool: 'gemini' as const,
        output: getNodeOutput('g-1'),
        onGenerate: handleGeminiGenerate,
        onAttachToEmail: (imageUrl: string) => {
          console.log('Attaching Gemini image:', imageUrl)
          if (!selectedImages.includes(imageUrl)) {
            setSelectedImages(prev => [...prev, imageUrl])
          }
          setAttachedNodes(prev => {
            const newSet = new Set([...prev, 'gemini-node'])
            console.log('Updated attached nodes:', Array.from(newSet))
            return newSet
          })
        },
        onClear: () => hideGeneration('g-1'),
        onAddToInputs: (imageUrl: string) => {
          console.log('Adding Gemini output to input images:', imageUrl)
          if (!additionalImages.includes(imageUrl)) {
            setAdditionalImages(prev => [...prev, imageUrl])
          }
        },
      },
    },
    {
      id: 'gemini-node-2',
      type: 'geminiNode',
      position: nodePositions['gemini-node-2'],
      data: { 
        title: 'Gemini 2',
        tool: 'gemini2' as const,
        output: getNodeOutput('g-2'),
        onGenerate: handleGemini2Generate,
        onAttachToEmail: (imageUrl: string) => {
          console.log('Attaching Gemini 2 image:', imageUrl)
          if (!selectedImages.includes(imageUrl)) {
            setSelectedImages(prev => [...prev, imageUrl])
          }
          setAttachedNodes(prev => {
            const newSet = new Set([...prev, 'gemini-node-2'])
            console.log('Updated attached nodes:', Array.from(newSet))
            return newSet
          })
        },
        onClear: () => hideGeneration('g-2'),
        onAddToInputs: (imageUrl: string) => {
          console.log('Adding Gemini 2 output to input images:', imageUrl)
          if (!additionalImages.includes(imageUrl)) {
            setAdditionalImages(prev => [...prev, imageUrl])
          }
        },
      },
    },
    {
      id: 'seedream-node',
      type: 'geminiNode',
      position: nodePositions['seedream-node'],
      data: { 
        title: 'Seedream v4',
        tool: 'seedream' as const,
        output: getNodeOutput('s-1'),
        onGenerate: handleSeedreamGenerate,
        onAttachToEmail: (imageUrl: string) => {
          console.log('Attaching Seedream image:', imageUrl)
          if (!selectedImages.includes(imageUrl)) {
            setSelectedImages(prev => [...prev, imageUrl])
          }
          setAttachedNodes(prev => {
            const newSet = new Set([...prev, 'seedream-node'])
            console.log('Updated attached nodes:', Array.from(newSet))
            return newSet
          })
        },
        onClear: () => hideGeneration('s-1'),
        onAddToInputs: (imageUrl: string) => {
          console.log('Adding Seedream output to input images:', imageUrl)
          if (!additionalImages.includes(imageUrl)) {
            setAdditionalImages(prev => [...prev, imageUrl])
          }
        },
      },
    },
    {
      id: 'reve-remix-node',
      type: 'geminiNode',
      position: nodePositions['reve-remix-node'],
      data: { 
        title: 'Reve Remix',
        tool: 'reve' as const,
        output: getNodeOutput('r-1'),
        onGenerate: handleReveRemixGenerate,
        onAttachToEmail: (imageUrl: string) => {
          console.log('Attaching Reve Remix image:', imageUrl)
          if (!selectedImages.includes(imageUrl)) {
            setSelectedImages(prev => [...prev, imageUrl])
          }
          setAttachedNodes(prev => {
            const newSet = new Set([...prev, 'reve-remix-node'])
            console.log('Updated attached nodes:', Array.from(newSet))
            return newSet
          })
        },
        onClear: () => hideGeneration('r-1'),
        onAddToInputs: (imageUrl: string) => {
          console.log('Adding Reve Remix output to input images:', imageUrl)
          if (!additionalImages.includes(imageUrl)) {
            setAdditionalImages(prev => [...prev, imageUrl])
          }
        },
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
    // {
    //   id: 'gemini-output',
    //   type: 'outputNode',
    //   position: nodePositions['gemini-output'],
    //     data: { 
    //       title: 'Gemini',
    //       tool: 'gemini',
    //       output: outputs.gemini,
    //       onGenerate: () => generateWithTool('gemini'),
    //       onAttachToEmail: (imageUrl: string) => {
    //         console.log('Attaching Gemini image:', imageUrl)
    //         if (!selectedImages.includes(imageUrl)) {
    //           setSelectedImages(prev => [...prev, imageUrl])
    //         }
    //         setAttachedNodes(prev => {
    //           const newSet = new Set([...prev, 'gemini-output'])
    //           console.log('Updated attached nodes:', Array.from(newSet))
    //           return newSet
    //         })
    //       },
    //       onClear: () => clearOutput('gemini'),
    //       useGlobalPrompt,
    //       individualPrompt: geminiPrompt,
    //       onPromptChange: setGeminiPrompt,
    //     },
    // },
    // {
    //   id: 'openai-output',
    //   type: 'outputNode',
    //   position: nodePositions['openai-output'],
    //     data: { 
    //       title: 'OpenAI',
    //       tool: 'openai',
    //       output: outputs.openai,
    //       onGenerate: () => generateWithTool('openai'),
    //       onAttachToEmail: (imageUrl: string) => {
    //         console.log('Attaching OpenAI image:', imageUrl)
    //         if (!selectedImages.includes(imageUrl)) {
    //           setSelectedImages(prev => [...prev, imageUrl])
    //         }
    //         setAttachedNodes(prev => {
    //           const newSet = new Set([...prev, 'openai-output'])
    //           console.log('Updated attached nodes:', Array.from(newSet))
    //           return newSet
    //         })
    //       },
    //       onClear: () => clearOutput('openai'),
    //       useGlobalPrompt,
    //       individualPrompt: openaiPrompt,
    //       onPromptChange: setOpenaiPrompt,
    //     },
    // },
    // {
    //   id: 'flux-max-output',
    //   type: 'outputNode',
    //   position: nodePositions['flux-max-output'],
    //     data: { 
    //       title: 'Flux Max',
    //       tool: 'flux_max',
    //       output: outputs.flux_max,
    //       onGenerate: () => generateWithTool('flux_max'),
    //       onAttachToEmail: (imageUrl: string) => {
    //         console.log('Attaching Flux Max image:', imageUrl)
    //         if (!selectedImages.includes(imageUrl)) {
    //           setSelectedImages(prev => [...prev, imageUrl])
    //         }
    //         setAttachedNodes(prev => {
    //           const newSet = new Set([...prev, 'flux-max-output'])
    //           console.log('Updated attached nodes:', Array.from(newSet))
    //           return newSet
    //         })
    //       },
    //       onClear: () => clearOutput('flux_max'),
    //       useGlobalPrompt,
    //       individualPrompt: fluxMaxPrompt,
    //       onPromptChange: setFluxMaxPrompt,
    //     },
    // },
    // {
    //   id: 'seedream-output',
    //   type: 'outputNode',
    //   position: nodePositions['seedream-output'],
    //     data: { 
    //       title: 'SeeDream',
    //       tool: 'seedream',
    //       output: outputs.seedream,
    //       onGenerate: () => generateWithTool('seedream'),
    //       onAttachToEmail: (imageUrl: string) => {
    //         console.log('Attaching SeeDream image:', imageUrl)
    //         if (!selectedImages.includes(imageUrl)) {
    //           setSelectedImages(prev => [...prev, imageUrl])
    //         }
    //         setAttachedNodes(prev => {
    //           const newSet = new Set([...prev, 'seedream-output'])
    //           console.log('Updated attached nodes:', Array.from(newSet))
    //           return newSet
    //         })
    //       },
    //       onClear: () => clearOutput('seedream'),
    //       useGlobalPrompt,
    //       individualPrompt: seedreamPrompt,
    //       onPromptChange: setSeedreamPrompt,
    //     },
    // },
    {
      id: 'email-composer',
      type: 'emailComposerNode',
      position: nodePositions['email-composer'],
      data: {
        customerEmail: sticker.customer_email,
        customerName: sticker.customer_name,
        userId: sticker.model_run_id, // Using model_run_id as the identifier
        selectedImages: emailMode === 'credit' ? [] : selectedImages, // Clear attachments in credit mode
        onSend: async (emailData?: { toEmail?: string; subject?: string; body?: string; conversationId?: string; messageId?: string; creditAmount?: number }) => {
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
          const geminiImage = getNodeOutput('g-1').imageUrl
          const gemini2Image = getNodeOutput('g-2').imageUrl
          const seedreamImage = getNodeOutput('s-1').imageUrl
          const reveRemixImage = getNodeOutput('r-1').imageUrl
          
          setAttachedNodes(prev => {
            const newSet = new Set(prev)
            if (imageUrl === geminiImage) newSet.delete('gemini-node')
            if (imageUrl === gemini2Image) newSet.delete('gemini-node-2')
            if (imageUrl === seedreamImage) newSet.delete('seedream-node')
            if (imageUrl === reveRemixImage) newSet.delete('reve-remix-node')
            console.log('Updated attached nodes after detach:', Array.from(newSet))
            return newSet
          })
        },
      },
    },
  ], [setGlobalPrompt, includeOriginalDesign, includeInputImage, additionalImages, selectedInputImages, internalNotes, generations, sticker, selectedImages, isSendingEmail, isSendingCreditEmail, emailMode, attachedNodes, onNext, nodePositions])

  const initialEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [
      // Text Prompt to all outputs
      { id: 'text-prompt-gemini-node', source: 'text-prompt', target: 'gemini-node', animated: true, style: { stroke: '#8b5cf6' } },
      { id: 'text-prompt-gemini-node-2', source: 'text-prompt', target: 'gemini-node-2', animated: true, style: { stroke: '#8b5cf6' } },
      { id: 'text-prompt-seedream-node', source: 'text-prompt', target: 'seedream-node', animated: true, style: { stroke: '#8b5cf6' } },
      { id: 'text-prompt-reve-remix-node', source: 'text-prompt', target: 'reve-remix-node', animated: true, style: { stroke: '#8b5cf6' } },
      // { id: 'prompt-flux', source: 'prompt-1', target: 'flux-output', animated: true, style: { stroke: '#8b5cf6' } },
      // { id: 'prompt-gemini', source: 'prompt-1', target: 'gemini-output', animated: true, style: { stroke: '#f97316' } },
      // { id: 'prompt-openai', source: 'prompt-1', target: 'openai-output', animated: true, style: { stroke: '#10b981' } },
      // { id: 'prompt-flux-max', source: 'prompt-1', target: 'flux-max-output', animated: true, style: { stroke: '#6d28d9' } },
      // { id: 'prompt-seedream', source: 'prompt-1', target: 'seedream-output', animated: true, style: { stroke: '#e11d48' } },
    ]

    // Add image edges if enabled
    if (includeOriginalDesign || includeInputImage) {
      edges.push(
        { id: 'images-gemini-node', source: 'images-1', target: 'gemini-node', animated: true, style: { stroke: '#3b82f6' } },
        { id: 'images-gemini-node-2', source: 'images-1', target: 'gemini-node-2', animated: true, style: { stroke: '#3b82f6' } },
        { id: 'images-seedream-node', source: 'images-1', target: 'seedream-node', animated: true, style: { stroke: '#3b82f6' } },
        { id: 'images-reve-remix-node', source: 'images-1', target: 'reve-remix-node', animated: true, style: { stroke: '#3b82f6' } },
      )
      // edges.push(
      //   { id: 'images-flux', source: 'images-1', target: 'flux-output', animated: true, style: { stroke: '#3b82f6' } },
      //   { id: 'images-gemini', source: 'images-1', target: 'gemini-output', animated: true, style: { stroke: '#3b82f6' } },
      //   { id: 'images-openai', source: 'images-1', target: 'openai-output', animated: true, style: { stroke: '#3b82f6' } },
      //   { id: 'images-flux-max', source: 'images-1', target: 'flux-max-output', animated: true, style: { stroke: '#3b82f6' } },
      //   { id: 'images-seedream', source: 'images-1', target: 'seedream-output', animated: true, style: { stroke: '#3b82f6' } }
      // )
    }

    // Add connections to email composer for attached nodes only
    console.log('Building edges, attached nodes:', Array.from(attachedNodes))
    
    if (attachedNodes.has('gemini-node')) {
      console.log('Adding Gemini Node → Email edge')
      edges.push({ 
        id: 'gemini-node-email', 
        source: 'gemini-node', 
        target: 'email-composer', 
        animated: true, 
        style: { stroke: '#f97316', strokeWidth: 3, strokeDasharray: '8,4' } 
      })
    }
    if (attachedNodes.has('gemini-node-2')) {
      console.log('Adding Gemini Node 2 → Email edge')
      edges.push({ 
        id: 'gemini-node-2-email', 
        source: 'gemini-node-2', 
        target: 'email-composer', 
        animated: true, 
        style: { stroke: '#f97316', strokeWidth: 3, strokeDasharray: '8,4' } 
      })
    }
    if (attachedNodes.has('seedream-node')) {
      console.log('Adding Seedream Node → Email edge')
      edges.push({ 
        id: 'seedream-node-email', 
        source: 'seedream-node', 
        target: 'email-composer', 
        animated: true, 
        style: { stroke: '#e11d48', strokeWidth: 3, strokeDasharray: '8,4' } 
      })
    }
    if (attachedNodes.has('reve-remix-node')) {
      console.log('Adding Reve Remix Node → Email edge')
      edges.push({ 
        id: 'reve-remix-node-email', 
        source: 'reve-remix-node', 
        target: 'email-composer', 
        animated: true, 
        style: { stroke: '#10b981', strokeWidth: 3, strokeDasharray: '8,4' } 
      })
    }
    // if (attachedNodes.has('flux-output')) {
    //   console.log('Adding Flux → Email edge')
    //   edges.push({ 
    //     id: 'flux-email', 
    //     source: 'flux-output', 
    //     target: 'email-composer', 
    //     animated: true, 
    //     style: { stroke: '#8b5cf6', strokeWidth: 3, strokeDasharray: '8,4' } 
    //   })
    // }
    // if (attachedNodes.has('gemini-output')) {
    //   console.log('Adding Gemini → Email edge')
    //   edges.push({ 
    //     id: 'gemini-email', 
    //     source: 'gemini-output', 
    //     target: 'email-composer', 
    //     animated: true, 
    //     style: { stroke: '#f97316', strokeWidth: 3, strokeDasharray: '8,4' } 
    //   })
    // }
    // if (attachedNodes.has('openai-output')) {
    //   console.log('Adding OpenAI → Email edge')
    //   edges.push({ 
    //     id: 'openai-email', 
    //     source: 'openai-output', 
    //     target: 'email-composer', 
    //     animated: true, 
    //     style: { stroke: '#10b981', strokeWidth: 3, strokeDasharray: '8,4' } 
    //   })
    // }
    // if (attachedNodes.has('flux-max-output')) {
    //   console.log('Adding Flux Max → Email edge')
    //   edges.push({ 
    //     id: 'flux-max-email', 
    //     source: 'flux-max-output', 
    //     target: 'email-composer', 
    //     animated: true, 
    //     style: { stroke: '#6d28d9', strokeWidth: 3, strokeDasharray: '8,4' } 
    //   })
    // }
    // if (attachedNodes.has('seedream-output')) {
    //   console.log('Adding SeeDream → Email edge')
    //   edges.push({ 
    //     id: 'seedream-email', 
    //     source: 'seedream-output', 
    //     target: 'email-composer', 
    //     animated: true, 
    //     style: { stroke: '#e11d48', strokeWidth: 3, strokeDasharray: '8,4' } 
    //   })
    // }
    
    console.log('Final edges:', edges.length, edges.map(e => e.id))

    return edges
  }, [includeOriginalDesign, includeInputImage, selectedImages, attachedNodes])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Update prompt node data when globalPrompt changes (without recreating the node)
  // REMOVED: This was causing the input to lose focus on every keystroke
  // The node will get globalPrompt via initialNodes instead

  // Update nodes and edges when state changes (excluding globalPrompt-triggered updates)
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
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
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
