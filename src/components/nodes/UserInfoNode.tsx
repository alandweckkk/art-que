'use client'

import { Handle, Position } from '@xyflow/react'
import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface UserInfoNodeData {
  sticker: { customer_email: string; model_run_id: string; amount_spent: number; bucket: string; days_since_created: number; edit_created_at?: string; purchased_at?: string } // We'll type this properly based on your StickerEdit type
}

export default function UserInfoNode({ data }: { data: UserInfoNodeData }) {
  const { sticker } = data
  const [isExpanded, setIsExpanded] = useState(false)
  const [modelRuns, setModelRuns] = useState<unknown[]>([])
  const [loading, setLoading] = useState(false)

  // Extract user info for chips
  const userInfo = [
    { value: `$${Number(sticker.amount_spent).toFixed(2)}` },
    { value: `${sticker.days_since_created}d` },
    { value: `${modelRuns.length} runs` }
  ]

  // Function to fetch all model runs for this user
  const fetchModelRuns = async () => {
    if (!sticker.model_run_id) return
    
    setLoading(true)
    try {
      // First, get the user_id from the current model_run
      const { data: currentModelRun, error: currentError } = await supabase
        .from('model_run')
        .select('user_id')
        .eq('id', sticker.model_run_id)
        .single()

      if (currentError) {
        console.error('Error fetching current model run:', currentError)
        return
      }

      if (!currentModelRun?.user_id) {
        console.error('No user_id found for model run:', sticker.model_run_id)
        return
      }

      // Now fetch all model runs for this user
      const { data: allModelRuns, error: allError } = await supabase
        .from('model_run')
        .select('*')
        .eq('user_id', currentModelRun.user_id)
        .order('created_at', { ascending: false })

      if (allError) {
        console.error('Error fetching all model runs:', allError)
        return
      }

      setModelRuns(allModelRuns || [])
    } catch (error) {
      console.error('Error in fetchModelRuns:', error)
    } finally {
      setLoading(false)
    }
  }

  // Fetch model runs when component mounts or when sticker changes
  useEffect(() => {
    // Reset model runs and collapse node when sticker changes
    setModelRuns([])
    setIsExpanded(false) // Close the node when switching records
    fetchModelRuns()
  }, [sticker.model_run_id]) // Re-run when the model_run_id changes

  // Also fetch when expanded if not already loaded
  useEffect(() => {
    if (isExpanded && modelRuns.length === 0) {
      fetchModelRuns()
    }
  }, [isExpanded, modelRuns.length])

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  // Format detailed relative time for artwork request
  const getDetailedRelativeTime = (createdAt: string) => {
    const now = new Date()
    const created = new Date(createdAt)
    const diffMs = now.getTime() - created.getTime()
    
    const totalMinutes = Math.floor(diffMs / (1000 * 60))
    const totalHours = Math.floor(diffMs / (1000 * 60 * 60))
    const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    
    const days = totalDays
    const hours = totalHours - (days * 24)
    const minutes = totalMinutes - (totalHours * 60)
    
    const parts = []
    
    if (days > 0) {
      parts.push(`${days}d`)
    }
    if (hours > 0) {
      parts.push(`${hours}h`)
    }
    if (minutes > 0) {
      parts.push(`${minutes}m`)
    }
    
    if (parts.length === 0) {
      return 'Just now'
    }
    
    return parts.join(' ')
  }

  // Calculate dynamic height based on number of model runs
  const getNodeHeight = () => {
    if (!isExpanded) return { minHeight: 'auto', maxHeight: 'none' }
    
    const baseHeight = 240 // Base height for header and chips
    const runHeight = 140 // Height per model run (including padding)
    const maxRuns = 4 // Maximum runs to show before scrolling
    
    const totalRuns = modelRuns.length
    const visibleRuns = Math.min(totalRuns, maxRuns)
    const calculatedHeight = baseHeight + (visibleRuns * runHeight)
    
    return {
      minHeight: `${calculatedHeight}px`,
      maxHeight: '800px'
    }
  }

  const nodeStyle = getNodeHeight()

  return (
    <div 
      className="rounded-xl shadow-sm border p-4 w-80 bg-white border-gray-200 transition-all"
      style={nodeStyle}
    >
      <Handle type="target" position={Position.Top} />
      
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-900">
            {getDetailedRelativeTime(sticker.edit_created_at || sticker.purchased_at || new Date().toISOString())}
          </h3>
          {/* User Info Chips */}
          {userInfo.map((info, index) => (
            <div
              key={index}
              className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
            >
              <span className="font-semibold">{info.value}</span>
            </div>
          ))}
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center px-2 py-1.5 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-md transition-colors"
        >
          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-200 pt-4">
          <h4 className="text-sm font-medium text-gray-900 mb-3">
            Model Runs History {modelRuns.length > 0 && `(${modelRuns.length})`}
          </h4>
          
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-sm text-gray-500">Loading model runs...</div>
            </div>
          ) : modelRuns.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-sm text-gray-500">No model runs found</div>
            </div>
          ) : (
            <div className="space-y-4 max-h-[560px] overflow-y-auto">
              {modelRuns.map((run, index) => {
                const typedRun = run as { id: string; input_image_url?: string; output_image_url?: string; created_at: string }
                return (
                <div key={typedRun.id} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-900">
                    Run #{index + 1}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatDate(typedRun.created_at)}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  {/* Input Image */}
                  <div>
                    {typedRun.input_image_url ? (
                      <div className="w-full h-24 bg-gray-50 rounded border border-gray-200 flex items-center justify-center p-1">
                        <img
                          src={typedRun.input_image_url}
                          alt="Input"
                          className="max-w-full max-h-full object-contain rounded"
                        />
                      </div>
                    ) : (
                      <div className="w-full h-24 bg-gray-100 rounded border border-gray-200 flex items-center justify-center">
                        <span className="text-xs text-gray-500">No image</span>
                      </div>
                    )}
                  </div>

                  {/* Preprocessed Output Image */}
                  <div>
                    {typedRun.output_image_url ? (
                      <div className="w-full h-24 bg-gray-50 rounded border border-gray-200 flex items-center justify-center p-1">
                        <img
                          src={typedRun.output_image_url}
                          alt="Output"
                          className="max-w-full max-h-full object-contain rounded"
                        />
                      </div>
                    ) : (
                      <div className="w-full h-24 bg-gray-100 rounded border border-gray-200 flex items-center justify-center">
                        <span className="text-xs text-gray-500">No image</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Divider between runs */}
                {index < modelRuns.length - 1 && (
                  <div className="border-b border-gray-100 mt-3"></div>
                )}
              </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
