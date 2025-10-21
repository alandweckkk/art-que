import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import sharp from 'sharp'

interface PostprocessRequestBody {
  image_url?: string
  image_buffer_base64?: string // Optional: base64-encoded image buffer (to avoid double upload)
  skipBackgroundRemoval?: boolean // Optional flag to skip BG removal and just use sharp
  useAdvancedProcessing?: boolean // Optional flag to use advanced sticker processing
}

interface PostProcessOptions {
  alphaThreshold: number
  maxDimension: number
  canvasSize: number
  borderPx: number
}

// Step 1: Remove stray pixels – keep largest connected component & its bbox
function removeStrayPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number
): { rgba: Uint8ClampedArray; width: number; height: number } {
  // Build binary visibility mask (1 => visible)
  const visible = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    visible[i] = rgba[i * 4 + 3] > alphaThreshold ? 1 : 0
  }

  // Connected components via BFS – label array initialised to 0
  const labels = new Uint32Array(width * height)
  const areas: number[] = [0] // areas[0] unused
  const bboxes: Array<{ minX: number; maxX: number; minY: number; maxY: number }> = [
    { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  ]

  let currentLabel = 0
  const queueX: number[] = []
  const queueY: number[] = []

  const push = (x: number, y: number) => {
    queueX.push(x)
    queueY.push(y)
  }

  const pop = () => {
    const x = queueX.pop()!
    const y = queueY.pop()!
    return [x, y] as const
  }

  const directions = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ] as const

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (visible[idx] && labels[idx] === 0) {
        // new component
        currentLabel++
        let area = 0
        let minX = x,
          maxX = x,
          minY = y,
          maxY = y
        push(x, y)
        labels[idx] = currentLabel
        while (queueX.length) {
          const [cx, cy] = pop()
          area++
          for (const [dx, dy] of directions) {
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            const nIdx = ny * width + nx
            if (visible[nIdx] && labels[nIdx] === 0) {
              labels[nIdx] = currentLabel
              push(nx, ny)
              // update bbox on the fly
              if (nx < minX) minX = nx
              if (nx > maxX) maxX = nx
              if (ny < minY) minY = ny
              if (ny > maxY) maxY = ny
            }
          }
        }

        areas[currentLabel] = area
        bboxes[currentLabel] = { minX, maxX, minY, maxY }
      }
    }
  }

  if (currentLabel === 0) {
    // No visible pixels – return untouched
    return { rgba, width, height }
  }

  // Identify largest component (label > 0)
  let largestLabel = 1
  for (let lbl = 2; lbl <= currentLabel; lbl++) {
    if (areas[lbl] > areas[largestLabel]) {
      largestLabel = lbl
    }
  }

  const { minX, maxX, minY, maxY } = bboxes[largestLabel]

  // Build set of pixels to keep: those inside bbox OR part of largest label
  const rgbaOut = new Uint8ClampedArray(rgba)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const inLargest = labels[idx] === largestLabel
      const inBbox = x >= minX && x <= maxX && y >= minY && y <= maxY
      if (inLargest || inBbox) {
        // keep as is
        continue
      }
      // otherwise clear pixel (transparent)
      const pixIdx = idx * 4
      rgbaOut[pixIdx] = 0
      rgbaOut[pixIdx + 1] = 0
      rgbaOut[pixIdx + 2] = 0
      rgbaOut[pixIdx + 3] = 0
    }
  }

  console.log(`   Found ${currentLabel} components, kept largest (${areas[largestLabel]} pixels)`)
  return { rgba: rgbaOut, width, height }
}

