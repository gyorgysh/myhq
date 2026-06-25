import { config } from "../config.js";
import { createSkill, listSkills } from "./skills.js";
import { log } from "../logger.js";

const EXTRACT_MODEL = "claude-haiku-4-5-20251001";
const COST_THRESHOLD_USD = 0.05;
const DURATION_THRESHOLD_MS = 30_000;

interface SkillCandidate {
  name: string;
  description: string;
  body: string;
}

/** Make a direct Anthropic API call (no SDK process spawn) for lightweight extraction. */
async function callHaiku(prompt: string): Promise<string | null> {
  const apiKey = config.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: EXTRACT_MODEL,
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return data.content?.find((b) => b.type === "text")?.text ?? null;
  } catch {
    return null;
  }
}

/**
 * After an expensive turn, ask haiku whether it established a reusable procedure.
 * Runs asynchronously (fire-and-forget from the caller's perspective).
 */
export async function autoExtractSkill(
  userPrompt: string,
  toolCalls: Array<{ name: string; input: unknown }>,
  result: { text?: string; costUsd?: number; durationMs?: number },
): Promise<void> {
  if (!config.AUTO_SKILL_GENERATION) return;
  const { costUsd = 0, durationMs = 0 } = result;
  if (costUsd < COST_THRESHOLD_USD && durationMs < DURATION_THRESHOLD_MS) return;

  const toolSummary = toolCalls
    .slice(0, 20)
    .map((t) => {
      const inp = (t.input ?? {}) as Record<string, unknown>;
      const arg = String(inp.command ?? inp.file_path ?? inp.pattern ?? inp.path ?? "").slice(0, 60);
      return `- ${t.name}${arg ? `(${arg})` : ""}`;
    })
    .join("\n");

  const prompt =
    `A Claude Code turn just completed. User asked: "${userPrompt.slice(0, 200)}"\n\n` +
    `Tools used:\n${toolSummary || "(none)"}\n\n` +
    `Output tail:\n${(result.text ?? "").slice(-300)}\n\n` +
    `Did this establish a reusable procedure that would save time if repeated? ` +
    `If yes, return ONLY valid JSON: {"name":"<short slug>","description":"<one sentence>","body":"<full procedure steps>"}. ` +
    `If no, return null.`;

  const raw = await callHaiku(prompt);
  if (!raw) return;

  const trimmed = raw.trim();
  if (trimmed === "null" || trimmed.toLowerCase().startsWith("null")) return;

  let candidate: SkillCandidate;
  try {
    candidate = JSON.parse(trimmed) as SkillCandidate;
  } catch {
    // haiku returned non-JSON — not a match
    return;
  }

  if (!candidate?.name || !candidate?.body) return;

  // Skip if a skill with this name already exists.
  const existing = listSkills().find(
    (s) => s.name.toLowerCase() === candidate.name.toLowerCase(),
  );
  if (existing) {
    log.debug("Auto-skill: skipped (name exists)", { name: candidate.name });
    return;
  }

  const skill = createSkill({
    name: candidate.name,
    description: candidate.description ?? "",
    prompt: candidate.body,
  });
  log.info("Auto-skill created", { id: skill.id, name: skill.name, costUsd, durationMs });
}
