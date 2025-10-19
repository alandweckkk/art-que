'use client'

import { useState, useRef } from 'react'
import { StickerEdit } from '@/types/sticker'

interface EditingWorkspaceProps {
  selectedSticker: StickerEdit
  onClose: () => void
}

interface EditNode {
  id: string
  type: 'flux' | 'gemini' | 'openai' | 'original'
  x: number
  y: number
  imageUrl: string
  prompt?: string
  status: 'idle' | 'processing' | 'completed' | 'failed'
  timestamp: Date
}

export default function EditingWorkspace({ selectedSticker, onClose }: EditingWorkspaceProps) {
  const [nodes, setNodes] = useState<EditNode[]>([
    {
      id: 'original',
      type: 'original',
      x: 100,
      y: 200,
      imageUrl: selectedSticker.preprocessed_output_image_url,
      status: 'completed',
      timestamp: new Date()
    }
  ])
  const [currentPrompt, setCurrentPrompt] = useState('')
  const [selectedTool, setSelectedTool] = useState<'flux' | 'gemini' | 'openai'>('flux')
  const [isGenerating, setIsGenerating] = useState(false)

  const handleGenerate = async () => {
    if (!currentPrompt.trim()) return
    
    setIsGenerating(true)
    
    // Create new node for the generation
    const newNode: EditNode = {
      id: `${selectedTool}-${Date.now()}`,
      type: selectedTool,
      x: 400 + (nodes.length - 1) * 250,
      y: 200 + Math.random() * 100 - 50,
      imageUrl: '', // Will be filled when generation completes
      prompt: currentPrompt,
      status: 'processing',
      timestamp: new Date()
    }
    
    setNodes(prev => [...prev, newNode])
    
    // TODO: Actual API call here
    setTimeout(() => {
      setNodes(prev => prev.map(node => 
        node.id === newNode.id 
          ? { ...node, status: 'completed' as const, imageUrl: selectedSticker.preprocessed_output_image_url }
          : node
      ))
      setIsGenerating(false)
    }, 3000)
  }

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-2xl w-full h-full max-w-7xl max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Editing: {selectedSticker.customer_name}
            </h2>
            <div className="text-sm text-gray-500">
              {selectedSticker.customer_email}
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-500 hover:text-gray-700 transition-colors"
          >
            ✕ Close
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          
          {/* Left Panel - Tools & Prompts */}
          <div className="w-80 border-r border-gray-200 p-4 flex flex-col gap-4 overflow-y-auto">
            
            {/* Original Feedback */}
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-sm font-medium text-gray-700 mb-2">Original Request</div>
              <div className="text-sm text-gray-600">
                {selectedSticker.feedback_notes}
              </div>
            </div>

            {/* Tool Selection */}
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="text-sm font-medium text-gray-700 mb-3">Choose Tool</div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setSelectedTool('flux')}
                  className={`px-3 py-2 text-sm rounded transition-colors ${
                    selectedTool === 'flux' 
                      ? 'bg-purple-500 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <img src="/flux.svg" alt="Flux" className="w-4 h-4" />
                  Flux
                </button>
                <button
                  onClick={() => setSelectedTool('gemini')}
                  className={`px-3 py-2 text-sm rounded transition-colors ${
                    selectedTool === 'gemini' 
                      ? 'bg-orange-500 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <img src="/gemini.svg" alt="Gemini" className="w-4 h-4" />
                  Gemini
                </button>
                <button
                  onClick={() => setSelectedTool('openai')}
                  className={`px-3 py-2 text-sm rounded transition-colors ${
                    selectedTool === 'openai' 
                      ? 'bg-green-500 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <img src="/openai.svg" alt="OpenAI" className="w-4 h-4" />
                  OpenAI
                </button>
              </div>
            </div>

            {/* Prompt Input */}
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="text-sm font-medium text-gray-700 mb-3">Edit Prompt</div>
              <textarea
                value={currentPrompt}
                onChange={(e) => setCurrentPrompt(e.target.value)}
                placeholder={`Enter your ${selectedTool} prompt here...`}
                className="w-full h-32 p-3 border border-gray-300 rounded resize-none text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !currentPrompt.trim()}
                className="w-full mt-3 px-4 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {isGenerating ? '⏳ Generating...' : `🚀 Generate with ${selectedTool}`}
              </button>
            </div>

            {/* Node History */}
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="text-sm font-medium text-gray-700 mb-3">Generation History</div>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {nodes.slice().reverse().map((node) => (
                  <div key={node.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded text-xs">
                    <div className={`w-2 h-2 rounded-full ${
                      node.status === 'completed' ? 'bg-green-500' :
                      node.status === 'processing' ? 'bg-yellow-500' :
                      node.status === 'failed' ? 'bg-red-500' : 'bg-gray-500'
                    }`} />
                    <div className="flex-1">
                      <div className="font-medium capitalize">{node.type}</div>
                      {node.prompt && (
                        <div className="text-gray-600 truncate">{node.prompt}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Right Panel - Canvas with Nodes */}
          <div className="flex-1 relative bg-gray-50 overflow-hidden">
            <div className="absolute inset-0" style={{
              backgroundImage: 'radial-gradient(circle at 20px 20px, #e5e7eb 1px, transparent 1px)',
              backgroundSize: '40px 40px'
            }}>
              
              {/* Render nodes */}
              {nodes.map((node) => (
                <EditNodeComponent
                  key={node.id}
                  node={node}
                  onMove={(id, x, y) => {
                    setNodes(prev => prev.map(n => 
                      n.id === id ? { ...n, x, y } : n
                    ))
                  }}
                />
              ))}

            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

interface EditNodeComponentProps {
  node: EditNode
  onMove: (id: string, x: number, y: number) => void
}

function EditNodeComponent({ node, onMove }: EditNodeComponentProps) {
  const [isDragging, setIsDragging] = useState(false)
  const nodeRef = useRef<HTMLDivElement>(null)

  const getNodeColor = (type: string) => {
    switch (type) {
      case 'flux': return '#8b5cf6'
      case 'gemini': return '#f97316'
      case 'openai': return '#10b981'
      default: return '#6b7280'
    }
  }

  return (
    <div
      ref={nodeRef}
      className="absolute cursor-move select-none"
      style={{
        left: node.x,
        top: node.y,
        transform: isDragging ? 'scale(1.05)' : 'scale(1)',
        transition: isDragging ? 'none' : 'transform 0.2s ease'
      }}
    >
      <div 
        className="bg-white rounded-lg shadow-lg border-2 p-3 w-48"
        style={{ borderColor: getNodeColor(node.type) }}
      >
        {/* Node Header */}
        <div className="flex items-center justify-between mb-2">
          <div 
            className="px-2 py-1 rounded text-xs font-medium text-white capitalize"
            style={{ backgroundColor: getNodeColor(node.type) }}
          >
            {node.type}
          </div>
          <div className={`w-2 h-2 rounded-full ${
            node.status === 'completed' ? 'bg-green-500' :
            node.status === 'processing' ? 'bg-yellow-500 animate-pulse' :
            node.status === 'failed' ? 'bg-red-500' : 'bg-gray-500'
          }`} />
        </div>

        {/* Image */}
        <div 
          className="w-full aspect-square rounded flex items-center justify-center overflow-hidden mb-2"
          style={{
            backgroundImage: `repeating-conic-gradient(#f0f0f0 0% 25%, #ffffff 0% 50%)`,
            backgroundSize: '20px 20px'
          }}
        >
          {node.imageUrl ? (
            <img 
              src={node.imageUrl} 
              alt={`${node.type} output`}
              className="max-w-full max-h-full object-contain"
              draggable={false}
            />
          ) : node.status === 'processing' ? (
            <div className="text-gray-600 text-sm bg-white/80 px-2 py-1 rounded">Generating...</div>
          ) : null}
        </div>

        {/* Prompt Preview */}
        {node.prompt && (
          <div className="text-xs text-gray-600 truncate">
            &quot;{node.prompt}&quot;
          </div>
        )}

        {/* Timestamp */}
        <div className="text-xs text-gray-400 mt-1">
          {node.timestamp.toLocaleTimeString()}
        </div>
      </div>
    </div>
  )
}
