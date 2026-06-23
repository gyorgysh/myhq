import { createReadStream, existsSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { Telegram } from "telegraf";
import { z } from "zod";

const MAX_FILE_BYTES = 50 * 1024 * 1024; // Telegram bot upload limit.
// Telegram renders these inline when sent as a photo (10MB cap for photos);
// other types go as documents so they download intact.
const PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * Build a per-chat MCP server exposing `send_file`, letting Claude deliberately
 * deliver a generated file/screenshot back to the Telegram conversation.
 * Tool is addressable to the model as `mcp__telegram__send_file`.
 */
export function createTelegramMcp(tg: Telegram, chatId: number, cwd: string) {
  return createSdkMcpServer({
    name: "telegram",
    version: "1.0.0",
    tools: [
      tool(
        "send_file",
        "Send a file from the local filesystem to the user's Telegram chat. " +
          "Use this to deliver generated files, images, or documents back to the user.",
        {
          path: z.string().describe("Path to the file. Relative paths resolve against the cwd."),
          caption: z.string().optional().describe("Optional caption shown with the file."),
        },
        async (args) => {
          const full = isAbsolute(args.path) ? args.path : resolve(cwd, args.path);
          if (!existsSync(full) || !statSync(full).isFile()) {
            return {
              content: [{ type: "text", text: `Error: no file at ${full}` }],
              isError: true,
            };
          }
          if (statSync(full).size > MAX_FILE_BYTES) {
            return {
              content: [{ type: "text", text: `Error: file exceeds Telegram's 50MB limit.` }],
              isError: true,
            };
          }
          const name = basename(full);
          const caption = args.caption ? { caption: args.caption } : {};
          // Images go as photos for an inline preview; large images and all
          // other files go as documents to preserve the original bytes.
          const asPhoto =
            PHOTO_EXTS.has(extname(full).toLowerCase()) && statSync(full).size <= MAX_PHOTO_BYTES;
          if (asPhoto) {
            await tg.sendPhoto(chatId, { source: createReadStream(full) }, caption);
          } else {
            await tg.sendDocument(chatId, { source: createReadStream(full), filename: name }, caption);
          }
          return {
            content: [{ type: "text", text: `Sent ${name} to the user as a ${asPhoto ? "photo" : "document"}.` }],
          };
        },
      ),
    ],
  });
}
