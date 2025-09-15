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
import BottomToolbar from './BottomToolbar'
import FloatingNavigation from './FloatingNavigation'
import PromptNode from './nodes/PromptNode'
import ImageNode from './nodes/ImageNode'
import OutputNode from './nodes/OutputNode'
import EmailComposerNode from './nodes/EmailComposerNode'

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

  // Prompt state - prefill with customer feedback
  const [globalPrompt, setGlobalPrompt] = useState(sticker.feedback_notes)
  const [useGlobalPrompt, setUseGlobalPrompt] = useState(true)
  const [fluxPrompt, setFluxPrompt] = useState(sticker.feedback_notes)
  const [geminiPrompt, setGeminiPrompt] = useState(sticker.feedback_notes)
  const [openaiPrompt, setOpenaiPrompt] = useState(sticker.feedback_notes)
  const [fluxMaxPrompt, setFluxMaxPrompt] = useState(sticker.feedback_notes)
  const [includeOriginalDesign, setIncludeOriginalDesign] = useState(true)
  const [includeInputImage, setIncludeInputImage] = useState(true)
  const [additionalImages, setAdditionalImages] = useState<string[]>([])

  // Reset all node states when sticker changes
  useEffect(() => {
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
  }, [sticker.model_run_id]) // Use model_run_id as the key for when record changes

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
                            activeElement?.contentEditable === 'true'
      
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

  // Generate with specific tool
  const generateWithTool = async (tool: 'flux' | 'gemini' | 'openai' | 'flux_max') => {
    const prompt = useGlobalPrompt ? globalPrompt : 
                  tool === 'flux' ? fluxPrompt :
                  tool === 'gemini' ? geminiPrompt :
                  tool === 'openai' ? openaiPrompt : fluxMaxPrompt

    if (!prompt.trim()) {
      alert('Please enter a prompt first')
      return
    }

    updateOutputs(prev => ({
      ...prev,
      [tool]: { status: 'processing', prompt, imageUrl: '', timestamp: new Date() }
    }))

    try {
      if (tool === 'gemini') {
        // Use our new universal Gemini API
        const formData = new FormData()
        formData.append('prompt', prompt)
        
        // Collect image URLs - use output image, input image, and additional images if available
        const imageUrls = []
        if (includeOriginalDesign && sticker.output_image_url) {
          imageUrls.push(sticker.output_image_url)
        }
        if (includeInputImage && sticker.input_image_url) {
          imageUrls.push(sticker.input_image_url)
        }
        // Add additional uploaded images
        additionalImages.forEach(url => imageUrls.push(url))
        
        // Add each imageUrl separately
        imageUrls.forEach(url => formData.append('imageUrls', url))

        const response = await fetch('/api/universal-gemini-2.5', {
          method: 'POST',
          body: formData
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: Failed to process with Gemini 2.5`)
        }

        const result = await response.json()
        if (!result.success || !result.data?.image) {
          throw new Error(result.error || 'No image returned from Gemini 2.5')
        }

        updateOutputs(prev => ({
          ...prev,
          [tool]: { 
            ...prev[tool], 
            status: 'completed', 
            imageUrl: result.data.image,
            prompt: prompt,
            inputImages: imageUrls
          }
        }))
      } else if (tool === 'openai') {
        // Use our OpenAI GPT Image 1 API
        const formData = new FormData()
        formData.append('prompt', prompt)
        
        // Collect image URLs - use output image, input image, and additional images if available
        const imageUrls = []
        if (includeOriginalDesign && sticker.output_image_url) {
          imageUrls.push(sticker.output_image_url)
        }
        if (includeInputImage && sticker.input_image_url) {
          imageUrls.push(sticker.input_image_url)
        }
        // Add additional uploaded images
        additionalImages.forEach(url => imageUrls.push(url))
        
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

        updateOutputs(prev => ({
          ...prev,
          [tool]: { 
            ...prev[tool], 
            status: 'completed', 
            imageUrl: result.data.image,
            prompt: prompt,
            inputImages: imageUrls
          }
        }))
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

        updateOutputs(prev => ({
          ...prev,
          [tool]: { 
            ...prev[tool], 
            status: 'completed', 
            imageUrl: result.data.imageUrl,
            prompt: prompt,
            inputImages: sticker.output_image_url ? [sticker.output_image_url] : []
          }
        }))
      } else {
        // TODO: Implement other tools (flux)
        setTimeout(() => {
          updateOutputs(prev => ({
            ...prev,
            [tool]: { ...prev[tool], status: 'completed', imageUrl: sticker.output_image_url }
          }))
        }, 3000)
      }
    } catch (error) {
      console.error(`${tool} generation error:`, error)
      updateOutputs(prev => ({
        ...prev,
        [tool]: { ...prev[tool], status: 'failed' }
      }))
      alert(error instanceof Error ? error.message : `Failed to generate with ${tool}`)
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
      'email-composer': { x: 1100, y: 250 }
    }

    // Calculate heights based on node states
    const nodeHeights = {
      'prompt-1': 150, // Base height for prompt node
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
        onSend: async (emailData?: { toEmail?: string; subject?: string; body?: string }) => {
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
  ], [globalPrompt, useGlobalPrompt, fluxPrompt, geminiPrompt, openaiPrompt, fluxMaxPrompt, includeOriginalDesign, includeInputImage, additionalImages, outputs, sticker, selectedImages, isSendingEmail, isSendingCreditEmail, emailMode, attachedNodes, onNext, nodePositions])

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
