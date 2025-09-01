import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { fal } from '@fal-ai/client';

export async function POST(request: NextRequest) {
  try {
    console.log('🎯 Gemini 2.5 Flash Image editing API called');
    
    const formData = await request.formData();
    const prompt = formData.get('prompt') as string;
    const imageFiles = formData.getAll('images') as File[];
    const imageUrls = formData.getAll('image_urls') as string[];
    const numImages = parseInt(formData.get('num_images') as string) || 1;
    const outputFormat = (formData.get('output_format') as string) || 'jpeg';

    if (!prompt) {
      console.error('❌ Missing prompt parameter');
      return NextResponse.json({ 
        error: 'Missing required parameter: prompt is required' 
      }, { status: 400 });
    }

    // Need at least one image (either files or URLs)
    if (imageFiles.length === 0 && imageUrls.length === 0) {
      console.error('❌ No images provided');
      return NextResponse.json({ 
        error: 'At least one image is required (either file upload or URL)' 
      }, { status: 400 });
    }

    console.log('📝 Processing Gemini 2.5 Flash Image editing request:');
    console.log('   - Prompt:', prompt);
    console.log('   - Image files:', imageFiles.length);
    console.log('   - Image URLs:', imageUrls.length);
    console.log('   - Number of images to generate:', numImages);
    console.log('   - Output format:', outputFormat);

    // Prepare image URLs array
    const allImageUrls: string[] = [...imageUrls];

    // Upload any image files to blob storage and add their URLs
    if (imageFiles.length > 0) {
      console.log('📤 Uploading image files to blob storage...');
      
      for (const [index, imageFile] of imageFiles.entries()) {
        console.log(`📤 Uploading image ${index + 1}/${imageFiles.length}:`, imageFile.name, `(${imageFile.size} bytes)`);
        
        const imageArrayBuffer = await imageFile.arrayBuffer();
        const imageBuffer = Buffer.from(imageArrayBuffer);
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `gemini-input-${timestamp}-${index}.${imageFile.type.split('/')[1] || 'png'}`;

        const imageBlob = await put(filename, imageBuffer, {
          access: 'public',
          contentType: imageFile.type,
        });

        allImageUrls.push(imageBlob.url);
        console.log(`✅ Image ${index + 1} uploaded to:`, imageBlob.url);
      }
    }

    if (allImageUrls.length === 0) {
      console.error('❌ No valid image URLs after processing');
      return NextResponse.json({ 
        error: 'No valid images could be processed' 
      }, { status: 400 });
    }

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
      prompt: prompt,
      image_urls: allImageUrls,
      num_images: numImages,
      output_format: outputFormat as "jpeg" | "png",
      sync_mode: false, // Use URLs instead of data URIs for better performance
    };

    console.log('🚀 Submitting Gemini 2.5 Flash Image editing request...');
    console.log('📞 FAL.AI REQUEST:');
    console.log('🎯 Model:', 'fal-ai/gemini-25-flash-image/edit');
    console.log('🎯 INPUT:');
    console.log(JSON.stringify(falInput, null, 2));

    // Submit the request using fal client
    const result = await fal.subscribe('fal-ai/gemini-25-flash-image/edit', {
      input: falInput,
      logs: true,
      onQueueUpdate: (update) => {
        console.log('📊 Queue update:', update.status);
        if ('logs' in update && update.logs) {
          update.logs.forEach((log: { message: string }) => console.log('📝 Log:', log.message));
        }
      }
    });

    console.log('✅ Gemini 2.5 response received');
    console.log('📊 COMPLETE API RESPONSE:', JSON.stringify(result, null, 2));

    if (!result.data || !result.data.images || result.data.images.length === 0) {
      console.error('❌ No images in Gemini 2.5 response');
      return NextResponse.json({ 
        error: 'No images returned from Gemini 2.5 API' 
      }, { status: 500 });
    }

    // Download and re-upload all generated images to our blob storage for consistency
    const finalImages = [];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    for (const [index, image] of result.data.images.entries()) {
      console.log(`📥 Downloading generated image ${index + 1}/${result.data.images.length}...`);
      
      const imageResponse = await fetch(image.url);
      if (!imageResponse.ok) {
        console.error(`❌ Failed to download generated image ${index + 1}`);
        continue;
      }

      const imageBuffer = await imageResponse.arrayBuffer();
      const filename = `gemini-25-result-${timestamp}-${index}.${outputFormat}`;

      console.log(`📤 Re-uploading image ${index + 1} to our blob storage...`);
      const finalBlob = await put(filename, Buffer.from(imageBuffer), {
        access: 'public',
        contentType: `image/${outputFormat}`,
      });

      finalImages.push({
        url: finalBlob.url,
        filename: filename,
      });

      console.log(`✅ Image ${index + 1} uploaded to:`, finalBlob.url);
    }

    if (finalImages.length === 0) {
      console.error('❌ No images could be processed and uploaded');
      return NextResponse.json({ 
        error: 'Failed to process generated images' 
      }, { status: 500 });
    }

    console.log(`✅ Gemini 2.5 Flash Image editing completed: ${finalImages.length} image(s) generated`);

    return NextResponse.json({
      success: true,
      data: {
        images: finalImages,
        description: result.data.description || '',
        originalPrompt: prompt,
        inputImageUrls: allImageUrls,
        processingDetails: {
          model: 'Gemini 2.5 Flash Image',
          numImages: numImages,
          outputFormat: outputFormat,
          inputImageCount: allImageUrls.length
        }
      }
    });

  } catch (error) {
    console.error('💥 Error in Gemini 2.5 Flash Image editing API:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 });
  }
}
