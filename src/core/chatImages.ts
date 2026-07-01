/**
 * Chat image intake — validates and normalises images attached to a panel chat
 * message before they are handed to the model as inline vision input.
 *
 * The panel sends images as base64 (optionally as a `data:` URL). This is
 * untrusted input from the browser, so we defend against "weird payloads":
 *
 *  - only a small allowlist of real image MIME types is accepted;
 *  - the declared MIME type is cross-checked against the actual file magic
 *    bytes, so a script/HTML blob can't masquerade as an image;
 *  - per-image and per-message byte budgets are enforced;
 *  - the number of images per message is capped.
 *
 * Anything that fails is dropped (not fatal) so a single bad attachment can't
 * block the whole message; the caller gets back only the images that passed.
 */

import type { ImageInput } from "../claude/runner.js";

/** MIME types the model can view inline. Keep in sync with the panel picker. */
const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/** Max decoded bytes for a single image (~8 MB). */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Max combined decoded bytes across all images in one message (~24 MB). */
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
/** Max images per message. */
const MAX_IMAGES = 8;

/** Raw attachment as it arrives from the panel. */
export interface RawChatImage {
  /** base64 bytes, or a full `data:<mime>;base64,<bytes>` URL. */
  base64?: string;
  /** Declared MIME type; ignored if a data URL carries its own. */
  mediaType?: string;
}

/**
 * Sniff the media type from the leading magic bytes of a decoded image buffer.
 * Returns undefined when the signature matches none of the allowed types, which
 * is how we reject non-image payloads dressed up with an image MIME.
 */
function sniffMediaType(buf: Buffer): string | undefined {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buf.length >= 6 && buf.toString("ascii", 0, 6).startsWith("GIF8")) {
    return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

/** Pull the base64 payload and any embedded MIME type out of a data URL. */
function parseDataUrl(raw: string): { base64: string; mediaType?: string } {
  const m = /^data:([\w/+.-]+)?(?:;charset=[\w-]+)?;base64,(.*)$/is.exec(raw.trim());
  if (m) return { base64: m[2] ?? "", mediaType: m[1] };
  return { base64: raw.trim() };
}

/**
 * Validate and normalise a batch of attached images into safe ImageInputs.
 * Silently drops anything that fails a check; returns at most MAX_IMAGES that
 * together stay under MAX_TOTAL_BYTES.
 */
export function sanitizeChatImages(raw: unknown): ImageInput[] {
  if (!Array.isArray(raw)) return [];
  const out: ImageInput[] = [];
  let total = 0;

  for (const item of raw) {
    if (out.length >= MAX_IMAGES) break;
    if (!item || typeof item !== "object") continue;
    const { base64, mediaType } = item as RawChatImage;
    if (typeof base64 !== "string" || base64.length === 0) continue;

    const parsed = parseDataUrl(base64);
    const payload = parsed.base64.replace(/\s+/g, "");
    if (!payload || !/^[A-Za-z0-9+/=]+$/.test(payload)) continue;

    let buf: Buffer;
    try {
      buf = Buffer.from(payload, "base64");
    } catch {
      continue;
    }
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) continue;
    if (total + buf.length > MAX_TOTAL_BYTES) break;

    // The real type is whatever the magic bytes say — never trust the label.
    const sniffed = sniffMediaType(buf);
    if (!sniffed || !ALLOWED_MEDIA_TYPES.has(sniffed)) continue;
    // If the caller declared a type, it must agree with the sniffed one.
    const declared = parsed.mediaType ?? mediaType;
    if (declared && declared.toLowerCase() !== sniffed) continue;

    total += buf.length;
    // Re-encode from the decoded buffer so we forward clean base64 with no
    // data-URL prefix or embedded whitespace.
    out.push({ base64: buf.toString("base64"), mediaType: sniffed });
  }

  return out;
}
