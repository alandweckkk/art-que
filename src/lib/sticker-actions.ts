import { supabase } from '@/lib/supabase'
import { StickerEdit } from '@/types/sticker'

export interface EmailData {
  ticketId: string
  ticketNumber: string
  customerEmail: string
  customerName: string
  feedback: string
  correctionType: 'manual-correction' | 'credit-issued'
  originalImageUrl: string
  correctedImageUrls: string[]
  isDraft: boolean
  sendToCustomer: boolean
  supportTeamName: string
  supportEmail: string
  customSubject?: string
  customBody?: string
  emailMode?: 'credit'
  conversationId?: string
  messageId?: string
  creditAmount?: number
}

export const sendFixedArtwork = async (
  sticker: StickerEdit, 
  selectedImages: string[],
  setIsSendingEmail: (value: boolean) => void,
  customEmailData?: { toEmail?: string; subject?: string; body?: string; conversationId?: string; messageId?: string }
) => {
  // Allow sending even without images (user may choose "Send Anyway")
  if (!sticker) return

  try {
    setIsSendingEmail(true)

    const emailData: EmailData = {
      ticketId: sticker.sticker_edit_id,
      ticketNumber: sticker.model_run_id,
      customerEmail: customEmailData?.toEmail || sticker.customer_email,
      customerName: sticker.customer_name,
      feedback: sticker.feedback_notes,
      correctionType: 'manual-correction',
      originalImageUrl: sticker.preprocessed_output_image_url,
      correctedImageUrls: selectedImages,
      isDraft: false,
      sendToCustomer: true,
      supportTeamName: 'MakeMeASticker.com',
      supportEmail: 'support@makemeasticker.com',
      customSubject: customEmailData?.subject,
      customBody: customEmailData?.body,
      conversationId: customEmailData?.conversationId,
      messageId: customEmailData?.messageId
    }

    console.log('📧 Sending email with data:', {
      customerEmail: emailData.customerEmail,
      selectedImages: selectedImages.length,
      ticketNumber: emailData.ticketNumber
    })

    const response = await fetch('/api/send-front-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailData)
    })

    const result = await response.json()
    
    if (result.success) {
      // Mark feedback as addressed after successful email
      await supabase
        .from('model_run')
        .update({ 
          feedback_addressed: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', sticker.model_run_id)
      
      alert(`Email sent successfully to ${sticker.customer_email}!\n\nMessage ID: ${result.messageId}`)
      console.log('✅ Email sent successfully:', result)
      console.log(`✅ Marked record ${sticker.model_run_id} as resolved`)
      return { success: true, result }
    } else {
      console.error('❌ Email send failed:', result.error)
      throw new Error(`Failed to send email: ${result.error}`)
    }
  } catch (error) {
    console.error('💥 Error sending email:', error)
    setIsSendingEmail(false)
    throw error
  } finally {
    setIsSendingEmail(false)
  }
}

export const markAsResolved = async (sticker: StickerEdit) => {
  if (!sticker) return

  // Update the database to mark as resolved
  const { error } = await supabase
    .from('model_run')
    .update({ 
      feedback_addressed: true,
      updated_at: new Date().toISOString()
    })
    .eq('id', sticker.model_run_id)

  if (error) {
    console.error('Error marking as resolved:', error)
    throw new Error(`Failed to mark as resolved: ${error.message || 'Unknown error'}`)
  }

  console.log(`✅ Marked record ${sticker.model_run_id} as resolved`)
  return "Marked as resolved"
}

export const sendCreditEmail = async (
  sticker: StickerEdit,
  selectedImages: string[],
  setIsSendingCreditEmail: (value: boolean) => void,
  customEmailData?: { toEmail?: string; subject?: string; body?: string; conversationId?: string; messageId?: string; creditAmount?: number }
) => {
  if (!sticker) return

  try {
    setIsSendingCreditEmail(true)

    const emailData: EmailData = {
      ticketId: sticker.sticker_edit_id,
      ticketNumber: sticker.model_run_id,
      customerEmail: customEmailData?.toEmail || sticker.customer_email,
      customerName: sticker.customer_name,
      feedback: sticker.feedback_notes,
      correctionType: 'credit-issued',
      originalImageUrl: sticker.preprocessed_output_image_url,
      correctedImageUrls: selectedImages, // allow optional attachments if selected
      isDraft: false,
      sendToCustomer: true,
      supportTeamName: 'MakeMeASticker.com',
      supportEmail: 'support@makemeasticker.com',
      customSubject: customEmailData?.subject,
      customBody: customEmailData?.body,
      emailMode: 'credit',
      conversationId: customEmailData?.conversationId,
      messageId: customEmailData?.messageId,
      creditAmount: customEmailData?.creditAmount
    }

    console.log('📧 Sending credit email with data:', {
      customerEmail: emailData.customerEmail,
      selectedImages: selectedImages.length,
      ticketNumber: emailData.ticketNumber
    })

    const response = await fetch('/api/send-front-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailData)
    })

    const result = await response.json()
    
    if (result.success) {
      // Mark feedback as addressed after successful credit email
      await supabase
        .from('model_run')
        .update({ 
          feedback_addressed: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', sticker.model_run_id)
      
      alert(`Credit email sent successfully to ${sticker.customer_email}!\n\nMessage ID: ${result.messageId}`)
      console.log('✅ Credit email sent successfully:', result)
      console.log(`✅ Marked record ${sticker.model_run_id} as resolved`)
      return { success: true, result }
    } else {
      console.error('❌ Credit email failed:', result.error)
      throw new Error(`Failed to send credit email: ${result.error}`)
    }
  } catch (error) {
    console.error('💥 Error sending credit email:', error)
    setIsSendingCreditEmail(false)
    throw error
  } finally {
    setIsSendingCreditEmail(false)
  }
}
