import sharp from 'sharp';

const WORK_SIDE = 1600;
const OUTPUT_WIDTH = 900;
const THUMB_SIDE = 320;
const PADDING = 16;
const PAPER = 0.9;
const INK = 0.6;
const STRONG_INK = 200;
const MIN_INK_SHARE = 0.0004;
const MAX_INK_SHARE = 0.35;

export class SignatureNotFoundError extends Error {}

export const isSignaturePurpose = (purpose?: string) => Boolean(purpose && /(^|_)signature$/.test(purpose));

export const isDrawnSignaturePurpose = (purpose?: string) => purpose === 'signature_pad';

export interface SignatureImage {
  content: Buffer;
  thumbnail: Buffer;
  width: number;
  height: number;
}

export function inkAlpha(gray: Uint8Array, background: Uint8Array): Uint8Array {
  const alpha = new Uint8Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) {
    const ratio = gray[index]! / Math.max(background[index]!, 1);
    const ink = (PAPER - ratio) / (PAPER - INK);
    alpha[index] = Math.round(Math.min(1, Math.max(0, ink)) * 255);
  }
  return alpha;
}

export function inkBounds(alpha: Uint8Array, width: number, height: number) {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  let inked = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x]! < 64) continue;
      inked += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  const share = inked / (width * height);
  if (right < 0 || share < MIN_INK_SHARE || share > MAX_INK_SHARE) return null;
  return {
    left: Math.max(0, left - PADDING),
    top: Math.max(0, top - PADDING),
    width: Math.min(width, right + PADDING + 1) - Math.max(0, left - PADDING),
    height: Math.min(height, bottom + PADDING + 1) - Math.max(0, top - PADDING),
  };
}

export function drawnAlpha(gray: Uint8Array): Uint8Array {
  const alpha = new Uint8Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) {
    alpha[index] = Math.round(Math.min(1, Math.max(0, (245 - gray[index]!) / 165)) * 255);
  }
  return alpha;
}

export async function signatureFromDrawing(buffer: Buffer): Promise<SignatureImage> {
  const prepared = await sharp(buffer, { failOn: 'error' })
    .flatten({ background: '#ffffff' })
    .resize({ width: WORK_SIDE, height: WORK_SIDE, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = prepared.info;
  const [rgb, gray] = await Promise.all([
    sharp(prepared.data).raw().toBuffer(),
    sharp(prepared.data).grayscale().raw().toBuffer(),
  ]);
  return finish(rgb, drawnAlpha(gray), width, height);
}

export async function signatureFromPhoto(buffer: Buffer): Promise<SignatureImage> {
  const prepared = await sharp(buffer, { failOn: 'error' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: WORK_SIDE, height: WORK_SIDE, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = prepared.info;
  const image = () => sharp(prepared.data);
  const sigma = Math.max(8, Math.round(Math.max(width, height) / 40));
  const [rgb, gray, background] = await Promise.all([
    image().raw().toBuffer(),
    image().grayscale().median(3).raw().toBuffer(),
    image().grayscale().blur(sigma).raw().toBuffer(),
  ]);
  return finish(rgb, inkAlpha(gray, background), width, height);
}

async function finish(rgb: Buffer, alpha: Uint8Array, width: number, height: number): Promise<SignatureImage> {
  const bounds = inkBounds(alpha, width, height);
  if (!bounds) throw new SignatureNotFoundError();

  let red = 0;
  let green = 0;
  let blue = 0;
  let strong = 0;
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index]! < STRONG_INK) continue;
    red += rgb[index * 3]!;
    green += rgb[index * 3 + 1]!;
    blue += rgb[index * 3 + 2]!;
    strong += 1;
  }
  const ink = strong ? [red, green, blue].map((sum) => Math.round((sum / strong) * 0.75)) : [17, 24, 39];

  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    rgba[index * 4] = ink[0]!;
    rgba[index * 4 + 1] = ink[1]!;
    rgba[index * 4 + 2] = ink[2]!;
    rgba[index * 4 + 3] = alpha[index]!;
  }
  const cropped = sharp(rgba, { raw: { width, height, channels: 4 } }).extract(bounds);
  const { data, info } = await cropped
    .clone()
    .resize({ width: OUTPUT_WIDTH, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  const thumbnail = await sharp(data)
    .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  return { content: data, thumbnail, width: info.width, height: info.height };
}
