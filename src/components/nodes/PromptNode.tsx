'use client'

import { useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Sparkles } from 'lucide-react'

interface PromptNodeData {
  globalPrompt: string
  setGlobalPrompt: (value: string) => void
}

interface PromptNodeProps {
  data: PromptNodeData
}

export default function PromptNode({ data }: PromptNodeProps) {
  const { globalPrompt, setGlobalPrompt } = data
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [enhanceError, setEnhanceError] = useState<string | null>(null)

  const handleEnhancePrompt = async () => {
    if (!globalPrompt.trim()) {
      setEnhanceError('Please enter a prompt first')
      setTimeout(() => setEnhanceError(null), 3000)
      return
    }

    setIsEnhancing(true)
    setEnhanceError(null)

    try {
      const response = await fetch('/api/gpt-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: globalPrompt,
          instructions: 'You are a prompt enhancement expert. Take the user\'s image generation prompt and enhance it to be more detailed, vivid, and effective for AI image generation. Keep the core intent but add relevant details about style, composition, lighting, colors, and mood. Return ONLY the enhanced prompt without any explanation or additional text.'
        })
      })

      if (!response.ok) {
        throw new Error('Failed to enhance prompt')
      }

      const data = await response.json()
      
      if (data.success && data.response) {
        setGlobalPrompt(data.response.trim())
      } else {
        throw new Error('Invalid response from enhancement API')
      }
    } catch (error) {
      console.error('Error enhancing prompt:', error)
      setEnhanceError('Failed to enhance prompt')
      setTimeout(() => setEnhanceError(null), 3000)
    } finally {
      setIsEnhancing(false)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 w-80">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-gray-800">Edit Prompt</div>
        <button
          onClick={handleEnhancePrompt}
          disabled={isEnhancing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-lg transition-colors"
          title="Enhance prompt with AI"
        >
          <Sparkles size={14} />
          {isEnhancing ? 'Enhancing...' : 'Enhance'}
        </button>
      </div>
      
      <div className="space-y-3 nodrag">
        <textarea
          value={globalPrompt}
          onChange={(e) => setGlobalPrompt(e.target.value)}
          placeholder="Enter prompt for image generation..."
          className="w-full p-3 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white nodrag nowheel"
          rows={6}
        />
        
        {enhanceError && (
          <div className="text-xs text-red-600 px-2 py-1 bg-red-50 rounded">
            {enhanceError}
          </div>
        )}
      </div>
      
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
