interface TemplateData {
  customerName?: string;
  ticketNumber: string;
  feedback: string;
  correctionType: string;
  originalImageUrl: string;
  correctedImageUrls: string[];
  supportTeamName?: string;
  supportEmail?: string;
  userId?: string;
  email?: string;
}

// Alias for consistency with reference project
interface EmailTemplateData extends TemplateData {}

interface EmailTemplate {
  subject: string;
  body: string;
}

interface TemplateValidation {
  valid: boolean;
  errors: string[];
}

export default class EmailTemplateService {
  /**
   * Generates the correction email template
   * This is the main template used when sending corrected artwork to customers
   */
  static generateCorrectionEmail(data: EmailTemplateData): EmailTemplate {

    const subject = `Your Revised Sticker is Here!`;

    const body = `
Hi there!<br><br>

I just edited your sticker design - you can <a href="https://makemeasticker.com">click here</a> to see the before and after.<br><br>

Your note was helpful, but if I missed the mark, just let me know. Thanks so much for making stickers with us, and I'm always happy to edit artworks for you anytime!<br><br>

Kind Regards,<br>
Chelsea & <a href="https://makemeasticker.com">MakeMeASticker.com</a> Team<br><br>
    `.trim();

    return {
      subject,
      body
    };
  }

  /**
   * Generates the draft email template
   * Currently identical to correction email as per requirements
   */
  static generateDraftEmail(data: TemplateData): EmailTemplate {
    // For now, draft and correction emails are identical
    return this.generateCorrectionEmail(data);
  }

  /**
   * Generates the credit email template
   * Used when we can't fix the sticker and issue a free credit
   */
  static generateCreditEmail(data: EmailTemplateData): EmailTemplate {

    // Create the personalized link if userId is provided
    const siteLink = data.userId 
      ? `<a href="https://makemeasticker.com/?user_id=${data.userId}">MakeMeASticker.com</a>`
      : `<a href="https://MakeMeASticker.com">MakeMeASticker.com</a>`;

    const subject = "We've Added a Free Credit to Your Account";

    const body = `
Hey there!<br><br>

Thank you for trying MakeMeASticker.com! We tried a few times, but unfortunately weren't able to generate you a better revised version. 

We really care about making our customers happy & want to make it up to you, so we've gone ahead and added one FREE sticker credit to your account: ${data.email}!<br><br>

Claim your free credit using this link: ${siteLink} and you'll see you have an extra credit there that you can use. It should show you a "redeem" button after uploading an image, which you can click on to use the credit.<br><br>

Enjoy your free credit! Thank you so much for making stickers with us!<br><br>

Best,<br>
Chelsea & MakeMeASticker.com<br><br>
    `.trim();

    return {
      subject,
      body
    };
  }

  /**
   * Validates template data to ensure all required fields are present
   */
  static validateTemplateData(data: TemplateData, options?: { requireCorrectedImages?: boolean }): TemplateValidation {
    const errors: string[] = [];
    const requireCorrectedImages = options?.requireCorrectedImages !== false;

    // Required fields
    if (!data.ticketNumber) {
      errors.push('ticketNumber is required');
    }
    if (!data.correctionType) {
      errors.push('correctionType is required');
    }
    if (requireCorrectedImages) {
      if (!data.correctedImageUrls || data.correctedImageUrls.length === 0) {
        errors.push('correctedImageUrls must contain at least one URL');
      }
    }

    // Validate URLs if present
    const urlPattern = /^https?:\/\/.+/;
    if (data.originalImageUrl && !urlPattern.test(data.originalImageUrl)) {
      errors.push('originalImageUrl must be a valid HTTP/HTTPS URL');
    }

    if (data.correctedImageUrls && data.correctedImageUrls.length > 0) {
      data.correctedImageUrls.forEach((url, index) => {
        if (!urlPattern.test(url)) {
          errors.push(`correctedImageUrls[${index}] must be a valid HTTP/HTTPS URL`);
        }
      });
    }

    // Validate email if provided
    if (data.supportEmail) {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(data.supportEmail)) {
        errors.push('supportEmail must be a valid email address');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Gets template preview for testing/debugging
   */
  static getTemplatePreview(data: TemplateData, isDraft: boolean = false): EmailTemplate {
    return isDraft 
      ? this.generateDraftEmail(data)
      : this.generateCorrectionEmail(data);
  }

  /**
   * Generates filename for corrected image attachments
   */
  static generateAttachmentFilename(index: number, total: number): string {
    if (total === 1) {
      return 'corrected-image.png';
    }
    return `corrected-image-${index + 1}.png`;
  }

  /**
   * Helper to extract customer name from email if not provided
   */
  static extractCustomerNameFromEmail(email: string): string {
    const localPart = email.split('@')[0];
    // Convert dots and underscores to spaces, capitalize first letters
    return localPart
      .replace(/[._]/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
