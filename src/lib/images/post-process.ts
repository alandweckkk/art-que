"use server";

import sharp from "sharp";

interface PostProcessOptions {
  alphaThreshold: number;
  maxDimension: number;
  canvasSize: number;
  borderPx: number;
}

const DEFAULT_OPTIONS: PostProcessOptions = {
  alphaThreshold: 10,
  maxDimension: 940,
  canvasSize: 1024,
  borderPx: 14,
};

export async function postProcessImage(
  input: Buffer | string,
  options: Partial<PostProcessOptions> = {}
): Promise<Buffer> {
  const opts = { ...DEFAULT_OPTIONS, ...options } as PostProcessOptions;

  const srcBuffer: Buffer =
    typeof input === "string" ? await fetchPublicImage(input) : input;

  const { data: raw0, info } = await sharp(srcBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let rgba = new Uint8ClampedArray(
    raw0.buffer,
    raw0.byteOffset,
    raw0.byteLength
  );
  let width = info.width;
  let height = info.height;

  ({ rgba, width, height } = removeStrayPixels(
    rgba,
    width,
    height,
    opts.alphaThreshold
  ));

  const centeredBuffer = await resizeAndCenter(rgba, width, height, opts);

  const { data: canvasRaw } = await sharp(centeredBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const maskAlpha = createSilhouetteMask(
    canvasRaw,
    opts.canvasSize,
    opts.canvasSize,
    opts.alphaThreshold
  );

  const finalBuffer = await addCreamBorder(centeredBuffer, maskAlpha, opts);
  return finalBuffer;
}

async function fetchPublicImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download image (${res.status}): ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function removeStrayPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const visible = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    visible[i] = rgba[i * 4 + 3] > alphaThreshold ? 1 : 0;
  }

  const labels = new Uint32Array(width * height);
  const areas: number[] = [0];
  const bboxes: Array<{ minX: number; maxX: number; minY: number; maxY: number }> = [
    { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  ];

  let currentLabel = 0;
  const queueX: number[] = [];
  const queueY: number[] = [];

  const push = (x: number, y: number) => {
    queueX.push(x);
    queueY.push(y);
  };

  const pop = () => {
    const x = queueX.pop()!;
    const y = queueY.pop()!;
    return [x, y] as const;
  };

  const directions = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ] as const;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visible[idx] && labels[idx] === 0) {
        currentLabel++;
        let area = 0;
        let minX = x,
          maxX = x,
          minY = y,
          maxY = y;
        push(x, y);
        labels[idx] = currentLabel;
        while (queueX.length) {
          const [cx, cy] = pop();
          area++;
          for (const [dx, dy] of directions) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const nIdx = ny * width + nx;
            if (visible[nIdx] && labels[nIdx] === 0) {
              labels[nIdx] = currentLabel;
              push(nx, ny);
              if (nx < minX) minX = nx;
              if (nx > maxX) maxX = nx;
              if (ny < minY) minY = ny;
              if (ny > maxY) maxY = ny;
            }
          }
        }

        areas[currentLabel] = area;
        bboxes[currentLabel] = { minX, maxX, minY, maxY };
      }
    }
  }

  if (currentLabel === 0) {
    return { rgba, width, height };
  }

  let largestLabel = 1;
  for (let lbl = 2; lbl <= currentLabel; lbl++) {
    if (areas[lbl] > areas[largestLabel]) {
      largestLabel = lbl;
    }
  }

  const { minX, maxX, minY, maxY } = bboxes[largestLabel];

  const rgbaOut = new Uint8ClampedArray(rgba);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const inLargest = labels[idx] === largestLabel;
      const inBbox = x >= minX && x <= maxX && y >= minY && y <= maxY;
      if (inLargest || inBbox) continue;
      const pixIdx = idx * 4;
      rgbaOut[pixIdx] = 0;
      rgbaOut[pixIdx + 1] = 0;
      rgbaOut[pixIdx + 2] = 0;
      rgbaOut[pixIdx + 3] = 0;
    }
  }

  return { rgba: rgbaOut, width, height };
}

