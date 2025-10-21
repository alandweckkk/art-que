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
  selectedImages: string[]
  setSelectedImages: (images: string[]) => void
}

interface InputImagesNodeProps {
  data: InputImagesNodeData
}

export default function InputImagesNode({ data }: InputImagesNodeProps) {
  const { sticker, additionalImages, setAdditionalImages, selectedImages, setSelectedImages } = data
  
  const [isUploading, setIsUploading] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  const toggleImageSelection = (imageUrl: string) => {
    if (selectedImages.includes(imageUrl)) {
      setSelectedImages(selectedImages.filter(url => url !== imageUrl))
    } else {
      setSelectedImages([...selectedImages, imageUrl])
    }
  }

  const isImageSelected = (imageUrl: string) => {
    return selectedImages.includes(imageUrl)
  }

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
          <div 
            key="preprocessed_output_image_url" 
            className="relative cursor-pointer"
            onClick={() => toggleImageSelection(sticker.preprocessed_output_image_url!)}
          >
            <div className={`w-full rounded-lg bg-gray-50 transition-all ${
              isImageSelected(sticker.preprocessed_output_image_url) 
                ? 'ring-2 ring-blue-500 ring-offset-2' 
                : 'hover:ring-2 hover:ring-gray-300'
            }`}>
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
            {isImageSelected(sticker.preprocessed_output_image_url) && (
              <div className="absolute top-2 left-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </div>
        )}

        {/* input_image_url */}
        {sticker.input_image_url && (
          <div 
            key="input_image_url" 
            className="relative cursor-pointer"
            onClick={() => toggleImageSelection(sticker.input_image_url!)}
          >
            <div className={`w-full rounded-lg bg-gray-50 transition-all ${
              isImageSelected(sticker.input_image_url) 
                ? 'ring-2 ring-blue-500 ring-offset-2' 
                : 'hover:ring-2 hover:ring-gray-300'
            }`}>
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
            {isImageSelected(sticker.input_image_url) && (
              <div className="absolute top-2 left-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </div>
        )}

        {/* Additional images */}
        {additionalImages.map((imageUrl, index) => (
          <div 
            key={`additional-${index}`} 
            className="relative cursor-pointer"
            onClick={() => toggleImageSelection(imageUrl)}
          >
            <div className={`w-full rounded-lg bg-gray-50 transition-all ${
              isImageSelected(imageUrl) 
                ? 'ring-2 ring-blue-500 ring-offset-2' 
                : 'hover:ring-2 hover:ring-gray-300'
            }`}>
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
            {isImageSelected(imageUrl) && (
              <div className="absolute top-2 left-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center z-10">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
            {/* Remove button */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                removeAdditionalImage(index)
              }}
              className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors z-10"
              title="Remove image"
            >
              <X className="w-3 h-3" />
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
