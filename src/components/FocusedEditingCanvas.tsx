'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { StickerEdit } from '@/types/sticker'

interface FocusedEditingCanvasProps {
  sticker: StickerEdit
  onNext: () => void
  onPrevious: () => void
  onComplete: (stickerId: string) => void
}

interface EditOutput {
  id: string
  tool: 'flux' | 'gemini' | 'openai'
  imageUrl: string
  prompt: string
  status: 'idle' | 'processing' | 'completed' | 'failed'
  timestamp: Date
  x: number
  y: number
}

export default function FocusedEditingCanvas({ sticker, onNext, onPrevious, onComplete }: FocusedEditingCanvasProps) {
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, scale: 1 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)

  // Editing state
  const [globalPrompt, setGlobalPrompt] = useState(sticker.feedback_notes)
  const [useGlobalPrompt, setUseGlobalPrompt] = useState(true)
  const [fluxPrompt, setFluxPrompt] = useState(sticker.feedback_notes)
  const [geminiPrompt, setGeminiPrompt] = useState(sticker.feedback_notes)
  const [openaiPrompt, setOpenaiPrompt] = useState(sticker.feedback_notes)
  const [includeOriginalDesign, setIncludeOriginalDesign] = useState(true)
  const [includeInputImage, setIncludeInputImage] = useState(false)
  const [outputs, setOutputs] = useState<EditOutput[]>([])

  // Update prompts when sticker changes
  useEffect(() => {
    setGlobalPrompt(sticker.feedback_notes)
    setFluxPrompt(sticker.feedback_notes)
    setGeminiPrompt(sticker.feedback_notes)
    setOpenaiPrompt(sticker.feedback_notes)
  }, [sticker.feedback_notes, sticker.model_run_id])

  // Canvas panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target === canvasRef.current || target.closest('[data-canvas-background]')) {
      e.preventDefault()
      setIsDragging(true)
      setDragStart({ x: e.clientX - viewBox.x, y: e.clientY - viewBox.y })
    }
  }, [viewBox])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      const newX = e.clientX - dragStart.x
      const newY = e.clientY - dragStart.y
      setViewBox(prev => ({ ...prev, x: newX, y: newY }))
    }
  }, [isDragging, dragStart])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newScale = Math.max(0.1, Math.min(3, viewBox.scale * delta))
    setViewBox(prev => ({ ...prev, scale: newScale }))
  }, [viewBox.scale])

  // Generate with specific tool
  const generateWithTool = async (tool: 'flux' | 'gemini' | 'openai') => {
    const prompt = useGlobalPrompt ? globalPrompt : 
                  tool === 'flux' ? fluxPrompt :
                  tool === 'gemini' ? geminiPrompt : openaiPrompt

    if (!prompt.trim()) {
      alert('Please enter a prompt first')
      return
    }

    const newOutput: EditOutput = {
      id: `${tool}-${Date.now()}`,
      tool,
      imageUrl: '',
      prompt,
      status: 'processing',
      timestamp: new Date(),
      x: tool === 'flux' ? 400 : tool === 'gemini' ? 700 : 1000,
      y: 300
    }

    setOutputs(prev => [...prev, newOutput])

    try {
      if (tool === 'gemini') {
        // Gemini implementation with automatic postProcess chaining
        console.log('FocusedCanvas: Starting Gemini → postProcess chain with prompt:', prompt)
        
        try {
          // Step 1: Call Gemini tool
          const geminiFormData = new FormData()
          geminiFormData.append('tool', 'gemini')
          geminiFormData.append('prompt', prompt)
          geminiFormData.append('debug', 'true')
          
          // Collect image URLs - use preprocessed output image and input image if available
          const imageUrls = []
          if (includeOriginalDesign && sticker.preprocessed_output_image_url) {
            imageUrls.push(sticker.preprocessed_output_image_url)
          }
          if (includeInputImage && sticker.input_image_url) {
            imageUrls.push(sticker.input_image_url)
          }
          
          console.log('FocusedCanvas: Image URLs for Gemini:', imageUrls)
          
          if (imageUrls.length === 0) {
            throw new Error('No images selected. Please select at least one image to process.')
          }
          
          geminiFormData.append('imageUrls', imageUrls.join(','))

          console.log('FocusedCanvas: Step 1 - Calling Gemini API...')
          const geminiResponse = await fetch('https://tools.makemeasticker.com/api/universal', {
            method: 'POST',
            body: geminiFormData
          })

          const geminiResult = await geminiResponse.json()
          console.log('FocusedCanvas: Gemini API response:', geminiResult)

          if (!geminiResponse.ok || geminiResult.error) {
            const errorMsg = geminiResult.error || `HTTP ${geminiResponse.status}: Failed to process with Gemini`
            console.error('FocusedCanvas: Gemini API error:', errorMsg)
            if (geminiResult.debugInfo) {
              console.error('FocusedCanvas: Gemini debug info:', geminiResult.debugInfo)
            }
            throw new Error(errorMsg)
          }

          if (!geminiResult.image && !geminiResult.processedImageUrl) {
            throw new Error('No image returned from Gemini API')
          }

          const geminiImageUrl = geminiResult.image || geminiResult.processedImageUrl
          console.log('FocusedCanvas: Step 1 complete - Gemini generation successful:', geminiImageUrl)

          // Step 2: Call postProcess tool with Gemini result
          console.log('FocusedCanvas: Step 2 - Calling postProcess API...')
          const postProcessFormData = new FormData()
          postProcessFormData.append('tool', 'postProcess')
          postProcessFormData.append('imageUrl', geminiImageUrl)
          postProcessFormData.append('debug', 'true')

          const postProcessResponse = await fetch('https://tools.makemeasticker.com/api/universal', {
            method: 'POST',
            body: postProcessFormData
          })

          const postProcessResult = await postProcessResponse.json()
          console.log('FocusedCanvas: PostProcess API response:', postProcessResult)

          if (!postProcessResponse.ok || postProcessResult.error) {
            const errorMsg = postProcessResult.error || `HTTP ${postProcessResponse.status}: Failed to post-process image`
            console.error('FocusedCanvas: PostProcess API error:', errorMsg)
            if (postProcessResult.debugInfo) {
              console.error('FocusedCanvas: PostProcess debug info:', postProcessResult.debugInfo)
            }
            throw new Error(errorMsg)
          }

          if (!postProcessResult.image && !postProcessResult.processedImageUrl) {
            throw new Error('No processed image returned from postProcess API')
          }

          const finalImageUrl = postProcessResult.image || postProcessResult.processedImageUrl
          console.log('FocusedCanvas: Step 2 complete - PostProcess successful:', finalImageUrl)
          console.log('FocusedCanvas: Gemini → postProcess chain completed successfully!')

          setOutputs(prev => prev.map(output => 
            output.id === newOutput.id 
              ? { ...output, status: 'completed' as const, imageUrl: finalImageUrl }
              : output
          ))
        } catch (chainError) {
          console.error('FocusedCanvas: Gemini → postProcess chain failed:', chainError)
          throw chainError
        }
      } else {
        // TODO: Implement other tools (flux, openai)
        setTimeout(() => {
          setOutputs(prev => prev.map(output => 
            output.id === newOutput.id 
              ? { ...output, status: 'completed' as const, imageUrl: sticker.preprocessed_output_image_url }
              : output
          ))
        }, 3000)
      }
    } catch (error) {
      console.error(`${tool} generation error:`, error)
      setOutputs(prev => prev.map(output => 
        output.id === newOutput.id 
          ? { ...output, status: 'failed' as const }
          : output
      ))
      alert(error instanceof Error ? error.message : `Failed to generate with ${tool}`)
    }
  }

  return (
    <div className="w-full h-screen flex">
      
      {/* Minimal Left Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        
        {/* Navigation */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex gap-2 mb-3">
            <button 
              onClick={onPrevious}
              className="flex-1 px-3 py-2 bg-gray-500 text-white text-sm rounded hover:bg-gray-600 transition-colors"
            >
              ← Previous
            </button>
            <button 
              onClick={onNext}
              className="flex-1 px-3 py-2 bg-gray-500 text-white text-sm rounded hover:bg-gray-600 transition-colors"
            >
              Next →
            </button>
          </div>
          <div className="text-sm text-gray-600">
            <div className="font-medium">{sticker.customer_name}</div>
            <div className="text-xs">{sticker.customer_email}</div>
          </div>
        </div>

        {/* Original Feedback */}
        <div className="p-4 border-b border-gray-200">
          <h3 className="font-medium text-gray-900 mb-2">Customer Feedback</h3>
          <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded">
            {sticker.feedback_notes}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-4 mt-auto space-y-2">
          <button
            onClick={() => onComplete(sticker.sticker_edit_id)}
            className="w-full px-4 py-3 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
          >
            ✅ Mark Complete
          </button>
          <button
            onClick={() => {
              // TODO: Mark as resolved
              console.log('Mark as resolved:', sticker.sticker_edit_id)
            }}
            className="w-full px-4 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            🔧 Mark Resolved
          </button>
        </div>
      </div>

      {/* Right Canvas */}
      <div className="flex-1 relative">
        <div
          ref={canvasRef}
          className="w-full h-full overflow-hidden cursor-grab active:cursor-grabbing"
          style={{
            background: 'radial-gradient(circle at 20px 20px, #e5e7eb 1px, transparent 1px)',
            backgroundSize: '40px 40px'
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
        >
          <div
            data-canvas-background="true"
            style={{
              transform: `translate(${viewBox.x}px, ${viewBox.y}px) scale(${viewBox.scale})`,
              transformOrigin: '0 0',
              width: '100%',
              height: '100%',
              position: 'relative'
            }}
          >
            
            {/* Prompt Control Node */}
            <PromptControlNode
              globalPrompt={globalPrompt}
              setGlobalPrompt={setGlobalPrompt}
              useGlobalPrompt={useGlobalPrompt}
              setUseGlobalPrompt={setUseGlobalPrompt}
              fluxPrompt={fluxPrompt}
              setFluxPrompt={setFluxPrompt}
              geminiPrompt={geminiPrompt}
              setGeminiPrompt={setGeminiPrompt}
              openaiPrompt={openaiPrompt}
              setOpenaiPrompt={setOpenaiPrompt}
              x={100}
              y={50}
            />

            {/* Image Control Node */}
            <ImageControlNode
              sticker={sticker}
              includeOriginalDesign={includeOriginalDesign}
              setIncludeOriginalDesign={setIncludeOriginalDesign}
              includeInputImage={includeInputImage}
              setIncludeInputImage={setIncludeInputImage}
              x={100}
              y={350}
            />

            {/* Connection Lines */}
            <svg
              className="absolute inset-0 pointer-events-none"
              style={{ width: '100%', height: '100%' }}
            >
              {/* Prompt to all outputs */}
              <ConnectionLine from={{ x: 364, y: 150 }} to={{ x: 700, y: 200 }} color="#8b5cf6" />
              <ConnectionLine from={{ x: 364, y: 150 }} to={{ x: 700, y: 450 }} color="#f97316" />
              <ConnectionLine from={{ x: 364, y: 150 }} to={{ x: 700, y: 700 }} color="#10b981" />
              
              {/* Images to outputs */}
              {includeOriginalDesign && (
                <>
                  <ConnectionLine from={{ x: 364, y: 400 }} to={{ x: 700, y: 200 }} color="#3b82f6" />
                  <ConnectionLine from={{ x: 364, y: 400 }} to={{ x: 700, y: 450 }} color="#3b82f6" />
                  <ConnectionLine from={{ x: 364, y: 400 }} to={{ x: 700, y: 700 }} color="#3b82f6" />
                </>
              )}
              
              {includeInputImage && sticker.input_image_url && (
                <>
                  <ConnectionLine from={{ x: 364, y: 650 }} to={{ x: 700, y: 200 }} color="#6366f1" />
                  <ConnectionLine from={{ x: 364, y: 650 }} to={{ x: 700, y: 450 }} color="#6366f1" />
                  <ConnectionLine from={{ x: 364, y: 650 }} to={{ x: 700, y: 700 }} color="#6366f1" />
                </>
              )}
            </svg>

            {/* Output Nodes with Run Buttons */}
            <OutputNode
              title="Flux"
              tool="flux"
              x={700}
              y={150}
              output={outputs.find(o => o.tool === 'flux')}
              onGenerate={() => generateWithTool('flux')}
            />
            
            <OutputNode
              title="Gemini"
              tool="gemini"
              x={700}
              y={400}
              output={outputs.find(o => o.tool === 'gemini')}
              onGenerate={() => generateWithTool('gemini')}
            />
            
            <OutputNode
              title="OpenAI"
              tool="openai"
              x={700}
              y={650}
              output={outputs.find(o => o.tool === 'openai')}
              onGenerate={() => generateWithTool('openai')}
            />

          </div>
        </div>
      </div>
    </div>
  )
}

interface PromptControlNodeProps {
  globalPrompt: string
  setGlobalPrompt: (value: string) => void
  useGlobalPrompt: boolean
  setUseGlobalPrompt: (value: boolean) => void
  fluxPrompt: string
  setFluxPrompt: (value: string) => void
  geminiPrompt: string
  setGeminiPrompt: (value: string) => void
  openaiPrompt: string
  setOpenaiPrompt: (value: string) => void
  x: number
  y: number
}

function PromptControlNode({ 
  globalPrompt, setGlobalPrompt, useGlobalPrompt, setUseGlobalPrompt,
  fluxPrompt, setFluxPrompt, geminiPrompt, setGeminiPrompt, openaiPrompt, setOpenaiPrompt,
  x, y 
}: PromptControlNodeProps) {
  return (
    <div className="absolute" style={{ left: x, top: y }}>
      <div className="bg-white rounded-lg shadow-lg border border-gray-300 p-4 w-80">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-medium text-gray-900">Edit Prompt</div>
            <div className="text-xs text-gray-500">Text Input</div>
          </div>
          <div className="w-3 h-3 bg-orange-400 rounded-full" />
        </div>
        
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="useGlobalPrompt"
              checked={useGlobalPrompt}
              onChange={(e) => setUseGlobalPrompt(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="useGlobalPrompt" className="text-xs text-gray-700">
              Use same prompt for all tools
            </label>
          </div>

          {useGlobalPrompt ? (
            <textarea
              value={globalPrompt}
              onChange={(e) => setGlobalPrompt(e.target.value)}
              placeholder="Enter prompt for all AI tools..."
              className="w-full h-20 p-2 border border-gray-300 rounded text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          ) : (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-purple-700 mb-1">Flux</label>
                <textarea
                  value={fluxPrompt}
                  onChange={(e) => setFluxPrompt(e.target.value)}
                  placeholder="Flux prompt..."
                  className="w-full h-12 p-2 border border-purple-300 rounded text-xs resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-orange-700 mb-1">Gemini</label>
                <textarea
                  value={geminiPrompt}
                  onChange={(e) => setGeminiPrompt(e.target.value)}
                  placeholder="Gemini prompt..."
                  className="w-full h-12 p-2 border border-orange-300 rounded text-xs resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-green-700 mb-1">OpenAI</label>
                <textarea
                  value={openaiPrompt}
                  onChange={(e) => setOpenaiPrompt(e.target.value)}
                  placeholder="OpenAI prompt..."
                  className="w-full h-12 p-2 border border-green-300 rounded text-xs resize-none"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface ImageControlNodeProps {
  sticker: StickerEdit
  includeOriginalDesign: boolean
  setIncludeOriginalDesign: (value: boolean) => void
  includeInputImage: boolean
  setIncludeInputImage: (value: boolean) => void
  x: number
  y: number
}

function ImageControlNode({ 
  sticker, includeOriginalDesign, setIncludeOriginalDesign, 
  includeInputImage, setIncludeInputImage, x, y 
}: ImageControlNodeProps) {
  return (
    <div className="absolute" style={{ left: x, top: y }}>
      <div className="bg-white rounded-lg shadow-lg border border-gray-300 p-4 w-80">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-medium text-gray-900">Input Images</div>
            <div className="text-xs text-gray-500">Image Inputs</div>
          </div>
          <div className="w-3 h-3 bg-blue-400 rounded-full" />
        </div>
        
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="includeOriginalDesign"
              checked={includeOriginalDesign}
              onChange={(e) => setIncludeOriginalDesign(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="includeOriginalDesign" className="text-xs text-gray-700">
              Include original design
            </label>
          </div>
          
          {includeOriginalDesign && sticker.preprocessed_output_image_url && (
            <img 
              src={sticker.preprocessed_output_image_url} 
              alt="Original design"
              className="w-full h-24 object-cover rounded border"
              draggable={false}
            />
          )}

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="includeInputImage"
              checked={includeInputImage}
              onChange={(e) => setIncludeInputImage(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="includeInputImage" className="text-xs text-gray-700">
              Include input photo
            </label>
          </div>
          
          {includeInputImage && sticker.input_image_url && (
            <img 
              src={sticker.input_image_url} 
              alt="Input photo"
              className="w-full h-24 object-cover rounded border"
              draggable={false}
            />
          )}
        </div>
      </div>
    </div>
  )
}

interface InputNodeProps {
  title: string
  subtitle: string
  type: 'prompt' | 'image'
  content?: string
  imageUrl?: string
  x: number
  y: number
  connections: string[]
}

function InputNode({ title, subtitle, type, content, imageUrl, x, y }: InputNodeProps) {
  return (
    <div
      className="absolute"
      style={{ left: x, top: y }}
    >
      <div className="bg-white rounded-lg shadow-lg border border-gray-300 p-4 w-64">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-medium text-gray-900">{title}</div>
            <div className="text-xs text-gray-500">{subtitle}</div>
          </div>
          <div className="w-3 h-3 bg-gray-400 rounded-full" />
        </div>
        
        {type === 'image' && imageUrl ? (
          <img 
            src={imageUrl} 
            alt={title}
            className="w-full h-32 object-cover rounded"
            draggable={false}
          />
        ) : (
          <div className="text-xs text-gray-600 bg-gray-50 p-3 rounded h-32 overflow-y-auto">
            {content || 'No content'}
          </div>
        )}
      </div>
    </div>
  )
}

interface OutputNodeProps {
  title: string
  tool: 'flux' | 'gemini' | 'openai'
  x: number
  y: number
  output?: EditOutput
  onGenerate: () => void
}

function OutputNode({ title, tool, x, y, output, onGenerate }: OutputNodeProps) {
  const getToolColor = (tool: string) => {
    switch (tool) {
      case 'flux': return '#8b5cf6'
      case 'gemini': return '#f97316'
      case 'openai': return '#10b981'
      default: return '#6b7280'
    }
  }

  return (
    <div
      className="absolute"
      style={{ left: x, top: y }}
    >
      <div 
        className="bg-white rounded-lg shadow-lg border-2 p-4 w-64"
        style={{ borderColor: getToolColor(tool) }}
      >
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="flex items-center gap-2">
              {tool === 'openai' ? (
                <img src="/openai.svg" alt="OpenAI" className="w-4 h-4" />
              ) : tool === 'gemini' ? (
                <img src="/gemini.svg" alt="Gemini" className="w-4 h-4" />
              ) : tool === 'flux' ? (
                <img src="/flux.svg" alt="Flux" className="w-4 h-4" />
              ) : (
                <div className="text-sm font-medium text-gray-900">{title}</div>
              )}
            </div>
            <div className="text-xs text-gray-500">Generated Image</div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              output?.status === 'completed' ? 'bg-green-500' :
              output?.status === 'processing' ? 'bg-yellow-500 animate-pulse' :
              output?.status === 'failed' ? 'bg-red-500' : 'bg-gray-300'
            }`} />
            
            {/* Email Icon */}
            <button 
              className="text-gray-600 hover:text-gray-800 p-1 hover:bg-gray-50 rounded transition-colors"
              title="Attach to Email"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
            </button>
            
            {/* Run Icon */}
            <button
              onClick={onGenerate}
              disabled={output?.status === 'processing'}
              className="text-gray-600 hover:text-gray-800 p-1 hover:bg-gray-50 rounded transition-colors disabled:text-gray-400"
              title={output?.status === 'processing' ? 'Generating...' : `Run ${title}`}
            >
              {output?.status === 'processing' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="animate-spin">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3l14 9-14 9V3z"/>
                </svg>
              )}
            </button>
          </div>
        </div>

        <div 
          className="w-full aspect-square rounded flex items-center justify-center overflow-hidden mb-3 relative group"
          style={{
            backgroundImage: `repeating-conic-gradient(#f0f0f0 0% 25%, #ffffff 0% 50%)`,
            backgroundSize: '20px 20px'
          }}
        >
          {output?.imageUrl ? (
            <>
              <img 
                src={output.imageUrl} 
                alt={`${tool} output`}
                className="max-w-full max-h-full object-contain"
                draggable={false}
              />
              
              {/* Tooltip Icon - always visible in top right corner */}
              <div className="absolute top-2 right-2 group/tooltip">
                <div className="bg-black/60 hover:bg-black/80 text-white rounded-full w-6 h-6 flex items-center justify-center cursor-help transition-colors">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M9,9h0a3,3,0,0,1,6,0c0,2-3,3-3,3"/>
                    <path d="M12,17h0"/>
                  </svg>
                </div>
                
                {/* Tooltip - appears on hover over icon */}
                <div className="absolute top-8 right-0 opacity-0 group-hover/tooltip:opacity-100 transition-opacity duration-200 pointer-events-none z-10">
                  <div className="bg-black/90 text-white text-xs px-3 py-2 rounded shadow-lg whitespace-nowrap max-w-[250px]">
                    <div className="font-medium">{title} Output</div>
                    {output?.prompt && (
                      <div className="text-gray-300 mt-1">
                        "{output.prompt.length > 50 ? output.prompt.substring(0, 50) + '...' : output.prompt}"
                      </div>
                    )}
                    {output?.timestamp && (
                      <div className="text-gray-400 text-[10px] mt-1">
                        Generated: {new Date(output.timestamp).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : output?.status === 'processing' ? (
            <div className="text-gray-600 text-sm bg-white/80 px-2 py-1 rounded">Generating...</div>
          ) : (
            <div className="text-gray-600 text-sm bg-white/80 px-2 py-1 rounded">Ready to Generate</div>
          )}
        </div>

        {/* Prompt Preview - Only show if there's an image */}
        {output?.imageUrl && output?.prompt && (
          <div className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
            "{output.prompt}"
          </div>
        )}
      </div>
    </div>
  )
}

interface ConnectionLineProps {
  from: { x: number; y: number }
  to: { x: number; y: number }
  color: string
}

function ConnectionLine({ from, to, color }: ConnectionLineProps) {
  // Create a curved connection line
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  const controlX1 = from.x + (midX - from.x) * 0.5
  const controlX2 = to.x - (to.x - midX) * 0.5
  
  const path = `M ${from.x} ${from.y} C ${controlX1} ${from.y}, ${controlX2} ${to.y}, ${to.x} ${to.y}`

  return (
    <path
      d={path}
      stroke={color}
      strokeWidth="2"
      fill="none"
      opacity="0.6"
    />
  )
}

interface EditOutputNodeProps {
  output: EditOutput
  onMove: (id: string, x: number, y: number) => void
}

function EditOutputNode({ output }: EditOutputNodeProps) {
  const getToolColor = (tool: string) => {
    switch (tool) {
      case 'flux': return '#8b5cf6'
      case 'gemini': return '#f97316'
      case 'openai': return '#10b981'
      default: return '#6b7280'
    }
  }

  return (
    <div
      className="absolute cursor-move select-none"
      style={{ left: output.x, top: output.y }}
    >
      <div 
        className="bg-white rounded-lg shadow-lg border-2 p-4 w-64"
        style={{ borderColor: getToolColor(output.tool) }}
      >
        <div className="flex items-center justify-between mb-2">
          <div 
            className="px-2 py-1 rounded text-xs font-medium text-white capitalize flex items-center gap-1"
            style={{ backgroundColor: getToolColor(output.tool) }}
          >
            {output.tool === 'openai' ? (
              <img src="/openai.svg" alt="OpenAI" className="w-3 h-3 brightness-0 invert" />
            ) : output.tool === 'gemini' ? (
              <img src="/gemini.svg" alt="Gemini" className="w-3 h-3 brightness-0 invert" />
            ) : output.tool === 'flux' ? (
              <img src="/flux.svg" alt="Flux" className="w-3 h-3 brightness-0 invert" />
            ) : (
              output.tool
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              output.status === 'completed' ? 'bg-green-500' :
              output.status === 'processing' ? 'bg-yellow-500 animate-pulse' :
              output.status === 'failed' ? 'bg-red-500' : 'bg-gray-500'
            }`} />
            
            {/* Email Icon */}
            <button 
              className="text-gray-600 hover:text-gray-800 p-1 hover:bg-gray-50 rounded transition-colors"
              title="Attach to Email"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
            </button>
          </div>
        </div>

        <div 
          className="w-full aspect-square rounded flex items-center justify-center overflow-hidden mb-2 relative group"
          style={{
            backgroundImage: `repeating-conic-gradient(#f0f0f0 0% 25%, #ffffff 0% 50%)`,
            backgroundSize: '20px 20px'
          }}
        >
          {output.imageUrl ? (
            <>
              <img 
                src={output.imageUrl} 
                alt={`${output.tool} output`}
                className="max-w-full max-h-full object-contain"
                draggable={false}
              />
              
              {/* Tooltip Icon - always visible in top right corner */}
              <div className="absolute top-2 right-2 group/tooltip">
                <div className="bg-black/60 hover:bg-black/80 text-white rounded-full w-6 h-6 flex items-center justify-center cursor-help transition-colors">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M9,9h0a3,3,0,0,1,6,0c0,2-3,3-3,3"/>
                    <path d="M12,17h0"/>
                  </svg>
                </div>
                
                {/* Tooltip - appears on hover over icon */}
                <div className="absolute top-8 right-0 opacity-0 group-hover/tooltip:opacity-100 transition-opacity duration-200 pointer-events-none z-10">
                  <div className="bg-black/90 text-white text-xs px-3 py-2 rounded shadow-lg whitespace-nowrap max-w-[250px]">
                    <div className="font-medium capitalize">{output.tool} Output</div>
                    {output.prompt && (
                      <div className="text-gray-300 mt-1">
                        "{output.prompt.length > 50 ? output.prompt.substring(0, 50) + '...' : output.prompt}"
                      </div>
                    )}
                    <div className="text-gray-400 text-[10px] mt-1">
                      Generated: {output.timestamp.toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : output.status === 'processing' ? (
            <div className="text-gray-600 text-sm bg-white/80 px-2 py-1 rounded">Generating...</div>
          ) : null}
        </div>

        {/* Prompt Preview - Only show if there's an image */}
        {output.imageUrl && output.prompt && (
          <div className="text-xs text-gray-600 line-clamp-2 leading-relaxed mb-2">
            "{output.prompt}"
          </div>
        )}

        <div className="text-xs text-gray-400">
          {output.timestamp.toLocaleTimeString()}
        </div>
      </div>
    </div>
  )
}
