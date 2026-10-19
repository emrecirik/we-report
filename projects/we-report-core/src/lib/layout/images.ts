export interface ImageInfo {
  mime: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
  /** Intrinsic size in pixels. */
  width: number;
  height: number;
}

const DATA_URI = /^data:(image\/(?:png|jpe?g));base64,([A-Za-z0-9+/=\s]+)$/;

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Decodes a PNG/JPEG `data:` URI and reads its pixel size; `null` for anything else. */
export function readImage(src: string): ImageInfo | null {
  const m = DATA_URI.exec(src.trim());
  if (!m) return null;
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(m[2]);
  } catch {
    return null;
  }
  const mime = m[1] === 'image/png' ? 'image/png' : 'image/jpeg';
  const size = mime === 'image/png' ? pngSize(bytes) : jpegSize(bytes);
  return size ? { mime, bytes, ...size } : null;
}

function pngSize(b: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || signature.some((v, i) => b[i] !== v)) return null;
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  return { width: u32(16), height: u32(20) };
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1];
    const length = (b[o + 2] << 8) | b[o + 3];
    // SOF0-SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) do not.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (b[o + 5] << 8) | b[o + 6], width: (b[o + 7] << 8) | b[o + 8] };
    }
    o += 2 + length;
  }
  return null;
}
