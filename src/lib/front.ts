interface FrontConfig {
  apiToken: string;
  channelId: string;
  inboxId?: string;
  baseUrl?: string;
}

interface FrontAttachment {
  filename: string;
  content_type: string;
  content: string; // base64 encoded
}

interface FrontEmailData {
  to: string[];
  subject: string;
  body: string;
  body_format: 'html' | 'text';
  attachments?: FrontAttachment[];
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

    if (method !== 'GET' && data) {
      headers['Content-Type'] = 'application/json';
    }

    console.log(`🌐 Front API ${method} ${url}`);
    
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined
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

  async prepareImageAttachment(imageUrl: string, filename: string): Promise<FrontAttachment | null> {
    try {
      console.log(`📥 Downloading image for attachment: ${imageUrl.substring(0, 50)}...`);
      
      const response = await fetch(imageUrl);
      if (!response.ok) {
        console.error(`❌ Failed to download image: HTTP ${response.status}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64Content = Buffer.from(arrayBuffer).toString('base64');
      
      // Determine content type from URL or default to PNG
      let contentType = 'image/png';
      if (imageUrl.includes('.jpg') || imageUrl.includes('.jpeg')) {
        contentType = 'image/jpeg';
      } else if (imageUrl.includes('.gif')) {
        contentType = 'image/gif';
      } else if (imageUrl.includes('.webp')) {
        contentType = 'image/webp';
      }

      console.log(`✅ Image attachment prepared: ${filename} (${arrayBuffer.byteLength} bytes, ${contentType})`);

      return {
        filename,
        content_type: contentType,
        content: base64Content
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

      const payload = {
        to: emailData.to,
        subject: emailData.subject,
        body: emailData.body,
        body_format: emailData.body_format,
        ...(emailData.attachments && { attachments: emailData.attachments })
      };

      const response = await this.makeRequest(
        `/channels/${this.config.channelId}/messages`,
        'POST',
        payload
      ) as { id: string; uid: string };

      return {
        success: true,
        message_id: response.id,
        message_uid: response.uid,
        details: response
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

      // For drafts, we create a draft message in the channel
      const payload = {
        to: emailData.to,
        subject: emailData.subject,
        body: emailData.body,
        body_format: emailData.body_format,
        is_draft: true,
        ...(emailData.attachments && { attachments: emailData.attachments })
      };

      const response = await this.makeRequest(
        `/channels/${this.config.channelId}/drafts`,
        'POST',
        payload
      ) as { id: string; uid: string };

      return {
        success: true,
        message_id: response.id,
        message_uid: response.uid,
        details: response
      };
    } catch (error) {
      console.error('💥 Error creating Front draft:', error);
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
