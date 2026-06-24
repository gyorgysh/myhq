import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { config } from "../config.js";

/** True if voice transcription is configured (an API key is present). */
export function voiceEnabled(): boolean {
  return Boolean(config.OPENAI_API_KEY);
}

/**
 * Transcribe an audio file via an OpenAI-compatible /audio/transcriptions
 * endpoint. Telegram voice notes are OGG/Opus, which Whisper accepts directly.
 * Returns the recognized text (trimmed).
 */
export async function transcribeAudio(filePath: string): Promise<string> {
  if (!config.OPENAI_API_KEY) {
    throw new Error("Voice transcription is not configured (set OPENAI_API_KEY).");
  }

  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("model", config.TRANSCRIBE_MODEL);
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "audio/ogg" }),
    basename(filePath),
  );

  const res = await fetch(`${config.TRANSCRIBE_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Transcription failed (HTTP ${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
