import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!
);

// DEPRECATED: This contains the code from the Gumloop Edge functions that were removed
// These functions are no longer in use but preserved here for reference

export async function POST(request: NextRequest) {
  try {
    const { model_run_id, feedback_notes, preprocessed_output_image_url, version = 'active' } = await request.json();

    if (!model_run_id || !feedback_notes || !preprocessed_output_image_url) {
      return NextResponse.json(
        { error: 'Missing required parameters: model_run_id, feedback_notes, preprocessed_output_image_url' },
        { status: 400 }
      );
    }

    if (version === 'deprecated') {
      // DEPRECATED VERSION: y_artwork_edits-prefenerated-edit-with-gumloop-deprecated
      // This version only creates the record without any processing
      
      // Check if model_run_id already exists in y_sticker_edits
      const { data: existingRecord, error: checkError } = await supabase
        .from('y_sticker_edits')
        .select('id')
        .eq('model_run_id', model_run_id)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Error checking existing record:', checkError);
        return NextResponse.json(
          { error: 'Database check failed' },
          { status: 500 }
        );
      }

      if (existingRecord) {
        console.log('Record already exists for model_run_id:', model_run_id);
        return NextResponse.json({
          message: 'Record already exists, skipping'
        });
      }

      // Insert new record into y_sticker_edits
      const { data: insertedRecord, error: insertError } = await supabase
        .from('y_sticker_edits')
        .insert({
          model_run_id,
          status: 'processing',
          metadata: {
            gumloop: 'started'
          },
          image_history: []
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('Error inserting record:', insertError);
        return NextResponse.json(
          { error: 'Failed to create record' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        message: 'Deprecated function: record created only',
        record_id: insertedRecord.id
      });
    }

    // ACTIVE VERSION: y_artwork_edits-prefenerated-edit-with-gumloop
    // This version includes full Gumloop integration
    
    // Check if model_run_id already exists in y_sticker_edits
    const { data: existingRecord, error: checkError } = await supabase
      .from('y_sticker_edits')
      .select('id')
      .eq('model_run_id', model_run_id)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error checking existing record:', checkError);
      return NextResponse.json(
        { error: 'Database check failed' },
        { status: 500 }
      );
    }

    if (existingRecord) {
      console.log('Record already exists for model_run_id:', model_run_id);
      return NextResponse.json({
        message: 'Record already exists, skipping'
      });
    }

    // Insert new record into y_sticker_edits
    const { data: insertedRecord, error: insertError } = await supabase
      .from('y_sticker_edits')
      .insert({
        model_run_id,
        status: 'processing',
        metadata: {
          gumloop: 'started'
        },
        image_history: []
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Error inserting record:', insertError);
      return NextResponse.json(
        { error: 'Failed to create record' },
        { status: 500 }
      );
    }

    console.log('Created y_sticker_edits record:', insertedRecord.id);

    // Start Gumloop pipeline
    const gumloopResponse = await fetch('https://api.gumloop.com/api/v1/start_pipeline?user_id=jIwZuBctUjgvAWnVrUMvdXt5FFk1&saved_item_id=gtUQhz9svTymNgHgMNFJ66', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer 80a84ea91fc7409abc77863d8f6ab49d'
      },
      body: JSON.stringify({
        image_address_url_1: preprocessed_output_image_url,
        feedback_notes,
        image_address_url_2: '',
        image_address_url_3: '',
        image_address_url_4: '',
        image_address_url_5: ''
      })
    });

    if (!gumloopResponse.ok) {
      console.error('Gumloop API error:', await gumloopResponse.text());
      // Update record as failed
      await supabase
        .from('y_sticker_edits')
        .update({
          status: 'failed',
          metadata: {
            gumloop: 'failed'
          }
        })
        .eq('id', insertedRecord.id);

      return NextResponse.json(
        { error: 'Gumloop API failed' },
        { status: 500 }
      );
    }

    const gumloopData = await gumloopResponse.json();
    const runId = gumloopData.run_id;
    console.log('Started Gumloop pipeline with run_id:', runId);

    // Start polling for completion (async)
    pollGumloopCompletion(insertedRecord.id, runId);

    return NextResponse.json({
      message: 'Processing started',
      record_id: insertedRecord.id,
      run_id: runId
    });

  } catch (error) {
    console.error('Error in Gumloop deprecated API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Async polling function (converted from Edge function)
async function pollGumloopCompletion(recordId: string, runId: string) {
  const startTime = Date.now();
  const timeout = 2 * 60 * 1000; // 2 minutes

  while (Date.now() - startTime < timeout) {
    try {
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

      const response = await fetch(`https://api.gumloop.com/api/v1/get_pl_run?run_id=${runId}&user_id=jIwZuBctUjgvAWnVrUMvdXt5FFk1`, {
        headers: {
          'Authorization': 'Bearer 80a84ea91fc7409abc77863d8f6ab49d'
        }
      });

      if (!response.ok) {
        console.error('Polling error:', await response.text());
        continue;
      }

      const data = await response.json();

      if (data.state === 'DONE') {
        // Success - extract image URL
        const imageUrl = data.outputs?.new_artwork;
        if (imageUrl) {
          await supabase
            .from('y_sticker_edits')
            .update({
              status: 'completed',
              image_history: [imageUrl.trim()],
              metadata: {
                gumloop: 'success'
              }
            })
            .eq('id', recordId);
          console.log('Successfully completed processing for record:', recordId);
        } else {
          // No image URL in response
          await supabase
            .from('y_sticker_edits')
            .update({
              status: 'failed',
              metadata: {
                gumloop: 'failed'
              }
            })
            .eq('id', recordId);
          console.error('No image URL in Gumloop response for record:', recordId);
        }
        return;
      }

      if (data.state === 'FAILED') {
        // Pipeline failed
        await supabase
          .from('y_sticker_edits')
          .update({
            status: 'failed',
            metadata: {
              gumloop: 'failed'
            }
          })
          .eq('id', recordId);
        console.error('Gumloop pipeline failed for record:', recordId);
        return;
      }

      // Still running, continue polling
      console.log('Pipeline still running for record:', recordId);
    } catch (error) {
      console.error('Polling error:', error);
      continue;
    }
  }

  // Timeout reached
  await supabase
    .from('y_sticker_edits')
    .update({
      status: 'failed',
      metadata: {
        gumloop: 'timeout'
      }
    })
    .eq('id', recordId);
  console.error('Polling timeout reached for record:', recordId);
}
