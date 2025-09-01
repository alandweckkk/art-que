import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'

export async function POST(request: NextRequest) {
  try {
    // Try multipart form first (preferred)
    let file: File | null = null
    let contentType = 'image/png'
    let dataBuffer: Buffer | null = null

    // Clone the request to safely try reading as formData
    const reqClone = request.clone()
    try {
      const formData = await reqClone.formData()
      const possibleFile = formData.get('file') as File | null
      if (possibleFile && typeof possibleFile === 'object' && 'arrayBuffer' in possibleFile) {
        file = possibleFile
        contentType = file.type || contentType
        const arr = await file.arrayBuffer()
        dataBuffer = Buffer.from(arr)
      } else {
        // Support base64 data URL via form field `dataUrl`
        const dataUrl = formData.get('dataUrl') as string | null
        if (dataUrl && dataUrl.startsWith('data:')) {
          const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
          if (!match) {
            return NextResponse.json({ error: 'Invalid data URL' }, { status: 400 })
          }
          contentType = match[1]
          dataBuffer = Buffer.from(match[2], 'base64')
        }
      }
    } catch {
      // Not form data; try JSON body
      const json = await request.json().catch(() => null)
      if (json && typeof json.dataUrl === 'string' && json.dataUrl.startsWith('data:')) {
        const match = json.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
        if (!match) {
          return NextResponse.json({ error: 'Invalid data URL' }, { status: 400 })
        }
        contentType = match[1]
        dataBuffer = Buffer.from(match[2], 'base64')
      }
    }

    if (!dataBuffer) {
      return NextResponse.json({ error: 'No file or dataUrl provided' }, { status: 400 })
    }

    // Enforce 25MB limit
    const maxBytes = 25 * 1024 * 1024
    if (dataBuffer.byteLength > maxBytes) {
      return NextResponse.json({ error: 'File exceeds 25MB limit' }, { status: 413 })
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const ext = contentType.split('/')[1] || 'png'
    const filename = `uploaded-image-${timestamp}.${ext}`

    const blob = await put(filename, dataBuffer, {
      access: 'public',
      contentType,
    })

    return NextResponse.json({ success: true, url: blob.url, filename })
  } catch (error) {
    console.error('💥 Error in upload-image API:', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
