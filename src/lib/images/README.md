# Image Post-Processing

This module provides client-side (Next.js API) post-processing for generated images using:
- **FAL.ai** - Background removal
- **Sharp** - Image optimization, resizing, and format conversion
- **Vercel Blob** - Cloud storage for processed images

## Usage

### Basic Usage

```typescript
import { postprocessSticker, optimizeImage } from '@/lib/images/postprocess'

// Full sticker processing (background removal + optimization)
const processedUrl = await postprocessSticker(generatedImageUrl)

// Just optimization (no background removal)
const optimizedUrl = await optimizeImage(generatedImageUrl)
```

### Example: Integrating into Gemini Generation

```typescript
// In ReactFlowCanvas.tsx - handleGeminiGenerate
const handleGeminiGenerate = async () => {
  try {
    // ... existing generation code ...
    
    const response = await fetch('/api/new-fal-gemini-2.5', {
      method: 'POST',
      body: formData
    })

    const result = await response.json()
    
    if (result.success && result.data.imageUrl) {
      // Add post-processing here
      const processedUrl = await postprocessSticker(result.data.imageUrl)
      
      // Use processedUrl instead of result.data.imageUrl
      await appendToImageHistory(processedUrl, 'g-1')
      await loadGenerations()
    }
  } catch (error) {
    console.error('Generation error:', error)
  }
}
```

### Example: Integrating into API Routes

```typescript
// In /api/new-fal-gemini-2.5/route.ts
import { postprocessSticker } from '@/lib/images/postprocess'

export async function POST(request: NextRequest) {
  try {
    // ... existing generation code ...
    const generatedImageUrl = geminiResult.image
    
    // Post-process the generated image
    const processedUrl = await postprocessSticker(generatedImageUrl)
    
    return NextResponse.json({
      success: true,
      data: {
        imageUrl: processedUrl, // Return processed URL
        originalImageUrl: generatedImageUrl // Keep original for reference
      }
    })
  } catch (error) {
    // Handle error
  }
}
```

## API Endpoint

### POST `/api/postprocess-image`

**Request Body:**
```json
{
  "image_url": "https://example.com/image.png",
  "skipBackgroundRemoval": false
}
```

**Response:**
```json
{
  "success": true,
  "url": "https://blob.vercel-storage.com/postprocessed-xxx.png",
  "metadata": {
    "originalSize": 2079315,
    "processedSize": 2079239,
    "compressionRatio": "0.00",
    "backgroundRemoved": true
  }
}
```

## Features

### Background Removal
- Uses FAL.ai's Bria background removal service
- Automatic transparency handling
- Can be skipped with `skipBackgroundRemoval: true`

### Sharp Processing
- Resizes to max 2048x2048 (maintains aspect ratio)
- PNG optimization with quality 100
- Compression level 6 (balanced)
- Full color palette (no palette reduction)
- Never upscales images

### Error Handling
- Gracefully falls back to original URL if processing fails
- Comprehensive error logging
- Returns original image on any failure

## Environment Variables

Required:
- `FAL_KEY` - FAL.ai API key for background removal
- `BLOB_READ_WRITE_TOKEN` - Vercel Blob storage token (automatically set on Vercel)

## Performance

- Background removal: ~2-5 seconds
- Sharp processing: ~0.5-2 seconds
- Upload to Vercel Blob: ~0.5-1 second
- **Total processing time: ~3-8 seconds**

## Notes

- Post-processing happens server-side (Next.js API route)
- Original images are never modified
- Processed images are permanently stored on Vercel Blob
- All operations are logged for debugging

