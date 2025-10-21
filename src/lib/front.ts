interface FrontConfig {
  apiToken: string;
  channelId: string;
  inboxId?: string;
  baseUrl?: string;
}

// Internal representation for prepared attachments used when constructing multipart/form-data
interface PreparedAttachment {
  filename: string;
  contentType: string;
  data: Buffer;
}

interface FrontEmailData {
  to: string[];
  subject: string;
  body: string;
  body_format: 'html' | 'text';
  attachments?: PreparedAttachment[];
  metadata?: Record<string, any>;
}

interface FrontReplyData {
  body: string;
  body_format: 'html' | 'text';
  attachments?: PreparedAttachment[];
  metadata?: Record<string, any>;
}

interface FrontApiResponse {
  success: boolean;
  message_id?: string;
  message_uid?: string;
  error?: string;
  details?: unknown;
}

export default class FrontAPIClient {
  private config: FrontConfig;

  constructor() {
    const apiToken = process.env.FRONT_API_TOKEN;
    const channelId = process.env.FRONT_CHANNEL_ID;
    const inboxId = process.env.FRONT_INBOX_ID;

    if (!apiToken) {
      throw new Error('FRONT_API_TOKEN environment variable is required');
    }
    if (!channelId) {
      throw new Error('FRONT_CHANNEL_ID environment variable is required');
    }

    this.config = {
      apiToken,
      channelId,
      inboxId,
      baseUrl: 'https://api2.frontapp.com'
    };
  }

  private async makeRequest(
    endpoint: string, 
    method: 'GET' | 'POST' | 'PATCH' = 'GET', 
    data?: unknown
  ): Promise<unknown> {
    const url = `${this.config.baseUrl}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiToken}`,
      'Accept': 'application/json'
    };

    // Only set JSON content type when sending JSON (not FormData)
    if (method !== 'GET' && data && !(typeof FormData !== 'undefined' && data instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    console.log(`🌐 Front API ${method} ${url}`);
    
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: data
          ? (typeof FormData !== 'undefined' && data instanceof FormData)
            ? (data as unknown as FormData)
            : JSON.stringify(data)
          : undefined
      });

