'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

interface FloatingNavigationProps {
  onPrevious: () => void
  onNext: () => void
  currentIndex: number
  totalCount: number
}

export default function FloatingNavigation({ 
  onPrevious, 
  onNext, 
  currentIndex, 
  totalCount 
}: FloatingNavigationProps) {
  return (
    <div className="fixed top-1/2 left-6 transform -translate-y-1/2 z-50">
      <div 
        className="bg-white rounded-full shadow-lg border border-gray-200 p-2 flex flex-col gap-1"
        style={{
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
        }}
      >
        
        {/* Previous Button */}
        <button
          onClick={onPrevious}
          disabled={currentIndex === 0}
          className={`p-2 rounded-full transition-all ${
            currentIndex === 0
              ? 'text-gray-300 cursor-not-allowed'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
          }`}
          title="Previous sticker"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        {/* Next Button */}
        <button
          onClick={onNext}
          disabled={currentIndex >= totalCount - 1}
          className={`p-2 rounded-full transition-all ${
            currentIndex >= totalCount - 1
              ? 'text-gray-300 cursor-not-allowed'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
          }`}
          title="Next sticker"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

      </div>
    </div>
  )
}
