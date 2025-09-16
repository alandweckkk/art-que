import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { fal } from '@fal-ai/client';

export async function POST(request: NextRequest) {
  try {
    console.log('🎯 SeeDream v4 Edit API called');
    
    const formData = await request.formData();
    const prompt = formData.get('prompt') as string;
    const imageUrls = formData.getAll('imageUrls') as string[];

    if (!prompt) {
      console.error('❌ Missing prompt parameter');
      return NextResponse.json({ 
        error: 'Missing required parameter: prompt is required' 
      }, { status: 400 });
    }

    if (imageUrls.length === 0) {
      console.error('❌ No image URLs provided');
      return NextResponse.json({ 
        error: 'At least one image URL is required for SeeDream edit' 
      }, { status: 400 });
    }

    console.log('📝 Processing SeeDream v4 Edit request with prompt:', prompt);
    console.log('🖼️ Image URLs count:', imageUrls.length);

    // Get FAL API key from environment
    const falApiKey = process.env.FAL_KEY;
    if (!falApiKey) {
      console.error('❌ FAL_KEY environment variable not set');
      return NextResponse.json({ 
        error: 'FAL API key not configured' 
      }, { status: 500 });
    }

    // Configure fal client with API key
    fal.config({
      credentials: falApiKey,
    });

    const falInput = {
      image_urls: imageUrls, // SeeDream accepts multiple images
      prompt: prompt,
    };

    console.log('🚀 Submitting SeeDream v4 Edit request...');
    console.log('📞 FAL.AI REQUEST:');
    console.log('🎯 Model:', 'fal-ai/bytedance/seedream/v4/edit');
    console.log('🎯 INPUT:');
    console.log(JSON.stringify(falInput, null, 2));

    // Submit the request using fal client
    const result = await fal.subscribe('fal-ai/bytedance/seedream/v4/edit', {
      input: falInput,
      logs: true,
      onQueueUpdate: (update) => {
        console.log('📊 Queue update:', update.status);
        if ('logs' in update && update.logs) {
          update.logs.forEach((log: { message: string }) => console.log('📝 Log:', log.message));
        }
      }
    });

    console.log('✅ Fal.AI response received');
    console.log('📊 COMPLETE API RESPONSE:', JSON.stringify(result, null, 2));

    if (!result.data || !result.data.images || result.data.images.length === 0) {
      console.error('❌ No images in Fal.AI response');
      return NextResponse.json({ 
        error: 'No images returned from Fal.AI API' 
      }, { status: 500 });
    }

    const generatedImageUrl = result.data.images[0].url;
    console.log('🖼️ Generated image URL:', generatedImageUrl);

    // Download and re-upload to our blob storage for consistency
    console.log('📥 Downloading generated image...');
    const imageResponse = await fetch(generatedImageUrl);
    if (!imageResponse.ok) {
      console.error('❌ Failed to download generated image');
      return NextResponse.json({ 
        error: 'Failed to download generated image' 
      }, { status: 500 });
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    
    // Upload to our blob storage
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `seedream-edit-${timestamp}.png`;

    console.log('📤 Uploading to blob storage...');
    const blob = await put(filename, imageBuffer, {
      access: 'public',
      contentType: 'image/png',
    });

    console.log('✅ Successfully uploaded to blob storage:', blob.url);

    return NextResponse.json({ 
      success: true,
      data: {
        imageUrl: blob.url,
        originalUrl: generatedImageUrl,
        prompt: prompt,
        inputImageUrls: imageUrls
      }
    });

  } catch (error) {
    console.error('❌ SeeDream v4 Edit API error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
