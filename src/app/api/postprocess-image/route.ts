import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { postProcessImage } from '@/lib/images/post-process'

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
    // Download, post-process via Sharp, and upload to Vercel Blob
    const processedPng = await postProcessImage(imageUrl, { maxDimension: 940 })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `email-postprocess-${ts}.png`
    const blob = await put(filename, processedPng, {
      access: 'public',
      contentType: 'image/png'
    })

    return NextResponse.json({ success: true, url: blob.url })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}



