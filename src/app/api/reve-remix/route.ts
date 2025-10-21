import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { fal } from '@fal-ai/client';
import { createClient } from '@supabase/supabase-js';
import { processImageBuffer } from '../postprocess-image/route';

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
  const nodeId = formData.get('nodeId') as string || 'r-1';
  const generationId = formData.get('generationId') as string;
  
  try {
    console.log('🎯 FAL Reve Remix API called');

    if (!prompt) {
      console.error('❌ Missing prompt parameter');
      return NextResponse.json({ 
        error: 'Missing required parameter: prompt is required' 
      }, { status: 400 });
    }

    if (imageUrls.length === 0) {
      console.error('❌ No image URLs provided');
      return NextResponse.json({ 
        error: 'At least one image URL is required (1-4 images supported)' 
      }, { status: 400 });
    }

    if (imageUrls.length > 4) {
      console.error('❌ Too many image URLs provided');
      return NextResponse.json({ 
        error: 'Maximum of 4 images supported' 
      }, { status: 400 });
    }

    console.log('📝 Processing Reve Remix request:');
    console.log('   - Prompt:', prompt);
    console.log('   - Image URLs:', imageUrls);
    console.log('   - Number of images:', imageUrls.length);

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
      output_format: 'png' as const,
    };

    console.log('🚀 Submitting Reve Remix request...');
    console.log('📞 FAL.AI REQUEST:');
    console.log('🎯 Model:', 'fal-ai/reve/remix');
    console.log('🎯 INPUT:');
    console.log(JSON.stringify(falInput, null, 2));

    // Submit the request using fal client
    const result = await fal.subscribe('fal-ai/reve/remix', {
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

    // Download and post-process before uploading to our blob storage
    console.log('📥 Downloading generated image...');
    const imageResponse = await fetch(generatedImageUrl);
    if (!imageResponse.ok) {
      console.error('❌ Failed to download generated image');
      return NextResponse.json({ 
        error: 'Failed to download generated image' 
      }, { status: 500 });
    }

    const rawImageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    
    // Post-process with sticker pipeline (BG removal + border + cleanup)
    console.log('🎨 Post-processing with sticker pipeline...');
    const processedBuffer = await processImageBuffer(rawImageBuffer, {
      skipBackgroundRemoval: false,  // Remove background first
      useAdvancedProcessing: true    // Then apply border, centering, cleanup
    });
    
    // Upload post-processed image to our blob storage
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `reve-remix-${timestamp}.png`;

    console.log('📤 Uploading processed sticker to blob storage...');
    const blob = await put(filename, processedBuffer, {
      access: 'public',
      contentType: 'image/png',
    });

    console.log('✅ Successfully uploaded sticker to blob storage:', blob.url);

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
        prompt: prompt,
        inputImageUrls: imageUrls
      }
    });

  } catch (error) {
    console.error('❌ FAL Reve Remix API error:', error);
    
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



