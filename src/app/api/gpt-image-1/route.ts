import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    console.log('🎯 OpenAI GPT Image API called');
    
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
        error: 'At least one image URL is required' 
      }, { status: 400 });
    }

    if (imageUrls.length > 6) {
      console.error('❌ Too many image URLs provided');
      return NextResponse.json({ 
        error: 'GPT Image tool supports maximum 6 images' 
      }, { status: 400 });
    }

    console.log('📝 Processing OpenAI GPT Image request:');
    console.log('   - Prompt:', prompt);
    console.log('   - Image URLs:', imageUrls);

    // Prepare form data for the Universal API call
    const universalFormData = new FormData();
    universalFormData.append('tool', 'gpt-image-1');
    universalFormData.append('prompt', prompt);
    universalFormData.append('imageUrls', imageUrls.join(','));
    universalFormData.append('debug', 'true'); // Enable debug for better error info

    console.log('🚀 Making request to Universal API...');
    
    // Make the request to the Universal API
    const universalResponse = await fetch('https://tools.makemeasticker.com/api/universal', {
      method: 'POST',
      body: universalFormData,
    });

    const universalResult = await universalResponse.json();
    console.log('✅ Universal API response received:', universalResult);

    if (!universalResponse.ok || universalResult.error) {
      const errorMsg = universalResult.error || `HTTP ${universalResponse.status}: Failed to process with GPT Image 1`
      console.error('❌ Universal API error:', errorMsg);
      if (universalResult.debugInfo) {
        console.error('❌ Debug info:', universalResult.debugInfo);
      }
      return NextResponse.json({ 
        error: errorMsg
      }, { status: universalResponse.status });
    }

    if (!universalResult.image && !universalResult.processedImageUrl) {
      console.error('❌ No image in Universal API response');
      return NextResponse.json({ 
        error: 'No image returned from Universal API' 
      }, { status: 500 });
    }

    const resultImageUrl = universalResult.image || universalResult.processedImageUrl;
    console.log('✅ OpenAI GPT Image completed successfully:', resultImageUrl);

    return NextResponse.json({
      success: true,
      data: {
        image: resultImageUrl,
        originalPrompt: prompt,
        inputImageUrls: imageUrls
      }
    });

  } catch (error) {
    console.error('💥 Error in OpenAI GPT Image API:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 });
  }
}