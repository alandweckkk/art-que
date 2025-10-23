'use client'

import { Handle, Position } from '@xyflow/react'

interface PromptNodeDuplicateData {
  globalPrompt: string
  setGlobalPrompt: (value: string) => void
}

interface PromptNodeDuplicateProps {
  data: PromptNodeDuplicateData
}

export default function PromptNodeDuplicate({ data }: PromptNodeDuplicateProps) {
  const { globalPrompt, setGlobalPrompt } = data

  return (
    <div className="rounded-xl shadow-sm border p-3 w-80 transition-all bg-white border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-gray-800">Edit Prompt</div>
      </div>
      
      {/* Content - Always visible and editable */}
      <div className="space-y-3">
        <textarea
          value={globalPrompt}
          onChange={(e) => setGlobalPrompt(e.target.value)}
          onKeyDown={(e) => {
            // Stop event propagation to prevent ReactFlow from capturing keyboard events
            e.stopPropagation()
          }}
          placeholder="Enter prompt for image generation..."
          className="w-full p-3 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white nodrag nowheel"
          rows={12}
        />
      </div>
      
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

