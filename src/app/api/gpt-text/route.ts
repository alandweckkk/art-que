import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { text, instructions } = await request.json();

    if (!text) {
      return NextResponse.json(
        { error: 'Text input is required' },
        { status: 400 }
      );
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    console.log('Using hardcoded OpenAI API key ending in:', openaiApiKey?.slice(-10));
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    // Prepare the messages array
    const messages = [];
    
    // Add system message if instructions (developer prompt) are provided
    if (instructions) {
      messages.push({
        role: 'system',
        content: instructions
      });
    }

    // Add user message with the text input
    messages.push({
      role: 'user',
      content: text
    });

    // Call OpenAI GPT-4o API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: messages,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API error:', errorData);
      return NextResponse.json(
        { error: 'Failed to get response from GPT-4o', details: errorData },
        { status: response.status }
      );
    }

    const data = await response.json();
    const responseText = data.choices[0]?.message?.content;

    if (!responseText) {
      return NextResponse.json(
        { error: 'No response generated' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      response: responseText,
      usage: data.usage
    });

  } catch (error) {
    console.error('Error in gpt-text API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
