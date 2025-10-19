'use client'

import { Handle, Position } from '@xyflow/react'
import { useRef } from 'react'

interface PromptNodeData {
  globalPrompt: string
  setGlobalPrompt: (value: string) => void
}

interface PromptNodeProps {
  data: PromptNodeData
}

export default function PromptNode({ data }: PromptNodeProps) {
  const { globalPrompt, setGlobalPrompt } = data

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Calculate dynamic height based on content
  const calculateHeight = (text: string) => {
    const lines = text.split('\n').length
    const minLines = Math.max(lines + 1, 5) // At least 5 lines, plus 1 extra line
    return `${minLines * 1.5}rem` // Approximate line height
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 w-80">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-gray-800">Edit Prompt</div>
      </div>
      
      <div className="space-y-3">
        <textarea
          ref={textareaRef}
          value={globalPrompt}
          onChange={(e) => setGlobalPrompt(e.target.value)}
          placeholder="Enter prompt for image generation..."
          className="w-full p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
          style={{ height: calculateHeight(globalPrompt) }}
        />
      </div>
      
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
