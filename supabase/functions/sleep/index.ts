import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface RequestBody {
  word?: string;
}

const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

const reverseString = (str: string): string => {
  return str.split('').reverse().join('');
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    let word = 'hello'; // Default word if none provided

    // Handle both GET and POST requests
    if (req.method === 'GET') {
      const url = new URL(req.url);
      word = url.searchParams.get('word') || word;
    } else if (req.method === 'POST') {
      try {
        const body: RequestBody = await req.json();
        word = body.word || word;
      } catch {
        // If JSON parsing fails, use default word
      }
    }

    console.log(`🚀 Starting sleep function with word: "${word}"`);
    const startTime = Date.now();

    // Sleep for 30 seconds (30,000 milliseconds)
    console.log('😴 Sleeping for 30 seconds...');
    await sleep(30000);

    const endTime = Date.now();
    const actualSleepTime = endTime - startTime;

    // Reverse the word
    const reversedWord = reverseString(word);
    
    console.log(`✅ Woke up! Slept for ${actualSleepTime}ms`);
    console.log(`🔄 Original: "${word}" → Reversed: "${reversedWord}"`);

    const response = {
      success: true,
      original: word,
      reversed: reversedWord,
      sleepTimeMs: actualSleepTime,
      message: `Slept for ${Math.round(actualSleepTime / 1000)} seconds and reversed "${word}" to "${reversedWord}"`,
      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });

  } catch (error) {
    console.error('❌ Error in sleep function:', error);
    
    const errorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
});
