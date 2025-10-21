import { NextRequest, NextResponse } from 'next/server';
import FrontAPIClient from '@/lib/front';
import EmailTemplateService from '@/lib/email-templates';
import { supabase } from '@/lib/supabase';

interface SendEmailRequest {
  ticketId: string;
  ticketNumber: string;
  customerEmail: string;
  customerName?: string;
  feedback: string;
  correctionType?: string; // Made optional with fallback
  originalImageUrl: string;
  correctedImageUrls: string[];
  isDraft?: boolean;
  sendToCustomer?: boolean;
  supportEmail?: string;
  supportTeamName?: string;
  emailMode?: 'correction' | 'credit';
  customSubject?: string;
  customBody?: string;
  userId?: string;
  conversationId?: string;
  messageId?: string;
  creditAmount?: number;
}

interface SendEmailResponse {
  success: boolean;
  messageId?: string;
  messageUid?: string;
  error?: string;
  emailData?: {
    subject: string;
    body: string;
    attachments?: number;
  };
  credit?: {
    granted?: boolean;
    creditLedgerId?: string;
    error?: string;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<SendEmailResponse>> {
  try {
    const body: SendEmailRequest = await request.json();

    // Validate required fields
    const requiredFields = [
      'ticketId',
      'ticketNumber', 
      'customerEmail',
      'correctedImageUrls'
    ];

    for (const field of requiredFields) {
      if (!body[field as keyof SendEmailRequest]) {
        return NextResponse.json(
          { 
            success: false, 
            error: `Missing required field: ${field}` 
          },
          { status: 400 }
        );
      }
    }

    // Provide fallback for correctionType if not provided
    const correctionType = body.correctionType || 'ai-correction';

    // Validate email format
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(body.customerEmail)) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid customer email format' 
        },
        { status: 400 }
      );
    }

    // Validate template data
    const templateData = {
      customerName: body.customerName,
      ticketNumber: body.ticketNumber,
      feedback: body.feedback,
      correctionType: correctionType,
      originalImageUrl: body.originalImageUrl,
      correctedImageUrls: body.correctedImageUrls,
      supportTeamName: body.supportTeamName,
      supportEmail: body.supportEmail,
      userId: body.userId,
      email: body.customerEmail
    };

    // Skip corrected images validation for:
    // 1. Credit emails
    // 2. Draft emails  
    // 3. When explicitly sending without images (customBody provided indicates user interaction)
    const skipImageValidation = body.emailMode === 'credit' || 
                               body.isDraft || 
                               (body.customBody && body.correctedImageUrls.length === 0);
    
    const validation = EmailTemplateService.validateTemplateData(templateData, {
      requireCorrectedImages: !skipImageValidation
    });
    if (!validation.valid) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Template validation failed: ${validation.errors.join(', ')}` 
        },
        { status: 400 }
      );
    }

    // Initialize Front API client
    let frontClient: FrontAPIClient;
    const processedUrls: string[] = [];
    try {
      frontClient = new FrontAPIClient();
    } catch (error) {
      console.error('❌ Front API client initialization failed:', error);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Front API configuration error. Please check environment variables.' 
        },
        { status: 500 }
      );
    }

    // Generate email template
    let emailTemplate = body.isDraft
      ? EmailTemplateService.generateDraftEmail(templateData)
      : body.emailMode === 'credit'
        ? EmailTemplateService.generateCreditEmail(templateData)
        : EmailTemplateService.generateCorrectionEmail(templateData);

    // Override with custom subject and body if provided
    if (body.customSubject) {
      emailTemplate = { ...emailTemplate, subject: body.customSubject };
    }
    if (body.customBody) {
      emailTemplate = { ...emailTemplate, body: body.customBody };
    }

    console.log('📧 Generated email template:', {
      subject: emailTemplate.subject,
      bodyLength: emailTemplate.body.length,
      isDraft: body.isDraft
    });

    console.log('🔧 Preparing attachments...');
    console.log('📋 Image URLs to process:', {
      original: body.originalImageUrl,
      corrected: body.correctedImageUrls
    });

    // Prepare image attachments
    const attachments: Array<{ filename: string; contentType: string; data: Buffer }> = [];

    try {
      // Add corrected image attachments (optional for credit mode)
      console.log('📥 Processing corrected images...');
      for (let i = 0; i < (body.correctedImageUrls?.length || 0); i++) {
        let correctedUrl = body.correctedImageUrls[i];
        const total = body.correctedImageUrls.length;
        const filename = (total === 1 || i === 0)
          ? 'corrected-image.png'
          : `corrected-image-${i + 1}.png`;
        
        console.log(`📥 Processing corrected image ${i + 1}: ${correctedUrl.substring(0, 50)}...`);
        // Post-process background removal via our API
        try {
          // Build absolute origin for server-to-server call
          const xfProto = request.headers.get('x-forwarded-proto') || 'http';
          const xfHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
          const apiBase = process.env.NEXT_PUBLIC_BASE_URL || `${xfProto}://${xfHost}`;
          const ppResp = await fetch(`${apiBase}/api/postprocess-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: correctedUrl })
          });
          if (ppResp.ok) {
            const ppData = await ppResp.json();
            if (ppData?.url) {
              correctedUrl = ppData.url;
              console.log(`🧼 Background removed (image ${i + 1})`);
              processedUrls.push(correctedUrl);
            }
          } else {
            console.warn(`⚠️ Postprocess-image failed for image ${i + 1}: ${ppResp.status}`);
          }
        } catch (e) {
          console.warn(`⚠️ Postprocess-image error for image ${i + 1}:`, e);
        }
        const correctedAttachment = await frontClient.prepareImageAttachment(
          correctedUrl,
          filename
        );
        if (correctedAttachment) attachments.push(correctedAttachment);
      }
      console.log('📎 Prepared attachments summary:', { total: attachments.length, processedUrls });
    } catch (attachmentError) {
      console.error('💥 Error preparing attachments:', attachmentError);
    }

    // Prepare email data
    const emailData = {
      to: [body.customerEmail],
      subject: emailTemplate.subject,
      body: emailTemplate.body,
      body_format: 'html' as const,
      attachments: attachments.length > 0 ? attachments : undefined
    };

    // Send email, create draft, or reply to conversation
    let result;
    if (body.conversationId && !body.isDraft && body.sendToCustomer) {
      // Reply to existing conversation
      const replyData = {
        body: emailTemplate.body,
        body_format: 'html' as const,
        attachments: attachments.length > 0 ? attachments : undefined
      };
      result = await frontClient.replyToConversation(body.conversationId, replyData);
    } else if (body.isDraft || !body.sendToCustomer) {
      // Create draft
      result = await frontClient.createDraft(emailData);
    } else {
      // Send new message
      result = await frontClient.sendMessage(emailData);
    }

    if (result.success) {
      let creditResult: { granted?: boolean; creditLedgerId?: string; error?: string } | undefined;

      // ==========================================
      // CRITICAL WORK: Track sent emails and mark images as sent
      // Only do this for actual sends (not drafts or test sends)
      // ==========================================
      
      // Extract model_run_id from ticketNumber (which contains the model_run_id)
      const modelRunId = body.ticketNumber;
      
      // Only track and resolve for actual sends, not drafts/test sends
      const isActualSend = !body.isDraft && body.sendToCustomer;
      
      if (isActualSend) {
        try {
        // 1. Insert record into z_email_history to track this email
        console.log('📝 Inserting email history record...');
        const { error: emailHistoryError } = await supabase
          .from('z_email_history')
          .insert({
            model_run_id: modelRunId,
            user_email: body.customerEmail,
            type: body.emailMode === 'credit' ? 'credit' : 'fixed_artwork',
            subject_line: emailTemplate.subject,
            message: emailTemplate.body,
            conversation_id: body.conversationId || null,
            message_id: result.message_id || null,
            source: 'front',
            payload: result.details || {},
            reason: body.correctionType || 'manual-correction'
          });
        
        if (emailHistoryError) {
          console.error('❌ Failed to insert email history:', emailHistoryError);
        } else {
          console.log('✅ Email history record created');
        }

        // 2. Mark images as 'sent_artwork' or 'sent_credit' in y_sticker_edits_generations
        // Only mark images that were actually attached to the email
        // Use the original URLs (correctedImageUrls) to match against the database, 
        // not processedUrls which contain background-removed versions
        if (body.correctedImageUrls && body.correctedImageUrls.length > 0) {
          const actionValue = body.emailMode === 'credit' ? 'sent_credit' : 'sent_artwork';
          console.log(`📝 Marking images as '${actionValue}' in y_sticker_edits_generations...`);
          const { error: generationsError } = await supabase
            .from('y_sticker_edits_generations')
            .update({ 
              action: actionValue,
              updated_at: new Date().toISOString()
            })
            .eq('model_run_id', modelRunId)
            .in('output_image_url', body.correctedImageUrls);
          
          if (generationsError) {
            console.error(`❌ Failed to mark generations as ${actionValue}:`, generationsError);
          } else {
            console.log(`✅ Marked ${body.correctedImageUrls.length} generation(s) as '${actionValue}'`);
          }
        }

        // 3. Mark sticker edit as resolved in y_sticker_edits
        console.log('📝 Marking sticker edit as resolved...');
        const { error: stickerEditError } = await supabase
          .from('y_sticker_edits')
          .update({ 
            status: 'resolved',
            resolved_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('model_run_id', modelRunId);
        
        if (stickerEditError) {
          console.error('❌ Failed to mark sticker edit as resolved:', stickerEditError);
        } else {
          console.log('✅ Sticker edit marked as resolved');
        }

        // 4. Replace output URLs and archive old ones in artwork_history
        // Only do this if images were actually sent
        if (body.correctedImageUrls && body.correctedImageUrls.length > 0) {
          console.log('📝 Updating model_run URLs and archiving old ones...');
          
          // First, get the current URLs from model_run
          const { data: modelRunData, error: fetchError } = await supabase
            .from('model_run')
            .select('output_image_url, preprocessed_output_image_url, artwork_history')
            .eq('id', modelRunId)
            .single();
          
          if (fetchError || !modelRunData) {
            console.error('❌ Failed to fetch model_run data:', fetchError);
          } else {
            // Use first image as the new URL (rule: first image added)
            const newImageUrl = body.correctedImageUrls[0];
            const actionValue = body.emailMode === 'credit' ? 'sent_credit' : 'sent_artwork';
            
            // Build history entry
            const historyEntry = {
              output_image_url: modelRunData.output_image_url,
              preprocessed_output_image_url: modelRunData.preprocessed_output_image_url,
              replaced_at: new Date().toISOString(),
              replaced_by: newImageUrl,
              reason: actionValue
            };
            
            // Append to existing history (or create new array)
            const updatedHistory = [...(modelRunData.artwork_history || []), historyEntry];
            
            // Update model_run with new URLs and history
            const { error: updateError } = await supabase
              .from('model_run')
              .update({
                output_image_url: newImageUrl,
                preprocessed_output_image_url: newImageUrl,
                artwork_history: updatedHistory,
                updated_at: new Date().toISOString()
              })
              .eq('id', modelRunId);
            
            if (updateError) {
              console.error('❌ Failed to update model_run URLs:', updateError);
            } else {
              console.log(`✅ Updated model_run URLs to: ${newImageUrl}`);
              console.log(`✅ Archived old URLs in artwork_history (${updatedHistory.length} entries)`);
            }
          }
        }
        } catch (trackingError) {
          console.error('❌ Error tracking email/updating records:', trackingError);
          // Don't fail the whole request if tracking fails - email was sent successfully
        }
      }

      // Handle credit granting (only for actual sends, not test sends)
      if (isActualSend && body.emailMode === 'credit') {
        try {
          const creditAmount = body.creditAmount || 1;
          const emailLower = (body.customerEmail || '').toLowerCase();
          // Look up user_id by email from users_populated
          const { data: userRows, error: userErr } = await supabase
            .from('users_populated')
            .select('id, email')
            .ilike('email', emailLower)
            .limit(1);

          const userId = userRows?.[0]?.id as string | undefined;
          if (!userId || userErr) {
            creditResult = { granted: false, error: userErr?.message || 'User not found for email' };
          } else {
            const { data: insertRows, error: insertErr } = await supabase
              .from('credit_ledger')
              .insert({
                user_id: userId,
                amount: creditAmount,
                type: 'credit',
                metadata: { source: 'assistant', reason: 'credit_email', ticket_id: body.ticketId, ticket_number: body.ticketNumber }
              })
              .select('id')
              .limit(1);
            if (insertErr) {
              creditResult = { granted: false, error: insertErr.message };
            } else {
              creditResult = { granted: true, creditLedgerId: insertRows?.[0]?.id };
            }
          }
        } catch (creditError) {
          creditResult = { granted: false, error: creditError instanceof Error ? creditError.message : 'Unknown credit error' };
        }
      }

      return NextResponse.json({
        success: true,
        messageId: result.message_id,
        messageUid: result.message_uid,
        emailData: {
          subject: emailTemplate.subject,
          body: emailTemplate.body,
          attachments: attachments.length,
          processedUrls
        },
        credit: creditResult
      });
    } else {
      return NextResponse.json(
        { success: false, error: result.error, emailData: { subject: '', body: '', processedUrls } },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('💥 Error in send-front-email API:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Internal server error' 
      },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const config = {
      hasApiToken: !!process.env.FRONT_API_TOKEN,
      hasChannelId: !!process.env.FRONT_CHANNEL_ID,
      hasInboxId: !!process.env.FRONT_INBOX_ID
    };

    let clientStatus = 'unconfigured';
    let error = null;

    if (config.hasApiToken && config.hasChannelId) {
      try {
        new FrontAPIClient();
        clientStatus = 'configured';
      } catch (err) {
        clientStatus = 'error';
        error = err instanceof Error ? err.message : 'Configuration error';
      }
    }

    return NextResponse.json({
      configuration: config,
      status: clientStatus,
      error,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return NextResponse.json(
      { 
        error: 'Failed to check configuration',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
