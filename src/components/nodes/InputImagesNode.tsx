'use client'

import { Handle, Position } from '@xyflow/react'
import { StickerEdit } from '@/types/sticker'
import { useState } from 'react'
import { X } from 'lucide-react'

interface InputImagesNodeData {
  sticker: StickerEdit
  includeOriginalDesign: boolean
  setIncludeOriginalDesign: (value: boolean) => void
  includeInputImage: boolean
  setIncludeInputImage: (value: boolean) => void
  additionalImages: string[]
  setAdditionalImages: (images: string[]) => void
}

interface InputImagesNodeProps {
  data: InputImagesNodeData
}

export default function InputImagesNode({ data }: InputImagesNodeProps) {
  const { sticker, additionalImages, setAdditionalImages } = data
  
  const [isUploading, setIsUploading] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)

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
      if (result.url) {
        setAdditionalImages([...additionalImages, result.url])
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
    setIsDraggingOver(false)
    const files = Array.from(e.dataTransfer.files)
    const imageFile = files.find(file => file.type.startsWith('image/'))
    if (imageFile) {
      handleImageUpload(imageFile)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOver(false)
  }

  const removeAdditionalImage = (index: number) => {
    setAdditionalImages(additionalImages.filter((_, i) => i !== index))
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-2 w-80">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 px-2">
        <div className="text-sm font-medium text-gray-800">Input Images</div>
      </div>
      
      <div className="space-y-2">
        {/* preprocessed_output_image_url */}
        {sticker.preprocessed_output_image_url && (
          <div key="preprocessed_output_image_url" className="relative">
            <div className="w-full rounded-lg bg-gray-50">
              <div 
                className="w-full aspect-square rounded flex items-center justify-center overflow-hidden p-1"
                style={{
                  backgroundImage: `repeating-conic-gradient(#f0f0f0 0% 25%, #ffffff 0% 50%)`,
                  backgroundSize: '20px 20px'
                }}
              >
                <img 
                  src={sticker.preprocessed_output_image_url} 
                  alt="preprocessed_output_image_url"
                  className="max-w-full max-h-full object-contain"
                  draggable={false}
                />
              </div>
            </div>
          </div>
        )}

        {/* input_image_url */}
        {sticker.input_image_url && (
          <div key="input_image_url" className="relative">
            <div className="w-full rounded-lg bg-gray-50">
              <div 
                className="w-full aspect-square rounded flex items-center justify-center overflow-hidden p-1"
                style={{
                  backgroundImage: `repeating-conic-gradient(#f0f0f0 0% 25%, #ffffff 0% 50%)`,
                  backgroundSize: '20px 20px'
                }}
              >
                <img 
                  src={sticker.input_image_url} 
                  alt="input_image_url"
                  className="max-w-full max-h-full object-contain"
                  draggable={false}
                />
              </div>
            </div>
          </div>
        )}

        {/* Additional images */}
        {additionalImages.map((imageUrl, index) => (
          <div key={`additional-${index}`} className="relative">
            <div className="w-full rounded-lg bg-gray-50">
              <div 
                className="w-full aspect-square rounded flex items-center justify-center overflow-hidden p-1"
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
            {/* Remove button */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                removeAdditionalImage(index)
              }}
              className="absolute top-1 right-1 w-4 h-4 bg-gray-400 text-white rounded-full flex items-center justify-center hover:bg-gray-500 transition-colors"
              title="Remove image"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        ))}

        {/* Drop Zone - only show if under max limit */}
        {additionalImages.length < 8 && (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`w-full rounded-lg border-2 border-dashed transition-all ${
              isDraggingOver
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-300 bg-gray-50 hover:border-gray-400'
            } ${isUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div className="w-full aspect-square rounded flex flex-col items-center justify-center p-4 text-center">
              {isUploading ? (
                <>
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2" />
                  <span className="text-xs text-gray-600">Uploading...</span>
                </>
              ) : (
                <>
                  <svg
                    className="w-8 h-8 text-gray-400 mb-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <span className="text-xs text-gray-600 font-medium">Drop image here</span>
                  <span className="text-xs text-gray-400 mt-1">to add to inputs</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  )
}
