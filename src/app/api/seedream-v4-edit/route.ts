import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { fal } from '@fal-ai/client';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  // Initialize Supabase client using the same vars as lib/supabase.ts
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Supabase environment variables not set');
    console.error('NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl);
    console.error('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY:', !!supabaseKey);
    return NextResponse.json({ 
      error: 'Server configuration error - Supabase not configured' 
    }, { status: 500 });
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  // Parse form data outside try-catch so it's accessible in both blocks
  const formData = await request.formData();
  const prompt = formData.get('prompt') as string;
  const imageUrls = formData.getAll('imageUrls') as string[];
  const modelRunId = formData.get('modelRunId') as string;
  const nodeId = formData.get('nodeId') as string || 's-1';
  const generationId = formData.get('generationId') as string;
  
  try {
    console.log('🎯 FAL Seedream v4 Edit API called');

    if (!prompt) {
      console.error('❌ Missing prompt parameter');
      return NextResponse.json({ 
        error: 'Missing required parameter: prompt is required' 
      }, { status: 400 });
    }

    if (imageUrls.length === 0) {
      console.error('❌ No image URLs provided');
      return NextResponse.json({ 
        error: 'At least one image URL is required for image editing' 
      }, { status: 400 });
    }

    console.log('📝 Processing Seedream v4 Edit request:');
    console.log('   - Prompt:', prompt);
    console.log('   - Image URLs:', imageUrls);

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
      prompt: prompt,
      image_urls: imageUrls,
      num_images: 1,
      enable_safety_checker: false,
    };

    console.log('🚀 Submitting Seedream v4 Edit request...');
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
    const seed = result.data.seed || null;
    console.log('🖼️ Generated image URL:', generatedImageUrl);
    console.log('🎲 Seed:', seed);

    // Download and re-upload to our blob storage
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
    const filename = `seedream-v4-edit-${timestamp}.png`;

    console.log('📤 Uploading to blob storage...');
    const blob = await put(filename, imageBuffer, {
      access: 'public',
      contentType: 'image/png',
    });

    console.log('✅ Successfully uploaded to blob storage:', blob.url);

    // Update the generation status in the database if we have modelRunId and generationId
    if (modelRunId && generationId) {
        console.log(`📝 Updating generation ${generationId} to completed`);
        
        const { error: updateError } = await supabase
          .from('y_sticker_edits_generations')
          .update({
            status: 'completed',
            output_image_url: blob.url,
            completed_at: new Date().toISOString(),
            metadata: {
              originalUrl: generatedImageUrl,
              seed: seed,
              falResponse: result.data
            }
          })
          .eq('generation_id', generationId);
      
      if (updateError) {
        console.error('Error updating generation status:', updateError);
        // Don't fail the request, just log the error
      } else {
        console.log(`✅ Updated generation ${generationId} to completed`);
      }
    }

    return NextResponse.json({ 
      success: true,
      data: {
        imageUrl: blob.url,
        originalUrl: generatedImageUrl,
        seed: seed,
        prompt: prompt,
        inputImageUrls: imageUrls
      }
    });

  } catch (error) {
    console.error('❌ FAL Seedream v4 Edit API error:', error);
    
    // Update the generation status to failed if we have modelRunId and generationId
    if (modelRunId && generationId) {
        console.log(`📝 Updating generation ${generationId} to failed`);
        
        const { error: updateError } = await supabase
          .from('y_sticker_edits_generations')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            metadata: {
              error: error instanceof Error ? error.message : 'Unknown error',
              errorStack: error instanceof Error ? error.stack : undefined
            }
          })
          .eq('generation_id', generationId);
      
      if (updateError) {
        console.error('Error updating generation status to failed:', updateError);
      }
    }
    
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}


