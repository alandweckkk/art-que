'use client'

import { Handle, Position } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

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
  
  const setText = (newText: string) => {
    console.log('✏️ TextPromptNode - User typed:', newText.substring(0, 50))
    setTextLocal(newText)
    if (data.setText) {
      console.log('📤 TextPromptNode - Updating parent textPrompt state')
      data.setText(newText)
    }
  }

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
        <div className="text-sm font-medium text-gray-700 mb-2">Prompt</div>
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
        <div className="text-sm font-medium text-gray-700 mb-2">Prompt</div>
        <div className="w-full p-2 border border-red-300 rounded text-sm bg-red-50 resize-none" style={{ minHeight: '6rem' }}>
          <span className="text-red-600">{error}</span>
        </div>
        <Handle type="source" position={Position.Right} />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 w-80">
      <div className="text-sm font-medium text-gray-700 mb-2">Prompt</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Enter text..."
        className="w-full p-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none nodrag"
        rows={4}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