// Step 2: Resize & center on transparent canvas
async function resizeAndCenter(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: PostProcessOptions
): Promise<Buffer> {
  // Determine non-transparent bounding box
  let rmin = height,
    rmax = -1,
    cmin = width,
    cmax = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = rgba[(y * width + x) * 4 + 3]
      if (alpha > opts.alphaThreshold) {
        if (y < rmin) rmin = y
        if (y > rmax) rmax = y
        if (x < cmin) cmin = x
        if (x > cmax) cmax = x
      }
    }
  }

  if (rmax === -1 || cmax === -1) {
    // completely transparent – return blank canvas
    return sharp({
      create: {
        width: opts.canvasSize,
        height: opts.canvasSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer()
  }

  const cropWidth = cmax - cmin + 1
  const cropHeight = rmax - rmin + 1

  // Convert raw to sharp image for further processing and chain operations
  const croppedImage = sharp(Buffer.from(rgba.buffer), {
    raw: { width, height, channels: 4 },
  }).extract({ left: cmin, top: rmin, width: cropWidth, height: cropHeight })

  // Resize while keeping aspect ratio
  let resizeOptions: sharp.ResizeOptions
  if (cropWidth > cropHeight) {
    resizeOptions = { width: Math.min(opts.maxDimension, cropWidth) }
  } else {
    resizeOptions = { height: Math.min(opts.maxDimension, cropHeight) }
  }

  const resizedBuffer = await croppedImage
    .resize(resizeOptions)
    .png()
    .toBuffer()

  const resizedMeta = await sharp(resizedBuffer).metadata()
  const newWidth = resizedMeta.width || resizeOptions.width || 0
  const newHeight = resizedMeta.height || resizeOptions.height || 0

  // Build the final canvas and paste in the centre
  const pasteX = Math.floor((opts.canvasSize - newWidth) / 2)
  const pasteY = Math.floor((opts.canvasSize - newHeight) / 2)

  const canvasBuffer = await sharp({
    create: {
      width: opts.canvasSize,
      height: opts.canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resizedBuffer, left: pasteX, top: pasteY }])
    .png()
    .toBuffer()

  return canvasBuffer
}

// Step 3: Create silhouette mask
function createSilhouetteMask(
  canvasRaw: Buffer,
  width: number,
  height: number,
  alphaThreshold: number
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height)
  for (let i = 0; i < width * height; i++) {
    mask[i] = canvasRaw[i * 4 + 3] > alphaThreshold ? 255 : 0
  }
  // Simple morphological close: dilate then erode using borderPx=3
  const dilated = dilateMask(mask, width, height, 3)
  const closed = erodeMask(dilated, width, height, 3)
  return closed
}

// Step 4: Add white border and composite with original centered art
async function addWhiteBorder(
  centeredPng: Buffer,
  maskAlpha: Uint8ClampedArray,
  opts: PostProcessOptions
): Promise<Buffer> {
  const width = opts.canvasSize
  const height = opts.canvasSize

  // Dilate mask to create border silhouette
  const borderAlpha = dilateMask(maskAlpha, width, height, opts.borderPx)

  // Build RGBA border layer (white RGB, alpha as borderAlpha)
  const borderRGBA = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const a = borderAlpha[i]
    const idx = i * 4
    borderRGBA[idx] = 255
    borderRGBA[idx + 1] = 255
    borderRGBA[idx + 2] = 255
    borderRGBA[idx + 3] = a
  }

  const borderBuffer = await sharp(Buffer.from(borderRGBA.buffer), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer()

  // Compose: border at bottom, original art on top
  const finalBuffer = await sharp(borderBuffer)
    .composite([{ input: centeredPng, left: 0, top: 0 }])
    .png()
    .toBuffer()

  return finalBuffer
}

// Utility – morphological dilation (disk / circle approximation)
function dilateMask(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(src.length)
  const rSquared = radius * radius

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (src[idx] === 0) continue
      // set neighbours inside radius
      const yStart = Math.max(0, y - radius)
      const yEnd = Math.min(height - 1, y + radius)
      for (let yy = yStart; yy <= yEnd; yy++) {
        const dy = yy - y
        const dxMax = Math.floor(Math.sqrt(rSquared - dy * dy))
        const xStart = Math.max(0, x - dxMax)
        const xEnd = Math.min(width - 1, x + dxMax)
        for (let xx = xStart; xx <= xEnd; xx++) {
          dst[yy * width + xx] = 255
        }
      }
    }
  }

  return dst
}

// Utility – morphological erosion (same structuring element)
function erodeMask(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): Uint8ClampedArray {
  const rSquared = radius * radius
  const dst = new Uint8ClampedArray(src.length)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let keep = true
      const yStart = Math.max(0, y - radius)
      const yEnd = Math.min(height - 1, y + radius)
      for (let yy = yStart; yy <= yEnd && keep; yy++) {
        const dy = yy - y
        const dxMax = Math.floor(Math.sqrt(rSquared - dy * dy))
        const xStart = Math.max(0, x - dxMax)
        const xEnd = Math.min(width - 1, x + dxMax)
        for (let xx = xStart; xx <= xEnd; xx++) {
          if (src[yy * width + xx] === 0) {
            keep = false
            break
          }
        }
      }
      dst[y * width + x] = keep ? 255 : 0
    }
  }

  return dst
}

/**
 * Process an image buffer with sticker processing pipeline
 * This is the core function that can be called from other API routes
 */
