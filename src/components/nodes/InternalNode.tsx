'use client'

import { useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { supabase } from '@/lib/supabase'

interface InternalNodeData {
  internalNotes: string
  setInternalNotes: (value: string) => void
  sticker: { model_run_id: string; sticker_edit_id: string } // We'll need the sticker data to save to Supabase
}

interface InternalNodeProps {
  data: InternalNodeData
}

export default function InternalNode({ data }: InternalNodeProps) {
  const { internalNotes, setInternalNotes, sticker } = data
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [tempNotes, setTempNotes] = useState(internalNotes)
  const [isSaving, setIsSaving] = useState(false)

  // Calculate dynamic height based on content
  const calculateHeight = (text: string) => {
    const lines = text.split('\n').length
    const minLines = Math.max(lines + 1, 5) // At least 5 lines, plus 1 extra line
    return `${minLines * 1.5}rem` // Approximate line height
  }

  // Save internal notes to Supabase
  const saveNotes = async () => {
    if (!sticker?.sticker_edit_id || !tempNotes.trim()) return

    setIsSaving(true)
    try {
      const { error } = await supabase
        .from('y_sticker_edits')
        .update({ internal_note: tempNotes.trim() })
        .eq('id', sticker.sticker_edit_id)

      if (error) {
        console.error('Error saving internal notes:', error)
        alert('Error saving notes: ' + error.message)
        return
      }

      // Update local state
      setInternalNotes(tempNotes.trim())
      setIsEditing(false)
    } catch (error) {
      console.error('Error saving internal notes:', error)
      alert('Error saving notes')
    } finally {
      setIsSaving(false)
    }
  }

  // Handle add note button click
  const handleAddNote = () => {
    setTempNotes(internalNotes)
    setIsEditing(true)
  }

  // Handle cancel
  const handleCancel = () => {
    setTempNotes(internalNotes)
    setIsEditing(false)
  }

  return (
    <div className="rounded-xl shadow-sm border p-3 w-80 transition-all bg-gray-50 border-gray-300">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        {!internalNotes && !isEditing ? (
          <button
            onClick={handleAddNote}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
          >
            Add Note
          </button>
        ) : (
          <div className="text-sm font-medium text-gray-800">Internal Notes</div>
        )}
        <div className="w-3 h-3 bg-gray-400 rounded-full" />
      </div>
      
      {/* Content */}
      {(internalNotes || isEditing) && (
        <div className="space-y-3">
          <textarea
            ref={textareaRef}
            value={isEditing ? tempNotes : internalNotes}
            onChange={(e) => isEditing ? setTempNotes(e.target.value) : setInternalNotes(e.target.value)}
            placeholder="Add internal notes for this sticker edit..."
            className="w-full p-3 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent bg-white"
            style={{ height: calculateHeight(isEditing ? tempNotes : internalNotes) }}
            readOnly={!isEditing && !!internalNotes}
          />
          
          {/* Save/Cancel buttons when editing */}
          {isEditing && (
            <div className="flex gap-2">
              <button
                onClick={saveNotes}
                disabled={isSaving || !tempNotes.trim()}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleCancel}
                disabled={isSaving}
                className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      <Handle type="target" position={Position.Left} />
    </div>
  )
}
