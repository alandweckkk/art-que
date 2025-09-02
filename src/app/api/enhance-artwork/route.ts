import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { model_run_id } = await request.json();
    
    if (!model_run_id) {
      return NextResponse.json(
        { error: 'Missing required parameter: model_run_id' },
        { status: 400 }
      );
    }

    console.log(`🎯 Processing model_run_id: ${model_run_id}`);

    // Check if record already exists
    const { data: existingRecord, error: checkError } = await supabase
      .from('y_sticker_edits')
      .select('id')
      .eq('model_run_id', model_run_id)
      .single();

    if (existingRecord) {
      return NextResponse.json({
        message: 'Record already exists, skipping',
        record_id: existingRecord.id
      });
    }

    // Get model run data to access feedback_notes and preprocessed_output_image_url
    console.log('📋 Fetching model run data...');
    const { data: modelRunData, error: modelRunError } = await supabase
      .from('model_run')
      .select('feedback_notes, preprocessed_output_image_url, input_image_url, output_image_url')
      .eq('id', model_run_id)
      .single();

    if (modelRunError || !modelRunData?.feedback_notes || !modelRunData?.preprocessed_output_image_url) {
      return NextResponse.json(
        { error: 'Failed to fetch model run data or missing required fields' },
        { status: 400 }
      );
    }

    console.log('📝 Original feedback:', modelRunData.feedback_notes);
    console.log('🖼️ Image URL:', modelRunData.preprocessed_output_image_url);

    // Create initial record
    const { data: insertedRecord, error: insertError } = await supabase
      .from('y_sticker_edits')
      .insert({
        model_run_id,
        status: 'processing',
        metadata: {
          revision: 1,
          setup: 'enhanced_with_gpt_and_gemini',
          original_feedback: modelRunData.feedback_notes,
          original_input_image_url: modelRunData.input_image_url,
          original_output_image_url: modelRunData.output_image_url,
          original_preprocessed_image_url: modelRunData.preprocessed_output_image_url
        },
        image_history: []
      })
      .select('id')
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: 'Failed to create record' },
        { status: 500 }
      );
    }

    console.log(`✅ Created y_sticker_edits record: ${insertedRecord.id}`);

    try {
      // Step 1: Enhance feedback with GPT-5
      console.log('🤖 Enhancing feedback with GPT-5...');
      const gptResponse = await fetch('http://localhost:3000/api/gpt-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: modelRunData.feedback_notes,
          instructions: 'enhance this user prompt so it is clearer and longer',
          verbosity: 'medium'
        })
      });

      if (!gptResponse.ok) {
        throw new Error(`GPT API failed: ${gptResponse.status}`);
      }

      const gptData = await gptResponse.json();
      if (!gptData.success || !gptData.response) {
        throw new Error('Invalid GPT response');
      }

      const enhancedFeedback = gptData.response;
      console.log('✨ Enhanced feedback:', enhancedFeedback);

      // Step 2: Generate improved image with Gemini
      console.log('🎨 Generating improved image with Gemini...');
      const geminiFormData = new FormData();
      geminiFormData.append('prompt', enhancedFeedback);
      geminiFormData.append('image_urls', modelRunData.preprocessed_output_image_url);
      geminiFormData.append('num_images', '1');
      geminiFormData.append('output_format', 'png');

      const geminiResponse = await fetch('http://localhost:3000/api/gemini-25-edit', {
        method: 'POST',
        body: geminiFormData
      });

      if (!geminiResponse.ok) {
        throw new Error(`Gemini API failed: ${geminiResponse.status}`);
      }

      const geminiData = await geminiResponse.json();
      if (!geminiData.success || !geminiData.data?.images?.[0]?.url) {
        throw new Error('Invalid Gemini response or no images generated');
      }

      const generatedImageUrl = geminiData.data.images[0].url;
      console.log('🖼️ Generated image URL:', generatedImageUrl);

      // Step 3: Update record with generated image
      const { error: updateError } = await supabase
        .from('y_sticker_edits')
        .update({
          status: 'completed',
          image_history: [generatedImageUrl],
          metadata: {
            revision: 1,
            setup: 'enhanced_with_gpt_and_gemini',
            original_feedback: modelRunData.feedback_notes,
            original_input_image_url: modelRunData.input_image_url,
            original_output_image_url: modelRunData.output_image_url,
            original_preprocessed_image_url: modelRunData.preprocessed_output_image_url,
            enhanced_feedback: enhancedFeedback,
            generated_at: new Date().toISOString(),
            processing_success: true
          }
        })
        .eq('id', insertedRecord.id);

      if (updateError) {
        throw new Error('Failed to update record with generated image');
      }

      console.log('🎉 Successfully completed processing!');
      
      return NextResponse.json({
        success: true,
        record_id: insertedRecord.id,
        model_run_id,
        original_feedback: modelRunData.feedback_notes,
        enhanced_feedback: enhancedFeedback,
        generated_image_url: generatedImageUrl,
        message: 'Processing completed successfully'
      });

    } catch (processingError) {
      console.error('Processing error:', processingError);
      
      // Update record as failed
      await supabase
        .from('y_sticker_edits')
        .update({
          status: 'failed',
                  metadata: {
          revision: 1,
          setup: 'enhanced_with_gpt_and_gemini',
          original_feedback: modelRunData.feedback_notes,
          original_input_image_url: modelRunData.input_image_url,
          original_output_image_url: modelRunData.output_image_url,
          original_preprocessed_image_url: modelRunData.preprocessed_output_image_url,
          error: processingError instanceof Error ? processingError.message : 'Unknown processing error',
          failed_at: new Date().toISOString()
        }
        })
        .eq('id', insertedRecord.id);

      return NextResponse.json({
        error: 'Processing failed',
        details: processingError instanceof Error ? processingError.message : 'Unknown error',
        record_id: insertedRecord.id
      }, { status: 500 });
    }

  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