      const responseText = await response.text();
      let responseData: unknown;
      
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { raw: responseText };
      }

      console.log(`📊 Front API Response [${response.status}]:`, responseData);

      if (!response.ok) {
        const errorData = responseData as { message?: string; error?: string } | { raw: string };
        const errorMessage = 'message' in errorData ? errorData.message : 
                            'error' in errorData ? errorData.error : 
                            'raw' in errorData ? errorData.raw : 
                            responseText || 'Unknown error';
        throw new Error(`Front API error ${response.status}: ${errorMessage}`);
      }

      return responseData;
    } catch (error) {
      console.error('💥 Front API request failed:', error);
      throw error;
    }
  }

  async prepareImageAttachment(imageUrl: string, filename: string): Promise<PreparedAttachment | null> {
    try {
      // Handle data URLs directly
      if (imageUrl.startsWith('data:')) {
        const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) {
          console.warn('⚠️ Unsupported data URL format for attachment');
          return null;
        }
        const contentType = match[1] || 'image/png';
        const base64Part = match[2];
        const dataBuffer = Buffer.from(base64Part, 'base64');

        // 25MB limit
        const maxBytes = 25 * 1024 * 1024;
        if (dataBuffer.byteLength > maxBytes) {
          console.warn(`⚠️ Attachment exceeds 25MB (${dataBuffer.byteLength} bytes): ${filename}`);
          return null;
        }

        console.log(`✅ Data URL attachment prepared: ${filename} (${dataBuffer.byteLength} bytes, ${contentType})`);
        return {
          filename,
          contentType,
          data: dataBuffer
        };
      }

      if (imageUrl.startsWith('blob:')) {
        console.warn('⚠️ Cannot fetch blob: URLs server-side. Upload to public URL first.');
        return null;
      }

      console.log(`📥 Downloading image for attachment: ${imageUrl.substring(0, 50)}...`);

      const response = await fetch(imageUrl);
      if (!response.ok) {
        console.error(`❌ Failed to download image: HTTP ${response.status}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const dataBuffer = Buffer.from(arrayBuffer);

      // 25MB limit
      const maxBytes = 25 * 1024 * 1024;
      if (dataBuffer.byteLength > maxBytes) {
        console.warn(`⚠️ Attachment exceeds 25MB (${dataBuffer.byteLength} bytes): ${filename}`);
        return null;
      }

      // Determine content type from URL or default to PNG
      let contentType = 'image/png';
      if (imageUrl.includes('.jpg') || imageUrl.includes('.jpeg')) {
        contentType = 'image/jpeg';
      } else if (imageUrl.includes('.gif')) {
        contentType = 'image/gif';
      } else if (imageUrl.includes('.webp')) {
        contentType = 'image/webp';
      }

      console.log(`✅ Image attachment prepared: ${filename} (${dataBuffer.byteLength} bytes, ${contentType})`);

      return {
        filename,
        contentType,
        data: dataBuffer
      };
    } catch (error) {
      console.error(`💥 Error preparing image attachment for ${imageUrl}:`, error);
      return null;
    }
  }

  async sendMessage(emailData: FrontEmailData): Promise<FrontApiResponse> {
    try {
      console.log('📤 Sending Front message...');
      console.log('📧 Email data:', {
        to: emailData.to,
        subject: emailData.subject,
        bodyLength: emailData.body.length,
        attachments: emailData.attachments?.length || 0
      });

      let responseData: { id: string; uid: string };
      if (emailData.attachments && emailData.attachments.length > 0) {
        // Use multipart/form-data when attachments are present
        const formData = new FormData();
        emailData.to.forEach(to => formData.append('to[]', to));
        formData.append('subject', emailData.subject);
        formData.append('body', emailData.body);
        formData.append('body_format', emailData.body_format);

        // Add metadata if provided
        if (emailData.metadata) {
          formData.append('metadata', JSON.stringify(emailData.metadata));
        }

        for (const attachment of emailData.attachments) {
          const uint8 = new Uint8Array(attachment.data);
          const blob = new Blob([uint8], { type: attachment.contentType });
          // Use attachments[] as field name per Front docs
          formData.append('attachments[]', blob, attachment.filename);
        }

        responseData = await this.makeRequest(
          `/channels/${this.config.channelId}/messages`,
          'POST',
          formData
        ) as { id: string; uid: string };
      } else {
        // JSON path without attachments
        const payload: any = {
          to: emailData.to,
          subject: emailData.subject,
          body: emailData.body,
          body_format: emailData.body_format
        };

        // Add metadata if provided
        if (emailData.metadata) {
          payload.metadata = emailData.metadata;
        }

        responseData = await this.makeRequest(
          `/channels/${this.config.channelId}/messages`,
          'POST',
          payload
        ) as { id: string; uid: string };
      }

      return {
        success: true,
        message_id: responseData.id,
        message_uid: responseData.uid,
        details: responseData
      };
    } catch (error) {
      console.error('💥 Error sending Front message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async createDraft(emailData: FrontEmailData): Promise<FrontApiResponse> {
    try {
      console.log('📝 Creating Front draft...');
      console.log('📧 Draft data:', {
        to: emailData.to,
        subject: emailData.subject,
        bodyLength: emailData.body.length,
        attachments: emailData.attachments?.length || 0
      });

      let responseData: { id: string; uid: string };
      if (emailData.attachments && emailData.attachments.length > 0) {
        // multipart/form-data for drafts with attachments
        const formData = new FormData();
        emailData.to.forEach(to => formData.append('to[]', to));
        formData.append('subject', emailData.subject);
        formData.append('body', emailData.body);
        formData.append('body_format', emailData.body_format);
        formData.append('is_draft', 'true');

        // Add metadata if provided
        if (emailData.metadata) {
          formData.append('metadata', JSON.stringify(emailData.metadata));
        }

        for (const attachment of emailData.attachments) {
          const uint8 = new Uint8Array(attachment.data);
          const blob = new Blob([uint8], { type: attachment.contentType });
          formData.append('attachments[]', blob, attachment.filename);
        }

        responseData = await this.makeRequest(
          `/channels/${this.config.channelId}/drafts`,
          'POST',
          formData
        ) as { id: string; uid: string };
      } else {
        // JSON path without attachments
        const payload: any = {
          to: emailData.to,
          subject: emailData.subject,
          body: emailData.body,
          body_format: emailData.body_format,
          is_draft: true
        };

        // Add metadata if provided
        if (emailData.metadata) {
          payload.metadata = emailData.metadata;
        }

        responseData = await this.makeRequest(
          `/channels/${this.config.channelId}/drafts`,
          'POST',
          payload
        ) as { id: string; uid: string };
      }

      return {
        success: true,
        message_id: responseData.id,
        message_uid: responseData.uid,
        details: responseData
      };
    } catch (error) {
      console.error('💥 Error creating Front draft:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async replyToConversation(conversationId: string, replyData: FrontReplyData): Promise<FrontApiResponse> {
    try {
      console.log('💬 Replying to Front conversation...');
      console.log('📧 Reply data:', {
        conversationId,
        bodyLength: replyData.body.length,
        attachments: replyData.attachments?.length || 0
      });

      let responseData: { id: string; uid: string };
      if (replyData.attachments && replyData.attachments.length > 0) {
        // Use multipart/form-data when attachments are present
        const formData = new FormData();
        formData.append('body', replyData.body);
        formData.append('body_format', replyData.body_format);

        // Add metadata if provided
        if (replyData.metadata) {
          formData.append('metadata', JSON.stringify(replyData.metadata));
        }

        for (const attachment of replyData.attachments) {
          const uint8 = new Uint8Array(attachment.data);
          const blob = new Blob([uint8], { type: attachment.contentType });
          formData.append('attachments[]', blob, attachment.filename);
        }

        responseData = await this.makeRequest(
          `/conversations/${conversationId}/messages`,
          'POST',
          formData
        ) as { id: string; uid: string };
      } else {
        // JSON path without attachments
        const payload: any = {
          body: replyData.body,
          body_format: replyData.body_format
        };

        // Add metadata if provided
        if (replyData.metadata) {
          payload.metadata = replyData.metadata;
        }

        responseData = await this.makeRequest(
          `/conversations/${conversationId}/messages`,
          'POST',
          payload
        ) as { id: string; uid: string };
      }

      return {
        success: true,
        message_id: responseData.id,
        message_uid: responseData.uid,
        details: responseData
      };
    } catch (error) {
      console.error('💥 Error replying to Front conversation:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string; details?: unknown }> {
    try {
      console.log('🔍 Testing Front API connection...');
      
      const response = await this.makeRequest('/me');
      
      console.log('✅ Front API connection successful');
      return {
        success: true,
        details: response
      };
    } catch (error) {
      console.error('❌ Front API connection failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed'
      };
    }
  }
}
