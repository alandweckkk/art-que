import { NextRequest, NextResponse } from 'next/server';
import FrontAPIClient from '@/lib/front';
import EmailTemplateService from '@/lib/email-templates';

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

    const validation = EmailTemplateService.validateTemplateData(templateData);
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
      // Skip original image attachment - only include corrected images
      
      // Add corrected image attachments
      console.log('📥 Processing corrected images...');
      for (let i = 0; i < body.correctedImageUrls.length; i++) {
        const correctedUrl = body.correctedImageUrls[i];
        const total = body.correctedImageUrls.length;
        const filename = (total === 1 || i === 0)
          ? 'corrected-image.png'
          : `corrected-image-${i + 1}.png`;
        
        console.log(`📥 Processing corrected image ${i + 1}: ${correctedUrl.substring(0, 50)}...`);
        
        const correctedAttachment = await frontClient.prepareImageAttachment(
          correctedUrl,
          filename
        );
        
        if (correctedAttachment) {
          attachments.push(correctedAttachment);
          console.log(`✅ Corrected image ${i + 1} attachment prepared`);
        } else {
          console.warn(`⚠️ Failed to prepare corrected image attachment ${i + 1}`);
        }
      }

      console.log('📎 Prepared attachments summary:', {
        total: attachments.length,
        corrected: attachments.length
      });
    } catch (attachmentError) {
      console.error('💥 Error preparing attachments:', attachmentError);
      // Continue without attachments for now
    }

    // Check email body size
    const bodySize = Buffer.byteLength(emailTemplate.body, 'utf8');
    console.log('📏 Email body size:', bodySize, 'bytes');
    
    if (bodySize > 100000) { // 100KB limit for email body
      console.warn('⚠️ Email body is very large:', bodySize, 'bytes');
      console.log('📝 Body preview:', emailTemplate.body.substring(0, 500) + '...');
    }

    // Prepare email data
    const emailData = {
      to: [body.customerEmail],
      subject: emailTemplate.subject,
      body: emailTemplate.body,
      body_format: 'html' as const,
      attachments: attachments.length > 0 ? attachments : undefined
    };

    console.log('📧 Final email data:', {
      to: emailData.to,
      subject: emailData.subject,
      bodyLength: emailData.body.length,
      hasAttachments: !!emailData.attachments
    });

    // Send email or create draft
    let result;
    if (body.isDraft || !body.sendToCustomer) {
      console.log('📝 Creating Front draft...');
      result = await frontClient.createDraft(emailData);
    } else {
      console.log('📤 Sending Front message...');
      result = await frontClient.sendMessage(emailData);
    }

    if (result.success) {
      console.log('✅ Front operation completed successfully:', {
        messageId: result.message_id,
        messageUid: result.message_uid,
        operation: body.isDraft ? 'draft' : 'send'
      });

      return NextResponse.json({
        success: true,
        messageId: result.message_id,
        messageUid: result.message_uid,
        emailData: {
          subject: emailTemplate.subject,
          body: emailTemplate.body,
          attachments: attachments.length
        }
      });
    } else {
      console.error('❌ Front operation failed:', result.error);
      return NextResponse.json(
        { 
          success: false, 
          error: result.error,
          emailData: {
            subject: emailTemplate.subject,
            body: emailTemplate.body,
            attachments: attachments.length
          }
        },
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

// GET endpoint for testing Front API configuration
export async function GET(): Promise<NextResponse> {
  try {
    // Test Front API configuration
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
