'use client'

import { Handle, Position } from '@xyflow/react'
import { useEffect, useRef } from 'react'

interface PromptNodeData {
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
  fluxMaxPrompt: string
  setFluxMaxPrompt: (value: string) => void
}

interface PromptNodeProps {
  data: PromptNodeData
}

export default function PromptNode({ data }: PromptNodeProps) {
  const {
    globalPrompt, setGlobalPrompt, useGlobalPrompt, setUseGlobalPrompt,
    fluxPrompt, setFluxPrompt, geminiPrompt, setGeminiPrompt, openaiPrompt, setOpenaiPrompt,
    fluxMaxPrompt, setFluxMaxPrompt
  } = data

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Calculate dynamic height based on content
  const calculateHeight = (text: string) => {
    const lines = text.split('\n').length
    const minLines = Math.max(lines + 1, 5) // At least 5 lines, plus 1 extra line
    return `${minLines * 1.5}rem` // Approximate line height
  }

  return (
    <div className={`rounded-xl shadow-sm border p-3 w-80 transition-all ${
      useGlobalPrompt 
        ? 'bg-white border-gray-200' 
        : 'bg-gray-100 border-gray-300 opacity-75'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-gray-800">Edit Prompt</div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="useGlobalPrompt"
            checked={useGlobalPrompt}
            onChange={(e) => setUseGlobalPrompt(e.target.checked)}
            className="w-3 h-3 text-blue-600 bg-white border-gray-300 rounded focus:ring-blue-500 focus:ring-1"
          />
          <label htmlFor="useGlobalPrompt" className="text-xs text-gray-600 cursor-pointer">
            Use for all tools
          </label>
        </div>
      </div>
      
      <div className="space-y-3">

        <textarea
          ref={textareaRef}
          value={globalPrompt}
          onChange={(e) => setGlobalPrompt(e.target.value)}
          placeholder="Enter prompt for all AI tools..."
          className={`w-full p-3 border rounded-lg text-sm resize-none focus:outline-none transition-all ${
            useGlobalPrompt 
              ? 'border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white' 
              : 'border-gray-300 bg-gray-100 text-gray-500 cursor-not-allowed'
          }`}
          style={{ height: calculateHeight(globalPrompt) }}
          disabled={!useGlobalPrompt}
        />
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  )
}
