'use client'

import { useState, useEffect } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Sparkles, Edit3 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

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
  const [enhancePrompt, setEnhancePrompt] = useState<string>('')
  const [isEditingEnhancePrompt, setIsEditingEnhancePrompt] = useState(false)
  const [enhancePromptId, setEnhancePromptId] = useState<number | null>(null)

  // Fetch enhance prompt template from database
  useEffect(() => {
    const fetchEnhancePrompt = async () => {
      try {
        const { data, error } = await supabase
          .from('y_sticker_templates')
          .select('id, prompt')
          .eq('name', 'Prompt Enhancer')
          .eq('visible', true)
          .single()

        if (error) throw error
        
        if (data) {
          setEnhancePrompt(data.prompt)
          setEnhancePromptId(data.id)
        }
      } catch (error) {
        console.error('Error fetching enhance prompt:', error)
        // Fallback to hardcoded prompt
        setEnhancePrompt('You are a prompt enhancement expert. Take the user\'s image generation prompt and enhance it to be more detailed, vivid, and effective for AI image generation. Keep the core intent but add relevant details about style, composition, lighting, colors, and mood. Return ONLY the enhanced prompt without any explanation or additional text.')
      }
    }

    fetchEnhancePrompt()
  }, [])

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
          instructions: enhancePrompt
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

  const handleSaveEnhancePrompt = async () => {
    if (!enhancePromptId) return

    try {
      const { error } = await supabase
        .from('y_sticker_templates')
        .update({ prompt: enhancePrompt })
        .eq('id', enhancePromptId)

      if (error) throw error
      
      setIsEditingEnhancePrompt(false)
    } catch (error) {
      console.error('Error saving enhance prompt:', error)
      setEnhanceError('Failed to save enhance prompt')
      setTimeout(() => setEnhanceError(null), 3000)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 w-80">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-gray-800">Edit Prompt</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEditingEnhancePrompt(!isEditingEnhancePrompt)}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
            title="Edit enhance prompt"
          >
            <Edit3 size={12} />
          </button>
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
      </div>
      
      <div className="space-y-3 nodrag">
        <textarea
          value={globalPrompt}
          onChange={(e) => setGlobalPrompt(e.target.value)}
          placeholder="Enter prompt for image generation..."
          className="w-full p-3 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white nodrag nowheel"
          rows={12}
        />
        
        {/* Enhance Prompt Editor */}
        {isEditingEnhancePrompt && (
          <div className="border-t pt-3 mt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-700">Enhance Prompt Template</label>
              <button
                onClick={handleSaveEnhancePrompt}
                className="px-2 py-1 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded transition-colors"
              >
                Save
              </button>
            </div>
            <textarea
              value={enhancePrompt}
              onChange={(e) => setEnhancePrompt(e.target.value)}
              placeholder="Enter the prompt template for enhancement..."
              className="w-full p-2 border border-gray-300 rounded text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent bg-white nodrag nowheel"
              rows={4}
            />
          </div>
        )}
        
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
