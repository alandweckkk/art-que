'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Handle, Position } from '@xyflow/react'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import { 
  Send, 
  ChevronDown, 
  Bold, 
  Italic, 
  Link, 
  Smile, 
  AlertTriangle, 
  Image, 
  Lock, 
  Edit3,
  Calendar,
  MoreHorizontal,
  Trash2,
  Upload,
  ImageIcon
} from 'lucide-react'

// Dynamically import ReactQuill to avoid SSR issues
const ReactQuill = dynamic(() => import('react-quill-new'), { 
  ssr: false,
  loading: () => <div className="w-full h-80 p-4 bg-gray-50 rounded animate-pulse" />
})

interface EmailComposerNodeData {
  customerEmail: string
  customerName: string
  userId: string
  selectedImages: string[]
  onSend: (emailData?: { toEmail?: string; subject?: string; body?: string; conversationId?: string; messageId?: string }) => void
  isSending: boolean
  onDetachImage?: (imageUrl: string) => void
  onAttachImage?: (imageUrl: string) => void
  emailMode?: 'artwork' | 'credit'
}

interface EmailComposerNodeProps {
  data: EmailComposerNodeData
}

export default function EmailComposerNode({ data }: EmailComposerNodeProps) {
  const { customerEmail, customerName, userId, selectedImages, onSend, isSending, onDetachImage, onAttachImage, emailMode = 'artwork' } = data
  const [showUidPopover, setShowUidPopover] = useState(false)
  const [showSendDropdown, setShowSendDropdown] = useState(false)
  const [showNoImagesPopover, setShowNoImagesPopover] = useState(false)
  const [sendStatus, setSendStatus] = useState<'sent' | 'failed' | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const noImagesPopoverRef = useRef<HTMLDivElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  
  // Quill editor configuration - minimal setup
  const quillModules = {
    toolbar: false, // Disable toolbar for now
  }
  
  const quillFormats: string[] = []
  
  // Convert Quill HTML to email-compatible format
  const getEmailHTML = (htmlContent: string) => {
    // First, handle empty paragraphs (they should become single line breaks, not double)
    let processed = htmlContent.replace(/<p><br><\/p>/g, '<br>');
    
    // Then handle regular paragraphs - remove opening tags and convert closing to line breaks
    processed = processed
      .replace(/<p>/g, '')                   // Remove opening paragraph tags
      .replace(/<\/p>/g, '<br>')             // Convert closing paragraph tags to single line break
      
    // Clean up excessive line breaks (more than 2 in a row become just 2)
    processed = processed
      .replace(/(<br>){3,}/g, '<br><br>')    // Replace 3+ breaks with just 2
      .replace(/(<br>)+$/, '')               // Remove all trailing line breaks
      .trim();                               // Remove leading/trailing whitespace
    
    // Ensure there's some content
    if (!processed) {
      processed = ' '; // Prevent empty body
    }
    
    return processed;
  }
  
  // Editable email fields state - start empty and populate async
  const [toEmail, setToEmail] = useState('')
  const [subject, setSubject] = useState(
    emailMode === 'credit' 
      ? "We've Added a Free Credit to Your Account" 
      : "Your Updated Sticker Design"
  )
  const [body, setBody] = useState(
    emailMode === 'credit' 
      ? `<p>Hey there!</p><p><br></p><p>We're sorry we couldn't fix your sticker this time. We've added a free credit to your account.</p><p><br></p><p>If you have any questions or suggestions to make our product better, we're happy to help!</p><p><br></p><p>Best regards,<br>Alan & MakeMeASticker.com</p>`
      : `<p>Hi there!</p><p><br></p><p>I just edited your sticker design - you can click here to see the before and after.</p><p><br></p><p>Your note was helpful, but if I missed the mark, just let me know. Thanks so much for making stickers with us, and I'm always happy to edit artworks for you anytime!</p><p><br></p><p>Kind Regards,<br>Chelsea & MakeMeASticker.com Team</p>`
  )
  
  // Conversation threading state
  const [conversationId, setConversationId] = useState('')
  const [messageId, setMessageId] = useState('')
  
  const isCreditMode = emailMode === 'credit'

  // Fetch user email directly from database
  useEffect(() => {
    const loadEmail = async () => {
      if (!userId) return

      try {
        // Get user_id from model_run, then email from users_populated
        const { data: modelRun } = await supabase
          .from('model_run')
          .select('user_id')
          .eq('id', userId)
          .single()

        if (modelRun?.user_id) {
          const { data: user } = await supabase
            .from('users_populated')
            .select('email')
            .eq('id', modelRun.user_id)
            .maybeSingle()

          if (user?.email) {
            setToEmail(user.email)
          }
        }
      } catch (error) {
        console.error('Error fetching email:', error)
      }
    }

    loadEmail()
  }, [userId])

  // Clear send status after 3 seconds
  useEffect(() => {
    if (sendStatus) {
      const timer = setTimeout(() => {
        setSendStatus(null)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [sendStatus])

  // Update state when email mode changes (but don't override fetched email)
  useEffect(() => {
    setSubject(
      emailMode === 'credit' 
        ? "We've Added a Free Credit to Your Account" 
        : "Your Updated Sticker Design"
    )
    setBody(
      emailMode === 'credit' 
        ? `<p>Hey there!</p><p><br></p><p>We're sorry we couldn't fix your sticker this time. We've added a free credit to your account.</p><p><br></p><p>If you have any questions or suggestions to make our product better, we're happy to help!</p><p><br></p><p>Best regards,<br>Alan & MakeMeASticker.com</p>`
        : `<p>Hi there!</p><p><br></p><p>I just edited your sticker design - you can click here to see the before and after.</p><p><br></p><p>Your note was helpful, but if I missed the mark, just let me know. Thanks so much for making stickers with us, and I'm always happy to edit artworks for you anytime!</p><p><br></p><p>Kind Regards,<br>Chelsea & MakeMeASticker.com Team</p>`
    )
  }, [emailMode])

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSendDropdown(false)
      }
    }

    if (showSendDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showSendDropdown])

  // Handle click outside to close no images popover
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (noImagesPopoverRef.current && !noImagesPopoverRef.current.contains(event.target as Node)) {
        setShowNoImagesPopover(false)
      }
    }

    if (showNoImagesPopover) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showNoImagesPopover])

  // Image upload helper function
  const uploadImageAsBlob = useCallback(async (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        resolve(result)
      }
      reader.readAsDataURL(file)
    })
  }, [])

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set drag over to false if we're leaving the drop zone entirely
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    const imageFiles = files.filter(file => file.type.startsWith('image/'))

    for (const file of imageFiles) {
      try {
        const blobUrl = await uploadImageAsBlob(file)
        if (onAttachImage) {
          onAttachImage(blobUrl)
        }
      } catch (error) {
        console.error('Error uploading image:', error)
      }
    }
  }, [uploadImageAsBlob, onAttachImage])

  return (
    <div className="bg-white rounded-lg shadow-xl border border-gray-300 w-[500px]">
      <Handle type="target" position={Position.Left} />
      
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${
        isCreditMode 
          ? 'border-orange-200 bg-orange-50' 
          : emailMode === 'artwork'
            ? 'border-blue-200 bg-blue-50'
            : 'border-gray-200 bg-gray-50'
      }`}>
        <div className={`text-base font-normal ${
          isCreditMode 
            ? 'text-orange-800' 
            : emailMode === 'artwork'
              ? 'text-blue-800'
              : 'text-gray-800'
        }`}>
          {isCreditMode ? 'Credit Notification' : emailMode === 'artwork' ? 'Fixed Artwork' : 'New Message'}
        </div>
        
        {/* Front Conversation Threading */}
        <div className="flex flex-col items-end gap-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Conversation ID:</span>
            <input 
              type="text"
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
              className="w-24 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400 bg-white"
              placeholder="Optional"
            />
          </div>
          {/* <div className="flex items-center gap-2">
            <span className="text-gray-500">Message ID:</span>
            <input 
              type="text"
              value={messageId}
              onChange={(e) => setMessageId(e.target.value)}
              className="w-24 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400 bg-white"
              placeholder="Optional"
            />
          </div> */}
        </div>
      </div>

      {/* Email Fields */}
      <div className="px-4 pt-2 pb-3">
        <div className="flex items-center gap-6">
          {/* To Field - Takes up more space since emails are longer */}
          <div className="flex items-center flex-[2]">
            <div className="text-xs text-gray-600 w-6 flex-shrink-0 font-medium">To</div>
            <input 
              type="email"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              className={`flex-1 text-sm text-gray-900 px-2 py-2 border-b focus:outline-none bg-transparent transition-colors ${
                isCreditMode 
                  ? 'border-orange-200 focus:border-orange-400' 
                  : emailMode === 'artwork'
                    ? 'border-blue-200 focus:border-blue-400'
                    : 'border-gray-200 focus:border-blue-400'
              }`}
              placeholder="recipient@email.com"
            />
          </div>
          
          {/* Subject Field - Takes up less space */}
          <div className="flex items-center flex-[3]">
            <div className="text-xs text-gray-600 w-10 flex-shrink-0 font-medium">Subject</div>
            <input 
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={`flex-1 text-sm text-gray-900 px-2 py-2 border-b focus:outline-none bg-transparent transition-colors ${
                isCreditMode 
                  ? 'border-orange-200 focus:border-orange-400' 
                  : emailMode === 'artwork'
                    ? 'border-blue-200 focus:border-blue-400'
                    : 'border-gray-200 focus:border-blue-400'
              }`}
              placeholder="Email subject..."
            />
          </div>
          
          {/* UID Button - Commented Out */}
          {/* <div className="relative">
            <button
              onClick={() => setShowUidPopover(!showUidPopover)}
              className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded hover:bg-gray-200 transition-colors"
            >
              UID
            </button>
            {showUidPopover && (
              <div className="absolute top-8 right-0 bg-white border border-gray-300 rounded-lg shadow-lg p-3 w-64 z-10">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-gray-600 font-mono break-all">
                    {userId}
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(userId)
                      setShowUidPopover(false)
                    }}
                    className="p-1 text-gray-500 hover:text-gray-700 flex-shrink-0"
                    title="Copy User ID"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div> */}
        </div>
      </div>

      {/* Message Body */}
      <div className="px-4 pb-4">
        <div className="quill-email-editor nodrag [&_.ql-editor]:text-sm [&_.ql-container]:!h-auto [&_.ql-editor]:!min-h-[250px]">
          <ReactQuill
            value={body}
            onChange={setBody}
            modules={quillModules}
            formats={quillFormats}
            placeholder="Click here to edit your email message..."
            style={{ 
              minHeight: '250px',
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
            theme="snow"
          />
        </div>
      </div>

      {/* Attachments */}
      {!isCreditMode && selectedImages.length > 0 && (
        <div className="px-4 pb-4">
          <div className="text-sm text-gray-700 mb-3">Attachments ({selectedImages.length})</div>
          <div className="flex flex-wrap gap-3">
            {selectedImages.map((imageUrl, index) => (
              <div 
                key={imageUrl} 
                className="relative group"
              >
                <div className="w-16 h-16 bg-gray-100 rounded-lg border overflow-hidden">
                  <img 
                    src={imageUrl} 
                    alt={`Attachment ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
                {/* Detach Button */}
                {onDetachImage && (
                  <button
                    onClick={() => onDetachImage(imageUrl)}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-red-600"
                    title="Remove attachment"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Toolbar */}
      <div className={`flex items-center justify-between px-4 py-3 border-t ${
        isCreditMode 
          ? 'border-orange-200 bg-orange-50' 
          : emailMode === 'artwork'
            ? 'border-blue-200 bg-blue-50'
            : 'border-gray-200'
      }`}>
        {/* Left side - Send button and status */}
        <div className="flex items-center">
          {/* Split Send Button */}
          <div className="relative" ref={dropdownRef}>
            <div className={`flex rounded overflow-hidden ${
              isSending
                ? 'bg-gray-400'
                : isCreditMode
                  ? 'bg-orange-600 hover:bg-orange-700'
                  : emailMode === 'artwork'
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-blue-600 hover:bg-blue-700'
            }`}>
              {/* Main Send Button */}
              <button
                onClick={async () => {
                  // Check if no images are attached and not in credit mode
                  if (!isCreditMode && selectedImages.length === 0) {
                    setShowNoImagesPopover(true)
                  } else {
                    try {
                      await onSend({ 
                        toEmail, 
                        subject, 
                        body: getEmailHTML(body),
                        conversationId: conversationId.trim() || undefined,
                        messageId: messageId.trim() || undefined
                      })
                      setSendStatus('sent')
                    } catch (error) {
                      console.error('Send & Resolve failed:', error)
                      setSendStatus('failed')
                    }
                  }
                }}
                disabled={isSending}
                className="px-6 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed"
              >
                {isSending ? 'Sending...' : 'Send & Resolve'}
              </button>
              
              {/* Dropdown Arrow Button */}
              <div className="w-px bg-white/20"></div>
              <button
                onClick={() => setShowSendDropdown(!showSendDropdown)}
                disabled={isSending}
                className="px-2 py-2 text-white hover:bg-black/10 transition-colors disabled:cursor-not-allowed"
              >
                <ChevronDown size={14} />
              </button>
          </div>
          
          {/* Send Status Display */}
          {sendStatus && (
            <div className={`ml-3 flex items-center gap-1 px-2 py-1 rounded text-sm font-medium ${
              sendStatus === 'sent' 
                ? 'bg-green-100 text-green-700' 
                : 'bg-red-100 text-red-700'
            }`}>
              {sendStatus === 'sent' ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/>
                  </svg>
                  Sent
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                  Failed
                </>
              )}
            </div>
          )}

          {/* Dropdown Menu */}
          {showSendDropdown && !isSending && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px] z-20">
              <button
                onClick={() => {
                  // Check if no images are attached in artwork mode
                  if (emailMode === 'artwork' && selectedImages.length === 0) {
                    setShowNoImagesPopover(true)
                    setShowSendDropdown(false)
                    return
                  }
                  
                  // Just send email without any other actions (no resolve, no next, no clearing)
                  if (emailMode === 'credit') {
                    // For credit mode, call the credit email function directly
                    fetch('/api/send-front-email', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        ticketId: userId,
                        ticketNumber: userId,
                        customerEmail: toEmail,
                        customerName: customerName,
                        correctionType: 'credit-issued',
                        originalImageUrl: '',  // Not needed for credit emails
                        feedback: '',  // Not needed for credit emails
                        correctedImageUrls: [],
                        isDraft: true,
                        sendToCustomer: true,
                        emailMode: 'credit',
                        customSubject: subject,
                        customBody: getEmailHTML(body),  // Process the HTML before sending
                        conversationId: conversationId.trim() || undefined,
                        messageId: messageId.trim() || undefined
                      })
                    }).then(response => response.json())
                      .then(result => {
                        if (result.success) {
                          console.log('✅ Test email sent successfully:', result)
                          setSendStatus('sent')
                        } else {
                          console.error('❌ Test email failed:', result.error)
                          setSendStatus('failed')
                        }
                      })
                      .catch(error => {
                        console.error('💥 Error sending test email:', error)
                        setSendStatus('failed')
                      })
                  } else {
                    // For artwork mode, send email with attachments
                    fetch('/api/send-front-email', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        ticketId: userId,
                        ticketNumber: userId,
                        customerEmail: toEmail,
                        customerName: customerName,
                        correctionType: 'manual-correction',
                        originalImageUrl: '',  // Not needed for test send
                        feedback: '',  // Not needed for test send
                        correctedImageUrls: selectedImages,
                        isDraft: true,
                        sendToCustomer: true,
                        customSubject: subject,
                        customBody: getEmailHTML(body),  // Process the HTML before sending
                        conversationId: conversationId.trim() || undefined,
                        messageId: messageId.trim() || undefined
                      })
                    }).then(response => response.json())
                      .then(result => {
                        if (result.success) {
                          console.log('✅ Test email sent successfully:', result)
                          setSendStatus('sent')
                        } else {
                          console.error('❌ Test email failed:', result.error)
                          setSendStatus('failed')
                        }
                      })
                      .catch(error => {
                        console.error('💥 Error sending test email:', error)
                        setSendStatus('failed')
                      })
                  }
                  setShowSendDropdown(false)
                }}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Test Send
              </button>
            </div>
          )}
          
          {/* No Images Popover */}
          {showNoImagesPopover && (
            <div 
              ref={noImagesPopoverRef}
              className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 min-w-[200px] z-30"
            >
              <div className="flex items-center gap-2 text-sm text-red-600 mb-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 18.5c-.77.833.192 2.5 1.732 2.5z"/>
                </svg>
                No images attached
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setShowNoImagesPopover(false)
                    try {
                      await onSend({ 
                        toEmail, 
                        subject, 
                        body: getEmailHTML(body),
                        conversationId: conversationId.trim() || undefined,
                        messageId: messageId.trim() || undefined
                      })
                      setSendStatus('sent')
                    } catch (error) {
                      console.error('Send Anyway failed:', error)
                      setSendStatus('failed')
                    }
                  }}
                  className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors whitespace-nowrap"
                >
                  Send Anyway
                </button>
                <button
                  onClick={() => setShowNoImagesPopover(false)}
                  className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          </div>
        </div>

        {/* Right side - Image Drop Zone - Only show for artwork mode */}
        {!isCreditMode && (
          <div
            ref={dropZoneRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex items-center justify-center px-3 py-2 border-2 border-dashed rounded-lg transition-all cursor-pointer hover:bg-gray-50 ${
              isDragOver
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Upload size={14} />
              <span>Drop images</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
