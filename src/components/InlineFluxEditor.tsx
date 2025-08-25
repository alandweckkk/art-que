"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ReactSketchCanvas } from "react-sketch-canvas";
import { Brush, Eraser, Eye, EyeOff, RotateCcw, Wand2 } from "lucide-react";

interface InlineFluxEditorProps {
  imageUrl: string;
  onProcessedImage: (processedImageUrl: string) => void;
  onError?: (error: string) => void;
}

export function InlineFluxEditor({ imageUrl, onProcessedImage, onError }: InlineFluxEditorProps) {
  // Canvas and image refs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sketchRef = useRef<any>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Editor state
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [maskDataUrl, setMaskDataUrl] = useState<string>("");
  const [showMaskOverlay, setShowMaskOverlay] = useState(false);
  const [tool, setTool] = useState<"brush" | "eraser">("brush");
  const [brushSize, setBrushSize] = useState<number>(50);

  // Dimensions
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [naturalDimensions, setNaturalDimensions] = useState({ width: 0, height: 0 });

  // Helpers adapted from MaskEditor to keep binary mask and scaling consistent
  const scaleMaskToNaturalSize = useCallback(async (displayMaskDataUrl: string) => {
    return new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(displayMaskDataUrl);
          return;
        }
        canvas.width = naturalDimensions.width;
        canvas.height = naturalDimensions.height;
        ctx.drawImage(img, 0, 0, naturalDimensions.width, naturalDimensions.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = displayMaskDataUrl;
    });
  }, [naturalDimensions]);

  const createBinaryMask = useCallback(async (rawDataUrl: string) => {
    return new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha > 0) {
            data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
          } else {
            data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
          }
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = rawDataUrl;
    });
  }, []);

  const generateMaskDataUrl = useCallback(async () => {
    if (!sketchRef.current || naturalDimensions.width === 0) return;
    try {
      const rawDataUrl = await sketchRef.current.exportImage('png');
      const scaledMaskDataUrl = await scaleMaskToNaturalSize(rawDataUrl);
      const binaryMaskDataUrl = await createBinaryMask(scaledMaskDataUrl);
      setMaskDataUrl(binaryMaskDataUrl);
    } catch (error) {
      console.error('Error generating mask:', error);
    }
  }, [createBinaryMask, scaleMaskToNaturalSize, naturalDimensions]);

  const handleImageLoad = () => {
    if (imageRef.current && containerRef.current) {
      const img = imageRef.current;
      setNaturalDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      
      // Use the container's dimensions (the gray box) for display
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;
      
      const aspect = img.naturalWidth / img.naturalHeight;
      let displayWidth = img.naturalWidth;
      let displayHeight = img.naturalHeight;
      
      // Scale to fit within the gray container
      if (displayWidth > containerWidth) {
        displayWidth = containerWidth;
        displayHeight = displayWidth / aspect;
      }
      if (displayHeight > containerHeight) {
        displayHeight = containerHeight;
        displayWidth = displayHeight * aspect;
      }
      
      setImageDimensions({ width: Math.round(displayWidth), height: Math.round(displayHeight) });
    }
  };

  const clearMask = async () => {
    if (!sketchRef.current) return;
    try {
      await sketchRef.current.clearCanvas();
      setMaskDataUrl("");
    } catch (e) {
      console.error(e);
    }
  };

  // Keep eraser mode in sync
  useEffect(() => {
    if (sketchRef.current) {
      sketchRef.current.eraseMode(tool === 'eraser');
    }
  }, [tool]);

  useEffect(() => {
    const onResize = () => {
      if (imageRef.current && naturalDimensions.width > 0) handleImageLoad();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [naturalDimensions]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      onError?.("Please enter a prompt describing what you want to inpaint");
      return;
    }
    if (!maskDataUrl || maskDataUrl.length < 1000) {
      onError?.("Please paint areas on the image to create a mask");
      return;
    }
    try {
      setIsGenerating(true);
      const formData = new FormData();
      formData.append('image_url', imageUrl);
      formData.append('prompt', prompt.trim());
      const maskResponse = await fetch(maskDataUrl);
      const maskBlob = await maskResponse.blob();
      if (maskBlob.size < 1000) {
        throw new Error('Mask appears to be empty or too small. Please paint some areas white to create a mask.');
      }
      formData.append('mask', maskBlob, 'mask.png');
      const response = await fetch('/api/kontext-image', { method: 'POST', body: formData });
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}: Failed to process with FLUX Kontext LoRA`;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error) errorMessage = errorData.error;
        } catch {
          if (errorText) errorMessage = errorText;
        }
        throw new Error(errorMessage);
      }
      const result = await response.json();
      if (!result.success || !result.data?.imageUrl) throw new Error(result.error || 'No processed image URL in response');
      onProcessedImage(result.data.imageUrl);
    } catch (e) {
      console.error('InlineFluxEditor generate error:', e);
      const msg = e instanceof Error ? e.message : 'Failed to process with FLUX Kontext LoRA';
      onError?.(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, maskDataUrl, imageUrl, onProcessedImage, onError]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'b' || e.key === 'B') setTool('brush');
      if (e.key === 'e' || e.key === 'E') setTool('eraser');
      if (e.key === '[') setBrushSize((s) => Math.max(5, s - 5));
      if (e.key === ']') setBrushSize((s) => Math.min(200, s + 5));
      if (e.key === 'm' || e.key === 'M') setShowMaskOverlay((v) => !v);
      if (e.key === 'Enter') {
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
          handleGenerate();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleGenerate]);

  const canvasStyle = { border: 'none', borderRadius: '0px' } as const;

  return (
    <div className="w-full h-full flex flex-col">
      {/* Image + Canvas Container - Takes most of the space */}
      <div ref={containerRef} className="flex-1 relative bg-gray-200 dark:bg-gray-300">
        {imageDimensions.width > 0 && (
          <div
            className="absolute inset-0 flex items-center justify-center"
          >
            {/* Image */}
            <div
              className="relative"
              style={{
                width: `${imageDimensions.width}px`,
                height: `${imageDimensions.height}px`,
              }}
            >
              <img
                ref={imageRef}
                src={imageUrl}
                alt="Source"
                className="block object-contain"
                style={{
                  width: `${imageDimensions.width}px`,
                  height: `${imageDimensions.height}px`,
                }}
                onLoad={handleImageLoad}
              />

              {/* Drawing Canvas Overlay */}
              <div
                className="absolute top-0 left-0 pointer-events-auto"
                style={{ width: imageDimensions.width, height: imageDimensions.height }}
              >
                <ReactSketchCanvas
                  ref={sketchRef}
                  style={canvasStyle}
                  width={`${imageDimensions.width}px`}
                  height={`${imageDimensions.height}px`}
                  strokeWidth={brushSize}
                  strokeColor="rgba(34, 197, 94, 0.6)"
                  canvasColor="transparent"
                  allowOnlyPointerType="all"
                  onStroke={generateMaskDataUrl}
                />
              </div>

              {/* Mask Overlay */}
              {showMaskOverlay && maskDataUrl && (
                <div
                  className="absolute top-0 left-0 pointer-events-none"
                  style={{ width: imageDimensions.width, height: imageDimensions.height }}
                >
                  <img
                    src={maskDataUrl}
                    alt="Binary mask visualization"
                    className="object-contain opacity-70"
                    style={{
                      width: `${imageDimensions.width}px`,
                      height: `${imageDimensions.height}px`,
                      mixBlendMode: 'multiply',
                      filter: 'hue-rotate(240deg) saturate(1.5)'
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Load image initially */}
        {imageDimensions.width === 0 && (
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Source"
            className="absolute inset-0 w-full h-full object-contain"
            onLoad={handleImageLoad}
          />
        )}
      </div>

      {/* Tools Panel - Fixed height at bottom */}
      <div className="bg-white border-t p-3 space-y-3">
        {/* Brush Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTool('brush')}
            className={`p-2 rounded ${tool === 'brush' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'} hover:bg-blue-500 hover:text-white`}
            title="Brush (B)"
          >
            <Brush className="w-4 h-4" />
          </button>
          <button
            onClick={() => setTool('eraser')}
            className={`p-2 rounded ${tool === 'eraser' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'} hover:bg-blue-500 hover:text-white`}
            title="Eraser (E)"
          >
            <Eraser className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 ml-2">
            <span className="text-xs text-gray-600">Size</span>
            <input
              type="range"
              min={5}
              max={200}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-20"
            />
            <span className="text-xs w-8 text-right font-mono">{brushSize}</span>
          </div>

          <button
            onClick={() => setShowMaskOverlay((v) => !v)}
            className={`p-2 rounded ${showMaskOverlay ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700'} hover:bg-purple-500 hover:text-white ml-2`}
            title="Toggle mask overlay (M)"
          >
            {showMaskOverlay ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>

          <button
            onClick={clearMask}
            className="p-2 rounded bg-red-600 text-white hover:bg-red-700"
            title="Clear mask"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Prompt Input */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what to inpaint…"
            className="flex-1 px-3 py-2 text-sm border rounded"
            maxLength={500}
            disabled={isGenerating}
          />
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim() || !maskDataUrl}
            className="inline-flex items-center gap-2 px-4 py-2 rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {isGenerating ? (
              <span className="inline-flex items-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                Generating…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Wand2 className="w-4 h-4" />
                Generate
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

