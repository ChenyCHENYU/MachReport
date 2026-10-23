/** Bounded binary image inspection shared by PDF, Excel and template import. No decoder is loaded. */
export interface ImageMediaOptions {
  maxImageBytes?: number;
  maxTotalImageBytes?: number;
  maxImages?: number;
  /** Decoded pixels per unique image, default 16 million. */
  maxImagePixels?: number;
  /** Total decoded pixels for unique media, default 64 million. */
  maxTotalImagePixels?: number;
  /** Maximum source dimension, default 16384 pixels. */
  maxImageDimension?: number;
}
export class ImageMediaError extends Error {
  constructor(readonly code: "invalid-image-data" | "image-budget-exceeded", message: string) { super(message); this.name = "ImageMediaError"; }
}
export interface CheckedImageMedia { dataUrl: string; bytes: Uint8Array; extension: "png" | "jpeg"; width: number; height: number }
const DEFAULTS = { maxImageBytes: 16 * 1024 * 1024, maxTotalImageBytes: 32 * 1024 * 1024, maxImages: 1000, maxImagePixels: 16_000_000, maxTotalImagePixels: 64_000_000, maxImageDimension: 16_384 };
function invalid(message: string): never { throw new ImageMediaError("invalid-image-data", message); }
function budget(message: string): never { throw new ImageMediaError("image-budget-exceeded", message); }
function optionsWithDefaults(options: ImageMediaOptions): typeof DEFAULTS {
  const limits = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as Array<keyof typeof DEFAULTS>) {
    const value = options[key] ?? DEFAULTS[key];
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw new RangeError(`${key} 图片预算须为1至2147483647的整数。`);
    limits[key] = value;
  }
  return limits;
}
function pngSize(bytes: Uint8Array): [number, number] {
  if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return invalid("图片内容与 PNG/JPEG 类型不一致。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return invalid("PNG must begin with an IHDR header.");
  return [view.getUint32(16), view.getUint32(20)];
}
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
function jpegSize(bytes: Uint8Array): [number, number] {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return invalid("图片内容与 PNG/JPEG 类型不一致。");
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) return invalid("JPEG marker is malformed.");
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 1 || marker >= 0xd0 && marker <= 0xd7) continue;
    const length = bytes[offset]! * 256 + bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) return invalid("JPEG segment exceeds its data boundary.");
    if (JPEG_FRAMES.has(marker)) {
      if (length < 8) return invalid("JPEG frame header is incomplete.");
      return [bytes[offset + 5]! * 256 + bytes[offset + 6]!, bytes[offset + 3]! * 256 + bytes[offset + 4]!];
    }
    offset += length;
  }
  return invalid("JPEG has no supported dimension header.");
}
function decode(data: string, limits: typeof DEFAULTS): CheckedImageMedia {
  if (data.length > Math.ceil(limits.maxImageBytes / 3) * 4 + 64) return budget("单张图片超过字节预算。");
  const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(data);
  if (!match || match[2]!.length % 4) return invalid("Image must contain valid PNG/JPEG base64 data.");
  const encoded = match[2]!, byteLength = encoded.length / 4 * 3 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (byteLength > limits.maxImageBytes) return budget("单张图片超过字节预算。");
  const extension = match[1]!.toLowerCase() === "png" ? "png" : "jpeg";
  const binary = atob(encoded), bytes = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index++) bytes[index] = binary.charCodeAt(index);
  const [width, height] = extension === "png" ? pngSize(bytes) : jpegSize(bytes);
  if (!width || !height) return invalid("Image dimensions must be positive.");
  if (width > limits.maxImageDimension || height > limits.maxImageDimension || width * height > limits.maxImagePixels) return budget("Image exceeds its decoded dimension or pixel budget.");
  return { dataUrl: `data:image/${extension};base64,${encoded}`, bytes, extension, width, height };
}
/** Media are deduplicated after MIME normalization. Limits are checked before pixel decoding. */
export function createImageMediaInspector(options: ImageMediaOptions = {}): (data: string) => CheckedImageMedia {
  const limits = optionsWithDefaults(options), cache = new Map<string, CheckedImageMedia>();
  let bytes = 0, pixels = 0;
  return data => {
    const key = data.replace(/^data:image\/(png|jpe?g);base64,/i, (_, type: string) => `data:image/${type.toLowerCase() === "png" ? "png" : "jpeg"};base64,`);
    const cached = cache.get(key); if (cached) return cached;
    if (cache.size >= limits.maxImages) return budget("唯一图片数量超过预算。");
    const image = decode(data, limits);
    if (bytes + image.bytes.length > limits.maxTotalImageBytes || pixels + image.width * image.height > limits.maxTotalImagePixels) return budget("图片总字节或总像素超过预算。");
    bytes += image.bytes.length; pixels += image.width * image.height; cache.set(key, image);
    return image;
  };
}
