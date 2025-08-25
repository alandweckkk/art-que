import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

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

    // Prepare image on a white background the same size as the image
    console.log('🎨 Preparing image on white background...');
    let flattenedImageUrl = imageUrl;
    try {
      const imgResp = await fetch(imageUrl);
      if (!imgResp.ok) throw new Error(`Failed to download image: ${imgResp.status}`);
      const imgBuffer = Buffer.from(await imgResp.arrayBuffer());

      // Lazy import sharp to avoid bundling issues
      const sharp = (await import('sharp')).default;
      const flattenedBuffer = await sharp(imgBuffer)
        .flatten({ background: '#ffffff' }) // ensure white background where transparent
        .png()
        .toBuffer();

      const flatFilename = `kontext-flat-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      const flatBlob = await put(flatFilename, flattenedBuffer, {
        access: 'public',
        contentType: 'image/png',
      });
      flattenedImageUrl = flatBlob.url;
      console.log('✅ Flattened image uploaded to:', flattenedImageUrl);
    } catch (e) {
      console.warn('⚠️ Could not flatten image, proceeding with original URL:', e);
    }

    // Prepare Fal.AI API request for FLUX Kontext LoRA inpainting
    const falApiKey = process.env.FAL_KEY;
    if (!falApiKey) {
      console.error('❌ FAL_KEY environment variable not set');
      return NextResponse.json({ 
        error: 'FAL_KEY environment variable not configured' 
      }, { status: 500 });
    }

    const falPayload = {
      image_url: flattenedImageUrl,
      prompt: prompt,
      reference_image_url: flattenedImageUrl, // use flattened image as reference too
      mask_url: maskBlob.url,
      num_inference_steps: 30,
      guidance_scale: 2.5,
      num_images: 1,
      enable_safety_checker: true,
      output_format: "png",
      acceleration: "none",
      strength: 0.88,
      loras: []
    };

    console.log('🚀 Calling FLUX Kontext LoRA inpainting API...');
    
    // Print the EXACT API call being made to Fal.AI
    console.log('📞 EXACT FAL.AI API CALL:');
    console.log('🎯 URL:', 'https://fal.run/fal-ai/flux-kontext-lora/inpaint');
    console.log('🎯 Method:', 'POST');
    console.log('🎯 PAYLOAD:');
    console.log(JSON.stringify(falPayload, null, 2));
    console.log('🎯 Key URLs:');
    console.log('   - Image URL:', falPayload.image_url);
    console.log('   - Reference URL:', falPayload.reference_image_url);
    console.log('   - Mask URL:', falPayload.mask_url);

    // Call Fal.AI API - Using the correct FLUX Kontext LoRA inpainting endpoint
    const falResponse = await fetch('https://fal.run/fal-ai/flux-kontext-lora/inpaint', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(falPayload),
    });

    console.log('📡 Fal.AI response status:', falResponse.status);
    console.log('📡 Response headers:', Object.fromEntries(falResponse.headers.entries()));

    if (!falResponse.ok) {
      const errorText = await falResponse.text();
      console.error('❌ Fal.AI API error:', errorText);
      
      let errorMessage = `Fal.AI API error (${falResponse.status})`;
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.detail) {
          errorMessage = errorData.detail;
        } else if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch {
        if (errorText) {
          errorMessage = errorText;
        }
      }
      
      return NextResponse.json({ error: errorMessage }, { status: falResponse.status });
    }

    const falResult = await falResponse.json();
    console.log('✅ Fal.AI response received');
    console.log('📊 COMPLETE API RESPONSE:', JSON.stringify(falResult, null, 2));

    if (!falResult.images || falResult.images.length === 0) {
      console.error('❌ No images in Fal.AI response');
      return NextResponse.json({ 
        error: 'No images returned from Fal.AI API' 
      }, { status: 500 });
    }

    const processedImageUrl = falResult.images[0].url;
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
        seed: falResult.seed,
        hasNsfwConcepts: falResult.has_nsfw_concepts,
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

