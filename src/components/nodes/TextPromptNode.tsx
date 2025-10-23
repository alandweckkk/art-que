'use client'

import { Handle, Position } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Sparkles, Edit3 } from 'lucide-react'

interface TextPromptNodeData {
  setText?: (text: string) => void
}

interface TextPromptNodeProps {
  data: TextPromptNodeData
}

export default function TextPromptNode({ data }: TextPromptNodeProps) {
  const searchParams = useSearchParams()
  const id = searchParams.get('id')
  
  const [text, setTextLocal] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [enhanceError, setEnhanceError] = useState<string | null>(null)
  const [enhancePrompt, setEnhancePrompt] = useState<string>('')
  const [isEditingEnhancePrompt, setIsEditingEnhancePrompt] = useState(false)
  const [enhancePromptId, setEnhancePromptId] = useState<number | null>(null)
  
  const setText = (newText: string) => {
    console.log('✏️ TextPromptNode - User typed:', newText.substring(0, 50))
    setTextLocal(newText)
    if (data.setText) {
      console.log('📤 TextPromptNode - Updating parent textPrompt state')
      data.setText(newText)
    }
  }

  const handleEnhancePrompt = async () => {
    if (!text.trim()) {
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
          text: text,
          instructions: enhancePrompt
        })
      })

      if (!response.ok) {
        throw new Error('Failed to enhance prompt')
      }

      const responseData = await response.json()
      
      if (responseData.success && responseData.response) {
        const enhancedText = responseData.response.trim()
        setTextLocal(enhancedText)
        if (data.setText) {
          data.setText(enhancedText)
        }
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

  useEffect(() => {
    const fetchFeedbackNotes = async () => {
      if (!id) {
        setError('No id in URL')
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)
        const { data: modelRun, error: fetchError } = await supabase
          .from('model_run')
          .select('feedback_notes')
          .eq('id', id)
          .single()

        if (fetchError) throw fetchError

        const feedbackText = modelRun?.feedback_notes || ''
        console.log('📝 TextPromptNode - Loaded feedback_notes from model_run:', feedbackText.substring(0, 100))
        setTextLocal(feedbackText)
        if (data.setText) {
          console.log('📤 TextPromptNode - Sending to parent (textPrompt state)')
          data.setText(feedbackText)
        }
        setError(null)
      } catch (err) {
        console.error('Error fetching feedback notes:', err)
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setIsLoading(false)
      }
    }

    fetchFeedbackNotes()
  }, [id, data.setText])

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 w-80">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-gray-700">Prompt</div>
        </div>
        <div className="w-full p-2 border border-gray-300 rounded text-sm bg-gray-50 resize-none flex items-center justify-center" style={{ minHeight: '6rem' }}>
          <span className="text-gray-500">Loading...</span>
        </div>
        <Handle type="source" position={Position.Right} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 w-80">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-gray-700">Prompt</div>
        </div>
        <div className="w-full p-2 border border-red-300 rounded text-sm bg-red-50 resize-none" style={{ minHeight: '6rem' }}>
          <span className="text-red-600">{error}</span>
        </div>
        <Handle type="source" position={Position.Right} />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 w-80">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-gray-700">Prompt</div>
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
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Enter text..."
        className="w-full p-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none nodrag"
        rows={10}
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
        <div className="text-xs text-red-600 px-2 py-1 bg-red-50 rounded mt-2">
          {enhanceError}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

