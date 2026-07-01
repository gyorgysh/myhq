import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { config } from "../config.js";
import { transcribeVosk, voskConfigured } from "./vosk.js";
import { t } from "./i18n/index.js";

/** True if voice transcription is configured for the selected provider. */
export function voiceEnabled(): boolean {
  if (config.TRANSCRIBE_PROVIDER === "vosk") return voskConfigured();
  if (config.TRANSCRIBE_PROVIDER === "xai") return Boolean(config.XAI_API_KEY);
  return Boolean(config.OPENAI_API_KEY);
}

/** A short hint telling the operator how to enable voice for their provider. */
export function voiceSetupHint(lang?: string): string {
  if (config.TRANSCRIBE_PROVIDER === "vosk") return t("voice_hint_vosk", lang);
  if (config.TRANSCRIBE_PROVIDER === "xai") return t("voice_hint_xai", lang);
  return t("voice_hint_openai", lang);
}

/** Transcribe a voice/audio file using the configured backend (openai | vosk | xai). */
export async function transcribeAudio(filePath: string): Promise<string> {
  if (config.TRANSCRIBE_PROVIDER === "vosk") return transcribeVosk(filePath);
  if (config.TRANSCRIBE_PROVIDER === "xai") return transcribeXai(filePath);
  return transcribeOpenAI(filePath);
}

/**
 * Transcribe via an OpenAI-compatible /audio/transcriptions endpoint (OpenAI,
 * Groq, …). Telegram voice notes are OGG/Opus, which Whisper accepts directly.
 */
async function transcribeOpenAI(filePath: string): Promise<string> {
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

/**
 * Transcribe via xAI's /v1/stt endpoint. Telegram voice notes are OGG/Opus, one
 * of xAI's auto-detected container formats, so the raw bytes go straight into
 * the multipart `file` field — no audio_format/sample_rate (those are only for
 * headerless raw PCM/mulaw/alaw).
 */
async function transcribeXai(filePath: string): Promise<string> {
  if (!config.XAI_API_KEY) {
    throw new Error("Voice transcription is not configured (set XAI_API_KEY).");
  }

  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "audio/ogg" }),
    basename(filePath),
  );

  const res = await fetch("https://api.x.ai/v1/stt", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.XAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Transcription failed (HTTP ${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
