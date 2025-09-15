'use client'

import { Mail, CreditCard, CheckCircle, SkipForward } from 'lucide-react'

interface BottomToolbarProps {
  selectedImages: string[]
  isSendingEmail: boolean
  isSendingCreditEmail: boolean
  onSendFixedArtwork: () => void
  onSendCredit: () => void
  onMarkResolved: () => void
  onSkipNext: () => void
  emailMode?: 'artwork' | 'credit'
}

export default function BottomToolbar({
  selectedImages,
  isSendingEmail,
  isSendingCreditEmail,
  onSendFixedArtwork,
  onSendCredit,
  onMarkResolved,
  onSkipNext,
  emailMode = 'artwork'
}: BottomToolbarProps) {
  return (
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
      <div 
        className="bg-white rounded-full shadow-lg border border-gray-200 px-4 py-2 flex items-center gap-1"
        style={{
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
        }}
      >
        
        {/* Send Fixed Artwork */}
        <button
          onClick={onSendFixedArtwork}
          className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
            emailMode === 'artwork'
              ? 'bg-blue-100 text-blue-700 border border-blue-200'
              : 'text-blue-600 hover:bg-blue-50 hover:text-blue-700'
          }`}
          title="Switch to artwork email mode"
        >
          <Mail className="w-4 h-4" />
          Send Fixed Artwork
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-300" />

        {/* Send Credit */}
        <button
          onClick={onSendCredit}
          className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
            emailMode === 'credit'
              ? 'bg-orange-100 text-orange-700 border border-orange-200'
              : 'text-orange-600 hover:bg-orange-50 hover:text-orange-700'
          }`}
          title="Switch to credit email mode"
        >
          <CreditCard className="w-4 h-4" />
          Send Credit
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-300" />

        {/* Mark Resolved */}
        <button
          onClick={onMarkResolved}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-green-600 hover:bg-green-50 hover:text-green-700 transition-all"
          title="Mark as resolved"
        >
          <CheckCircle className="w-4 h-4" />
          Mark Resolved
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-300" />

        {/* Skip & Next */}
        <button
          onClick={onSkipNext}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-700 transition-all"
          title="Skip to next sticker"
        >
          <SkipForward className="w-4 h-4" />
          Skip & Next
        </button>

      </div>

      {/* Selection Indicator */}
      {selectedImages.length > 0 && (
        <div className="absolute -top-8 left-1/2 transform -translate-x-1/2">
          <div className="bg-blue-500 text-white text-xs px-3 py-1 rounded-full">
            {selectedImages.length} image{selectedImages.length !== 1 ? 's' : ''} selected
          </div>
        </div>
      )}
    </div>
  )
}
