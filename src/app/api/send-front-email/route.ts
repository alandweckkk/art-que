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
      'feedback',
      'originalImageUrl',
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
      supportEmail: body.supportEmail
    };

    const validation = EmailTemplateService.validateTemplateData(templateData, {
      requireCorrectedImages: body.emailMode === 'credit' ? false : true
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
    const emailTemplate = body.isDraft
      ? EmailTemplateService.generateDraftEmail(templateData)
      : body.emailMode === 'credit'
        ? EmailTemplateService.generateCreditEmail(templateData)
        : EmailTemplateService.generateCorrectionEmail(templateData);

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

    // Send email or create draft
    const result = (body.isDraft || !body.sendToCustomer)
      ? await frontClient.createDraft(emailData)
      : await frontClient.sendMessage(emailData);

    if (result.success) {
      let creditResult: { granted?: boolean; creditLedgerId?: string; error?: string } | undefined;

      if (body.emailMode === 'credit') {
        try {
          const creditAmount = 1;
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
        { success: false, error: result.error, emailData: { processedUrls } },
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
