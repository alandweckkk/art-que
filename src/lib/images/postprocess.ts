/**
 * Post-process an image with background removal and sharp optimization
 * 
 * This function:
 * 1. Removes the background using FAL.ai (optional)
 * 2. Optimizes the image with sharp (resize, compress, format)
 * 3. Uploads to Vercel Blob
 * 4. Returns the final processed URL
 */

interface PostprocessOptions {
  imageUrl: string
  skipBackgroundRemoval?: boolean
}

interface PostprocessResponse {
  success: boolean
  url: string
  metadata: {
    originalSize: number
    processedSize: number
    compressionRatio: string
    backgroundRemoved: boolean
  }
}

export async function postprocessImage(options: PostprocessOptions): Promise<string> {
  const { imageUrl, skipBackgroundRemoval = false } = options

  try {
    console.log('🎨 Post-processing image:', imageUrl)
    
    const response = await fetch('/api/postprocess-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image_url: imageUrl,
        skipBackgroundRemoval
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Post-processing failed')
    }

    const result: PostprocessResponse = await response.json()
    
    if (!result.success || !result.url) {
      throw new Error('No processed image URL returned')
    }

    console.log('✅ Post-processing complete:')
    console.log('   Original:', imageUrl)
    console.log('   Processed:', result.url)
    console.log('   Size reduction:', result.metadata.compressionRatio)
    console.log('   Background removed:', result.metadata.backgroundRemoved)

    return result.url
  } catch (error) {
    console.error('❌ Post-processing failed:', error)
    // Return original URL as fallback
    console.log('⚠️ Returning original URL as fallback')
    return imageUrl
  }
}

/**
 * Post-process with background removal (full sticker processing)
 */
export async function postprocessSticker(imageUrl: string): Promise<string> {
  return postprocessImage({ imageUrl, skipBackgroundRemoval: false })
}

/**
 * Post-process without background removal (just optimization)
 */
export async function optimizeImage(imageUrl: string): Promise<string> {
  return postprocessImage({ imageUrl, skipBackgroundRemoval: true })
}


