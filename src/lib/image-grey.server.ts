import { decode, encode } from "fast-png";

/**
 * Recolors a PNG to a neutral mid grey while keeping its alpha channel.
 * Used for tinted entry images sent to chat webhooks (Discord), so the
 * artwork stays readable on both light and dark themes.
 * Returns null when the image cannot be processed (e.g. not a PNG).
 */
export function greyscalePng(bytes: Uint8Array): Uint8Array | null {
  try {
    const img = decode(bytes);
    const { width, height, channels, depth } = img;
    if (depth !== 8 || (channels !== 4 && channels !== 2 && channels !== 3 && channels !== 1)) {
      return null;
    }
    const src = img.data as Uint8Array;
    const out = new Uint8Array(width * height * 4);
    const GREY = 0x9a; // mid grey, visible on light and dark backgrounds

    for (let i = 0, p = 0; p < width * height; p++) {
      let alpha = 255;
      if (channels === 4) alpha = src[p * 4 + 3];
      else if (channels === 2) alpha = src[p * 2 + 1];
      out[i++] = GREY;
      out[i++] = GREY;
      out[i++] = GREY;
      out[i++] = alpha;
    }

    return encode({ width, height, channels: 4, depth: 8, data: out });
  } catch {
    return null;
  }
}
