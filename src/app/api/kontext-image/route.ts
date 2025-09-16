import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { fal } from '@fal-ai/client';

export async function POST(request: NextRequest) {
  try {
    console.log('🎯 FLUX Kontext LoRA inpainting API called');
    
    const formData = await request.formData();
    const imageUrl = formData.get('image_url') as string;
    const prompt = formData.get('prompt') as string;
    const maskFile = formData.get('mask') as File;

    if (!imageUrl || !prompt || !maskFile) {
      console.error('❌ Missing required parameters');
      return NextResponse.json({ 
        error: 'Missing required parameters: image_url, prompt, and mask are required' 
      }, { status: 400 });
    }

    console.log('📝 Processing FLUX Kontext LoRA inpainting request with prompt:', prompt);
    console.log('🖼️ Image URL:', imageUrl);
    console.log('🎭 Mask file size:', maskFile.size, 'bytes');
    console.log('🎭 Mask file type:', maskFile.type);
    
    // Debug: Check if mask actually contains white pixels (inpaint areas)
    if (maskFile.size < 1000) {
      console.warn('⚠️ Mask file is very small, might be empty or mostly transparent');
    }

    // Upload mask to temporary storage to get a URL
    const maskArrayBuffer = await maskFile.arrayBuffer();
    const maskBuffer = Buffer.from(maskArrayBuffer);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const maskFilename = `kontext-mask-${timestamp}.png`;

    console.log('📤 Uploading mask to blob storage...');
    const maskBlob = await put(maskFilename, maskBuffer, {
      access: 'public',
      contentType: 'image/png',
    });

    console.log('✅ Mask uploaded to:', maskBlob.url);
    
    // Debug: Check if mask contains actual white pixels by examining dimensions
    try {
      const maskCheckResponse = await fetch(maskBlob.url);
      const maskCheckBuffer = await maskCheckResponse.arrayBuffer();
      console.log('🔍 Mask verification - buffer size:', maskCheckBuffer.byteLength);
      console.log('🔍 Mask is accessible at URL:', maskBlob.url);
    } catch (error) {
      console.warn('⚠️ Could not verify mask:', error);
    }

    // Use the original image directly without flattening
    console.log('🎨 Using original image without background processing...');
    const flattenedImageUrl = imageUrl;

    // Configure Fal.AI client
    const falApiKey = process.env.FAL_KEY;
    if (!falApiKey) {
      console.error('❌ FAL_KEY environment variable not set');
      return NextResponse.json({ 
        error: 'FAL_KEY environment variable not configured' 
      }, { status: 500 });
    }

    // Configure fal client with API key
    fal.config({
      credentials: falApiKey,
    });

    const falInput = {
      image_url: flattenedImageUrl,
      prompt: prompt,
      reference_image_url: flattenedImageUrl, // use flattened image as reference too
      mask_url: maskBlob.url,
      num_inference_steps: 30,
      guidance_scale: 2.5,
      num_images: 1,
      enable_safety_checker: true,
      output_format: "png" as const,
      strength: 0.88,
    };

    console.log('🚀 Submitting FLUX Kontext LoRA inpainting request...');
    console.log('📞 FAL.AI REQUEST:');
    console.log('🎯 Model:', 'fal-ai/flux-kontext-lora/inpaint');
    console.log('🎯 INPUT:');
    console.log(JSON.stringify(falInput, null, 2));

    // Submit the request using fal client
    const result = await fal.subscribe('fal-ai/flux-kontext-lora/inpaint', {
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

    const processedImageUrl = result.data.images[0].url;
    console.log('🖼️ Processed image URL:', processedImageUrl);

    // Optional: Download and re-upload to our blob storage for consistency
    console.log('📥 Downloading processed image...');
    const imageResponse = await fetch(processedImageUrl);
    if (!imageResponse.ok) {
      console.error('❌ Failed to download processed image');
      return NextResponse.json({ 
        error: 'Failed to download processed image from Fal.AI' 
      }, { status: 500 });
    }

    const processedImageBuffer = await imageResponse.arrayBuffer();
    const processedFilename = `kontext-inpaint-result-${timestamp}.png`;

    console.log('📤 Re-uploading to our blob storage...');
    const finalBlob = await put(processedFilename, Buffer.from(processedImageBuffer), {
      access: 'public',
      contentType: 'image/png',
    });

    console.log(`✅ FLUX Kontext LoRA inpainting completed: ${finalBlob.url}`);

    return NextResponse.json({
      success: true,
      data: {
        imageUrl: finalBlob.url,
        filename: processedFilename,
        originalPrompt: prompt,
        seed: result.data.seed,
        hasNsfwConcepts: result.data.has_nsfw_concepts,
        maskUrl: maskBlob.url, // Include for debugging
        processingDetails: {
          inferenceSteps: 30,
          guidanceScale: 2.5,
          strength: 0.88,
          outputFormat: 'png',
          model: 'FLUX.1 Kontext LoRA',
          acceleration: 'none'
        }
      }
    });

  } catch (error) {
    console.error('💥 Error in FLUX Kontext LoRA inpainting API:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 });
  }
}