export async function processImageBuffer(
  imageBuffer: Buffer,
  options: {
    skipBackgroundRemoval?: boolean
    useAdvancedProcessing?: boolean
  } = {}
): Promise<Buffer> {
  const { skipBackgroundRemoval = true, useAdvancedProcessing = true } = options

  console.log('🎨 Starting post-processing')
  console.log('   Skip BG Removal:', skipBackgroundRemoval)
  console.log('   Advanced Processing:', useAdvancedProcessing)

  let workingBuffer = imageBuffer

  // Step 1: Remove background (unless skipped)
  if (!skipBackgroundRemoval) {
    const falKey = process.env.FAL_KEY
    if (!falKey) {
      throw new Error('FAL_KEY not configured')
    }

    console.log('🗑️ Removing background with FAL.ai...')
    
    // Upload to temp blob for FAL to access
    const tempBlob = await put(`temp-${Date.now()}.png`, imageBuffer, {
      access: 'public',
      contentType: 'image/png',
    })

    const falResponse = await fetch('https://fal.run/fal-ai/bria/background/remove', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image_url: tempBlob.url })
    })

    const text = await falResponse.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }

    if (!falResponse.ok) {
      throw new Error('FAL RMBG request failed')
    }

    const bgRemovedUrl = (data as { image?: { url?: string } })?.image?.url
    if (!bgRemovedUrl) {
      throw new Error('Missing image URL in FAL response')
    }

    // Download processed image
    const bgResponse = await fetch(bgRemovedUrl)
    workingBuffer = Buffer.from(await bgResponse.arrayBuffer())
    console.log('✅ Background removed')
  }

  console.log('📥 Working with image buffer:', workingBuffer.length, 'bytes')

  let processedBuffer: Buffer

  // Use advanced processing if requested
  if (useAdvancedProcessing) {
      console.log('🎨 Using advanced sticker processing pipeline')
      
      const alphaThreshold = 10
      const maxDimension = 940
      const canvasSize = 1024
      const borderPx = 14
      
      // STEP 0 – Load image and ensure alpha channel
      console.log('🔧 Step 0: Load and prepare image...')
      const { data: raw0, info } = await sharp(workingBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })

      // Convert Node Buffer -> Uint8ClampedArray view (no copy)
      let rgba = new Uint8ClampedArray(raw0.buffer, raw0.byteOffset, raw0.byteLength)
      let width = info.width
      let height = info.height
      console.log('   Image dimensions:', width, 'x', height)

      // STEP 1 – Remove stray pixels using connected component analysis
      console.log('🔧 Step 1: Remove stray pixels...')
      const cleanedResult = removeStrayPixels(rgba, width, height, alphaThreshold)
      rgba = cleanedResult.rgba
      width = cleanedResult.width
      height = cleanedResult.height

      // STEP 2 – Resize & center on transparent canvas
      console.log('🔧 Step 2: Resize & center...')
      const centeredBuffer = await resizeAndCenter(rgba, width, height, {
        alphaThreshold,
        maxDimension,
        canvasSize,
        borderPx,
      })

      // After sharp transformations we need the final canvas raw for mask step
      const { data: canvasRaw } = await sharp(centeredBuffer)
        .raw()
        .toBuffer({ resolveWithObject: true })

      // STEP 3 – Create silhouette mask
      console.log('🔧 Step 3: Create silhouette mask...')
      const maskAlpha = createSilhouetteMask(canvasRaw, canvasSize, canvasSize, alphaThreshold)

      // STEP 4 – Add white border and composite
      console.log('🔧 Step 4: Add white border...')
      processedBuffer = await addWhiteBorder(centeredBuffer, maskAlpha, {
        alphaThreshold,
        maxDimension,
        canvasSize,
        borderPx,
      })

      console.log('✅ Advanced processing complete')
    } else {
      // Simple processing: just resize and optimize
      console.log('🎨 Using simple processing (resize & optimize)')
      
      processedBuffer = await sharp(workingBuffer)
        .resize(2048, 2048, { 
          fit: 'inside', 
          withoutEnlargement: true
        })
        .png({ 
          quality: 100, 
          compressionLevel: 6,
          palette: false
        })
        .toBuffer()
      
      console.log('✅ Simple processing complete')
    }

  console.log('   Original size:', workingBuffer.length, 'bytes')
  console.log('   Processed size:', processedBuffer.length, 'bytes')

  return processedBuffer
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { image_url, image_buffer_base64, skipBackgroundRemoval, useAdvancedProcessing }: PostprocessRequestBody = await req.json()

    if (!image_url && !image_buffer_base64) {
      return NextResponse.json({ error: 'image_url or image_buffer_base64 is required' }, { status: 400 })
    }

    let imageBuffer: Buffer

    // Get image buffer from URL or base64
    if (image_buffer_base64) {
      console.log('📥 Using provided image buffer')
      imageBuffer = Buffer.from(image_buffer_base64, 'base64')
    } else if (image_url) {
      console.log('🔗 Downloading from URL:', image_url)
      const imageResponse = await fetch(image_url)
      if (!imageResponse.ok) {
        return NextResponse.json(
          { error: 'Failed to download image from URL' },
          { status: 502 }
        )
      }
      imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
    } else {
      return NextResponse.json({ error: 'No image source provided' }, { status: 400 })
    }

    // Process the image
    const processedBuffer = await processImageBuffer(imageBuffer, {
      skipBackgroundRemoval,
      useAdvancedProcessing
    })

    // Upload to Vercel Blob
    console.log('☁️ Uploading to Vercel Blob...')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `postprocessed-${timestamp}.png`

    const blob = await put(filename, processedBuffer, {
      access: 'public',
      contentType: 'image/png'
    })

    console.log('✅ Upload complete:', blob.url)

    return NextResponse.json({ 
      success: true, 
      url: blob.url,
      metadata: {
        originalSize: imageBuffer.length,
        processedSize: processedBuffer.length,
        compressionRatio: (1 - processedBuffer.length / imageBuffer.length).toFixed(2),
        backgroundRemoved: !skipBackgroundRemoval,
        advancedProcessing: useAdvancedProcessing || false,
        ...(useAdvancedProcessing && {
          processingSteps: ['removeStrayPixels', 'resizeAndCenter', 'createSilhouetteMask', 'addWhiteBorder']
        })
      }
    })
  } catch (error) {
    console.error('💥 Post-processing error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}



