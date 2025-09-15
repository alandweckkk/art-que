'use client'

import { Handle, Position } from '@xyflow/react'
import { StickerEdit } from '@/types/sticker'
import { useState, useRef, useEffect } from 'react'
import { Plus, X } from 'lucide-react'

interface ImageNodeData {
  sticker: StickerEdit
  includeOriginalDesign: boolean
  setIncludeOriginalDesign: (value: boolean) => void
  includeInputImage: boolean
  setIncludeInputImage: (value: boolean) => void
  additionalImages: string[]
  setAdditionalImages: (images: string[]) => void
}

interface ImageNodeProps {
  data: ImageNodeData
}

export default function ImageNode({ data }: ImageNodeProps) {
  const { sticker, includeOriginalDesign, setIncludeOriginalDesign, includeInputImage, setIncludeInputImage, additionalImages, setAdditionalImages } = data
  
  // Local state for UI only
  const [isUploading, setIsUploading] = useState(false)
  const [selectedAdditionalImages, setSelectedAdditionalImages] = useState<Set<string>>(new Set(additionalImages))
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [pastedImage, setPastedImage] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sync selected additional images when additionalImages changes
  useEffect(() => {
    setSelectedAdditionalImages(new Set(additionalImages))
  }, [additionalImages])

  const handleImageUpload = async (file: File) => {
    if (additionalImages.length >= 8) return // Max 10 total (2 existing + 8 additional)
    
    try {
      setIsUploading(true)
      
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/upload-image', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`)
      }

      const result = await response.json()
      console.log('Upload result:', result)
      if (result.url) {
        console.log('Adding new image:', result.url)
        console.log('Current additionalImages:', additionalImages)
        const newImages = [...additionalImages, result.url]
        console.log('New additionalImages array:', newImages)
        
        setAdditionalImages(newImages)
        // Auto-select the newly uploaded image
        setSelectedAdditionalImages(prev => new Set([...prev, result.url]))
        // Close the modal
        setShowUploadModal(false)
        
        console.log('Image should now be visible')
      } else {
        throw new Error('No URL returned from upload')
      }
    } catch (error) {
      console.error('Image upload error:', error)
      alert(error instanceof Error ? error.message : 'Failed to upload image')
    } finally {
      setIsUploading(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    const imageFile = files.find(file => file.type.startsWith('image/'))
    if (imageFile) {
      handleImageUpload(imageFile)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith('image/')) {
      handleImageUpload(file)
    }
    // Reset the input
    e.target.value = ''
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    e.preventDefault()
    const items = e.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          setPastedImage(file)
          break
        }
      }
    }
  }

  const handleSavePastedImage = async () => {
    if (pastedImage) {
      await handleImageUpload(pastedImage)
      setPastedImage(null)
    }
  }

  const toggleAdditionalImageSelection = (imageUrl: string) => {
    setSelectedAdditionalImages(prev => {
      const newSet = new Set(prev)
      if (newSet.has(imageUrl)) {
        newSet.delete(imageUrl)
      } else {
        newSet.add(imageUrl)
      }
      return newSet
    })
  }

  const removeAdditionalImage = (index: number) => {
    const imageUrl = additionalImages[index]
    setAdditionalImages(additionalImages.filter((_, i) => i !== index))
    // Also remove from selection
    setSelectedAdditionalImages(prev => {
      const newSet = new Set(prev)
      newSet.delete(imageUrl)
      return newSet
    })
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-2 w-80">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 px-2">
        <div className="text-sm font-medium text-gray-800">Input Images</div>
        {additionalImages.length < 8 && (
          <button 
            className="text-gray-600 hover:text-gray-800 text-xs flex items-center gap-1 px-2 py-1 hover:bg-gray-50 rounded transition-colors"
            onClick={() => setShowUploadModal(true)}
            disabled={isUploading}
            title="Add image"
          >
            {isUploading ? (
              <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Plus className="w-3 h-3" />
            )}
            <span className="hidden sm:inline">Add</span>
          </button>
        )}
      </div>
      
      <div className="space-y-2">
        {/* Additional Input Images - Show at top */}
        {console.log('Rendering additionalImages:', additionalImages)}
        {additionalImages.map((imageUrl, index) => {
          const isSelected = selectedAdditionalImages.has(imageUrl)
          return (
            <div key={imageUrl} className="relative">
              <div 
                className={`w-full rounded-lg p-1 cursor-pointer transition-all ${
                  isSelected 
                    ? 'bg-blue-500 shadow-lg shadow-blue-500/30' 
                    : 'bg-gray-200 hover:bg-gray-300'
                }`}
                onClick={() => toggleAdditionalImageSelection(imageUrl)}
              >
                <div 
                  className="w-full aspect-square rounded flex items-center justify-center overflow-hidden"
                  style={{
                    backgroundImage: `repeating-conic-gradient(#f0f0f0 0% 25%, #ffffff 0% 50%)`,
                    backgroundSize: '20px 20px'
                  }}
                >
                  <img 
                    src={imageUrl} 
                    alt={`Additional input ${index + 1}`}
                    className="max-w-full max-h-full object-contain"
                    draggable={false}
                  />
                </div>
              </div>
              {isSelected && (
                <div className="absolute top-2 right-2 w-3 h-3 bg-blue-500 rounded-full shadow-lg"></div>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeAdditionalImage(index)
                }}
                className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                title="Remove image"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )
        })}

        {/* Original Design Image */}
        <div className="relative">
          <div 
            className={`w-full rounded-lg p-1 cursor-pointer transition-all ${
              includeOriginalDesign 
                ? 'bg-blue-500 shadow-lg shadow-blue-500/30' 
                : 'bg-gray-200 hover:bg-gray-300'
            }`}
            onClick={() => setIncludeOriginalDesign(!includeOriginalDesign)}
          >
            <div 
              className="w-full aspect-square rounded flex items-center justify-center overflow-hidden"
              style={{
                backgroundImage: `repeating-conic-gradient(#f0f0f0 0% 25%, #ffffff 0% 50%)`,
                backgroundSize: '20px 20px'
              }}
            >
              {sticker.preprocessed_output_image_url ? (
                <img 
                  src={sticker.preprocessed_output_image_url} 
                  alt="Original design"
                  className="max-w-full max-h-full object-contain"
                  draggable={false}
                />
              ) : (
                <div className="text-gray-600 text-sm bg-white/80 px-2 py-1 rounded">No image</div>
              )}
            </div>
          </div>
          {includeOriginalDesign && (
            <div className="absolute top-2 right-2 w-3 h-3 bg-blue-500 rounded-full shadow-lg"></div>
          )}
        </div>

        {/* Input Photo Image */}
        <div className="relative">
          <div 
            className={`w-full rounded-lg p-1 cursor-pointer transition-all ${
              includeInputImage 
                ? 'bg-blue-500 shadow-lg shadow-blue-500/30' 
                : 'bg-gray-200 hover:bg-gray-300'
            }`}
            onClick={() => setIncludeInputImage(!includeInputImage)}
          >
            <div 
              className="w-full aspect-square rounded flex items-center justify-center overflow-hidden"
              style={{
                backgroundImage: `repeating-conic-gradient(#f0f0f0 0% 25%, #ffffff 0% 50%)`,
                backgroundSize: '20px 20px'
              }}
            >
              {sticker.input_image_url ? (
                <img 
                  src={sticker.input_image_url} 
                  alt="Input photo"
                  className="max-w-full max-h-full object-contain"
                  draggable={false}
                />
              ) : (
                <div className="text-gray-600 text-sm bg-white/80 px-2 py-1 rounded">No image</div>
              )}
            </div>
          </div>
          {includeInputImage && (
            <div className="absolute top-2 right-2 w-3 h-3 bg-blue-500 rounded-full shadow-lg"></div>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
        disabled={isUploading}
      />

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowUploadModal(false)}>
          <div className="bg-white rounded-lg shadow-xl p-3 w-72" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-900">Add Image</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-2">
              {/* Drop/Click Area */}
              <div 
                className="border-2 border-dashed border-gray-300 rounded-lg p-4 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all text-center"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => fileInputRef.current?.click()}
              >
                {isUploading ? (
                  <div className="flex flex-col items-center">
                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-1" />
                    <span className="text-xs text-gray-600">Uploading...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <Plus className="w-5 h-5 text-gray-600 mb-1" />
                    <p className="text-xs text-gray-900">Drop or click to select</p>
                  </div>
                )}
              </div>

              {/* Paste Area */}
              <div className="text-center text-xs text-gray-500 py-1">or</div>
              <div 
                className="border-2 border-dashed border-gray-300 rounded-lg p-3 text-center focus:outline-none focus:border-blue-400 focus:bg-blue-50 transition-all"
                contentEditable={false}
                tabIndex={0}
                onPaste={handlePaste}
                onClick={(e) => e.currentTarget.focus()}
              >
                {pastedImage ? (
                  <div className="flex flex-col items-center">
                    <div className="text-xs text-green-600 mb-2">✓ Image pasted</div>
                    <button
                      onClick={handleSavePastedImage}
                      className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors"
                      disabled={isUploading}
                    >
                      Save Image
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="text-xs text-gray-600 mb-1">Click here & paste (Ctrl+V)</div>
                    <div className="text-xs text-gray-500">Paste image from clipboard</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  )
}
