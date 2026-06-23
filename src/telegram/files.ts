import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Telegram } from "telegraf";

/**
 * Download an incoming Telegram file into <cwd>/uploads and return the absolute
 * path, so the next prompt can point Claude at it.
 */
export async function downloadIncomingFile(
  tg: Telegram,
  fileId: string,
  suggestedName: string,
  cwd: string,
): Promise<string> {
  const dir = join(cwd, "uploads");
  await mkdir(dir, { recursive: true });

  const link = await tg.getFileLink(fileId);
  const res = await fetch(link.href);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download file (HTTP ${res.status})`);
  }

  const safeName = suggestedName.replace(/[^\w.\-]+/g, "_") || `file_${Date.now()}`;
  const dest = join(dir, safeName);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(dest));
  return dest;
}