async function resizeAndCenter(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: PostProcessOptions
): Promise<Buffer> {
  let rmin = height,
    rmax = -1,
    cmin = width,
    cmax = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = rgba[(y * width + x) * 4 + 3];
      if (alpha > opts.alphaThreshold) {
        if (y < rmin) rmin = y;
        if (y > rmax) rmax = y;
        if (x < cmin) cmin = x;
        if (x > cmax) cmax = x;
      }
    }
  }

  if (rmax === -1 || cmax === -1) {
    return sharp({
      create: {
        width: opts.canvasSize,
        height: opts.canvasSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
  }

  const cropWidth = cmax - cmin + 1;
  const cropHeight = rmax - rmin + 1;

  const croppedImage = sharp(rgba, {
    raw: { width, height, channels: 4 },
  }).extract({ left: cmin, top: rmin, width: cropWidth, height: cropHeight });

  let resizeOptions: sharp.ResizeOptions;
  if (cropWidth > cropHeight) {
    resizeOptions = { width: Math.min(opts.maxDimension, cropWidth) };
  } else {
    resizeOptions = { height: Math.min(opts.maxDimension, cropHeight) };
  }

  const resizedBuffer = await croppedImage.resize(resizeOptions).png().toBuffer();

  const resizedMeta = await sharp(resizedBuffer).metadata();
  const newWidth = resizedMeta.width || resizeOptions.width || 0;
  const newHeight = resizedMeta.height || resizeOptions.height || 0;

  const pasteX = Math.floor((opts.canvasSize - newWidth) / 2);
  const pasteY = Math.floor((opts.canvasSize - newHeight) / 2);

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
    .toBuffer();

  return canvasBuffer;
}

function createSilhouetteMask(
  canvasRaw: Buffer,
  width: number,
  height: number,
  alphaThreshold: number
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) {
    mask[i] = canvasRaw[i * 4 + 3] > alphaThreshold ? 255 : 0;
  }
  const dilated = dilateMask(mask, width, height, 3);
  const closed = erodeMask(dilated, width, height, 3);
  return closed;
}

async function addCreamBorder(
  centeredPng: Buffer,
  maskAlpha: Uint8ClampedArray,
  opts: PostProcessOptions
): Promise<Buffer> {
  const width = opts.canvasSize;
  const height = opts.canvasSize;

  const borderAlpha = dilateMask(maskAlpha, width, height, opts.borderPx);

  const borderRGBA = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = borderAlpha[i];
    const idx = i * 4;
    borderRGBA[idx] = 255;
    borderRGBA[idx + 1] = 255;
    borderRGBA[idx + 2] = 255;
    borderRGBA[idx + 3] = a;
  }

  const borderBuffer = await sharp(borderRGBA, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();

  const finalBuffer = await sharp(borderBuffer)
    .composite([{ input: centeredPng, left: 0, top: 0 }])
    .png()
    .toBuffer();

  return finalBuffer;
}

function dilateMask(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(src.length);
  const rSquared = radius * radius;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (src[idx] === 0) continue;
      const yStart = Math.max(0, y - radius);
      const yEnd = Math.min(height - 1, y + radius);
      for (let yy = yStart; yy <= yEnd; yy++) {
        const dy = yy - y;
        const dxMax = Math.floor(Math.sqrt(rSquared - dy * dy));
        const xStart = Math.max(0, x - dxMax);
        const xEnd = Math.min(width - 1, x + dxMax);
        for (let xx = xStart; xx <= xEnd; xx++) {
          dst[yy * width + xx] = 255;
        }
      }
    }
  }

  return dst;
}

function erodeMask(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): Uint8ClampedArray {
  const rSquared = radius * radius;
  const dst = new Uint8ClampedArray(src.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let keep = true;
      const yStart = Math.max(0, y - radius);
      const yEnd = Math.min(height - 1, y + radius);
      for (let yy = yStart; yy <= yEnd && keep; yy++) {
        const dy = yy - y;
        const dxMax = Math.floor(Math.sqrt(rSquared - dy * dy));
        const xStart = Math.max(0, x - dxMax);
        const xEnd = Math.min(width - 1, x + dxMax);
        for (let xx = xStart; xx <= xEnd; xx++) {
          if (src[yy * width + xx] === 0) {
            keep = false;
            break;
          }
        }
      }
      dst[y * width + x] = keep ? 255 : 0;
    }
  }

  return dst;
}


