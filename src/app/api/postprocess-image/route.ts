import { NextRequest, NextResponse } from 'next/server'

interface PostprocessRequestBody {
  image_url: string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { image_url }: PostprocessRequestBody = await req.json()

    if (!image_url || typeof image_url !== 'string') {
      return NextResponse.json({ error: 'image_url is required' }, { status: 400 })
    }

    const falKey = process.env.FAL_KEY
    if (!falKey) {
      return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 })
    }

    const falResponse = await fetch('https://fal.run/fal-ai/bria/background/remove', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image_url })
    })

    const text = await falResponse.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }

    if (!falResponse.ok) {
      return NextResponse.json(
        { error: 'FAL RMBG request failed', status: falResponse.status, details: data },
        { status: 502 }
      )
    }

    const imageUrl = (data as { image?: { url?: string } })?.image?.url
    if (!imageUrl) {
      return NextResponse.json(
        { error: 'Missing image URL in FAL response', details: data },
        { status: 502 }
      )
    }

    return NextResponse.json({ success: true, url: imageUrl })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}


