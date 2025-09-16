'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Flower2 } from 'lucide-react'

interface OutputNodeData {
  title: string
  tool: 'flux' | 'gemini' | 'openai' | 'flux_max'
  output?: {
    status: 'idle' | 'processing' | 'completed' | 'failed'
    imageUrl?: string
    prompt?: string
    timestamp?: Date
    inputImages?: string[] // Array of input image URLs that were sent to the model
  }
  onGenerate: () => void
  onAttachToEmail?: (imageUrl: string) => void
  onClear?: () => void
  useGlobalPrompt?: boolean
  individualPrompt?: string
  onPromptChange?: (value: string) => void
}

interface OutputNodeProps {
  data: OutputNodeData
}

export default function OutputNode({ data }: OutputNodeProps) {
  const { title, tool, output, onGenerate, onAttachToEmail, onClear, useGlobalPrompt, individualPrompt, onPromptChange } = data
  const [brightness, setBrightness] = useState(111)
  const [saturation, setSaturation] = useState(70)
  const [showBrightnessControl, setShowBrightnessControl] = useState(false)
  const [showPromptTooltip, setShowPromptTooltip] = useState(false)
  const brightnessRef = useRef<HTMLDivElement>(null)

  // Handle click outside to close brightness control
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (brightnessRef.current && !brightnessRef.current.contains(event.target as Node)) {
        setShowBrightnessControl(false)
      }
    }

    if (showBrightnessControl) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showBrightnessControl])

  const getToolColor = (tool: string) => {
    switch (tool) {
      case 'flux': return '#8b5cf6'
      case 'flux_max': return '#6d28d9'
      case 'gemini': return '#f97316'
      case 'openai': return '#10b981'
      default: return '#6b7280'
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 w-80">
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {tool === 'openai' ? (
            <img src="/openai.svg" alt="OpenAI" className="w-5 h-5" />
          ) : tool === 'gemini' ? (
            <img src="/gemini.svg" alt="Gemini" className="w-5 h-5" />
          ) : tool === 'flux' ? (
            <img src="/flux.svg" alt="Flux" className="w-5 h-5" />
          ) : tool === 'flux_max' ? (
            <img src="/flux.svg" alt="Flux Max" className="w-5 h-5" />
          ) : (
            <div className="text-sm font-medium text-gray-800">{title}</div>
          )}
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${
              output?.status === 'completed' ? 'bg-green-500' :
              output?.status === 'processing' ? 'bg-yellow-500 animate-pulse' :
              output?.status === 'failed' ? 'bg-red-500' : 'bg-gray-300'
            }`} />
            {/* Tooltip icon - only show when image is generated */}
            {output?.status === 'completed' && output?.prompt && (
              <button
                onClick={() => setShowPromptTooltip(!showPromptTooltip)}
                className="w-3 h-3 rounded-full bg-gray-400 hover:bg-gray-500 flex items-center justify-center transition-colors"
                title="Show original prompt"
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M9,9h0a3,3,0,0,1,5.12-2.12A3,3,0,0,1,15.71,9.5"/>
                  <path d="M12,17h0"/>
                </svg>
              </button>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Brightness Control - Only for OpenAI */}
          {tool === 'openai' && (
            <div className="relative" ref={brightnessRef}>
              <button 
                className="text-gray-600 hover:text-gray-800 p-1 hover:bg-gray-50 rounded transition-colors"
                onClick={() => setShowBrightnessControl(!showBrightnessControl)}
                title="Adjust Brightness"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="5"/>
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                </svg>
              </button>
              
              {/* Brightness Dropdown */}
              {showBrightnessControl && (
                <div 
                  className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-[160px] z-20 nodrag"
                >
                  {/* Saturation Control */}
                  <div className="mb-3">
                    <div className="text-xs text-gray-600 mb-2">Saturation</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">0%</span>
                      <input
                        type="range"
                        min="0"
                        max="200"
                        value={saturation}
                        onChange={(e) => setSaturation(Number(e.target.value))}
                        className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider nodrag"
                        style={{
                          background: `linear-gradient(to right, #e5e7eb 0%, #3b82f6 ${saturation/2}%, #e5e7eb ${saturation/2}%)`
                        }}
                      />
                      <span className="text-xs text-gray-500">200%</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1 text-center">{saturation}%</div>
                  </div>
                  
                  {/* Brightness Control */}
                  <div>
                    <div className="text-xs text-gray-600 mb-2">Brightness</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">0%</span>
                      <input
                        type="range"
                        min="0"
                        max="200"
                        value={brightness}
                        onChange={(e) => setBrightness(Number(e.target.value))}
                        className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider nodrag"
                        style={{
                          background: `linear-gradient(to right, #e5e7eb 0%, #3b82f6 ${brightness/2}%, #e5e7eb ${brightness/2}%)`
                        }}
                      />
                      <span className="text-xs text-gray-500">200%</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1 text-center">{brightness}%</div>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Email Icon */}
          <button 
            className="text-gray-600 hover:text-gray-800 p-1 hover:bg-gray-50 rounded transition-colors"
            onClick={() => {
              if (output?.imageUrl && onAttachToEmail) {
                onAttachToEmail(output.imageUrl)
              }
            }}
            disabled={!output?.imageUrl}
            title="Attach to Email"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
            </svg>
          </button>
          
        </div>
      </div>

      {/* Prompt Display - Show when tooltip is clicked */}
      {showPromptTooltip && output?.prompt && (
        <div className="mb-3 p-2 bg-gray-50 rounded border">
          <div className="text-xs text-gray-800 leading-relaxed mb-2">
            {output.prompt}
          </div>
          
          {/* Input Images Thumbnails */}
          {output.inputImages && output.inputImages.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {output.inputImages.map((imageUrl, index) => (
                <div 
                  key={index}
                  className="w-[60px] h-[60px] rounded border border-gray-300 overflow-hidden bg-white"
                >
                  <img 
                    src={imageUrl} 
                    alt={`Input image ${index + 1}`}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Image Container */}
      <div className="w-full p-1 mb-0">
        <div 
          className={`w-full rounded flex items-center justify-center overflow-hidden relative group ${
            output?.imageUrl ? 'aspect-square' : 'h-[50px]'
          }`}
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
                style={{
                  filter: tool === 'openai' ? `saturate(${saturation}%) brightness(${brightness}%)` : undefined
                }}
              />
              
              {/* Bloom Button - always visible in top right corner */}
              <button
                onClick={onClear}
                className="absolute top-2 right-2 bg-white/90 hover:bg-white text-pink-500 hover:text-pink-600 rounded-full w-6 h-6 flex items-center justify-center transition-colors shadow-sm border border-gray-200"
                title="Clear image and reset"
                disabled={!onClear}
              >
                <Flower2 size={12} />
              </button>
            </>
          ) : output?.status === 'processing' ? (
            <div className="text-gray-600 text-sm bg-white/80 px-2 py-1 rounded">Generating...</div>
          ) : (
            <button
              onClick={onGenerate}
              className="text-blue-600 hover:text-blue-800 text-sm bg-white/80 hover:bg-blue-50 px-2 py-1 rounded transition-colors cursor-pointer"
            >
              Ready to Generate
            </button>
          )}
        </div>
      </div>

      {/* Individual Prompt Text Area - Only show when not using global prompt */}
      {!useGlobalPrompt && onPromptChange && (
        <div className="mb-3">
          <textarea
            value={individualPrompt || ''}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder={`${title} prompt...`}
            className="w-full h-12 p-2 border border-gray-300 rounded text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
            style={{ fontSize: '10px', lineHeight: '1.2' }}
          />
        </div>
      )}

    </div>
  )
}
