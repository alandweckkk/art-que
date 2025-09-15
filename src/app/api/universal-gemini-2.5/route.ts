import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    console.log('🎯 Universal Gemini 2.5 API called');
    
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

    console.log('📝 Processing Universal Gemini 2.5 request:');
    console.log('   - Prompt:', prompt);
    console.log('   - Image URLs:', imageUrls);

    // Prepare form data for the universal API call
    const universalFormData = new FormData();
    universalFormData.append('tool', 'gemini');
    universalFormData.append('prompt', prompt);
    universalFormData.append('imageUrls', imageUrls.join(','));

    console.log('🚀 Making request to universal API...');
    
    // Make the CURL equivalent request to the universal API
    const universalResponse = await fetch('https://tools.makemeasticker.com/api/universal', {
      method: 'POST',
      body: universalFormData,
    });

    if (!universalResponse.ok) {
      console.error('❌ Universal API request failed:', universalResponse.status, universalResponse.statusText);
      return NextResponse.json({ 
        error: `Universal API request failed: ${universalResponse.status} ${universalResponse.statusText}` 
      }, { status: universalResponse.status });
    }

    const universalResult = await universalResponse.json();
    console.log('✅ Universal API response received:', universalResult);

    if (!universalResult.image) {
      console.error('❌ No image in universal API response');
      return NextResponse.json({ 
        error: 'No image returned from universal API' 
      }, { status: 500 });
    }

    console.log('✅ Universal Gemini 2.5 completed successfully');

    return NextResponse.json({
      success: true,
      data: {
        image: universalResult.image,
        originalPrompt: prompt,
        inputImageUrls: imageUrls
      }
    });

  } catch (error) {
    console.error('💥 Error in Universal Gemini 2.5 API:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 });
  }
}
