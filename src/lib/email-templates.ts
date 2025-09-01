interface TemplateData {
  customerName?: string;
  ticketNumber: string;
  feedback: string;
  correctionType: string;
  originalImageUrl: string;
  correctedImageUrls: string[];
  supportTeamName?: string;
  supportEmail?: string;
}

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
  static generateCorrectionEmail(_data: TemplateData): EmailTemplate {
    const subject = "Your Revised Sticker is Here!";
    
    const body = `Hey there!<br><br>

Thank you for purchasing a sticker from MakeMeASticker.com! We heard your feedback and have attached a revised sticker for you.<br><br>

If you have any questions or have any suggestions to make our product better, we're happy to help!<br><br>

Best regards,<br>
Alan & MakeMeASticker.com<br><br>`;

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
  static generateCreditEmail(_data: TemplateData): EmailTemplate {
    const subject = "We've Added a Free Credit to Your Account";
    const body = `Hey there!<br><br>

We're sorry we couldn't fix your sticker this time. We've added a free credit to your account.<br><br>

If you have any questions or suggestions to make our product better, we're happy to help!<br><br>

Best regards,<br>
Alan & MakeMeASticker.com<br><br>`;

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
    if (!data.feedback) {
      errors.push('feedback is required');
    }
    if (!data.correctionType) {
      errors.push('correctionType is required');
    }
    if (!data.originalImageUrl) {
      errors.push('originalImageUrl is required');
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
