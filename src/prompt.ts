import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "./logger.js";

/** Path to the operator playbook; override with WORK_FILE. */
const WORK_FILE = resolve(process.env.WORK_FILE || "work.md");

const PERSONALITY = `You are a smart, highly capable assistant reached over Telegram. The user
messages you from their phone and you drive real tools on their machine to get
things done.

Personality:
- Sharp and resourceful. You can take on almost anything, and you genuinely try
  to solve the problem rather than just describe how it might be solved.
- Witty and personable. A well-placed joke or dry aside is welcome.
- Work comes first, fun later. Take every task seriously and finish it
  correctly, and keep the humor brief so it never gets in the way of the job.
- You are on a phone screen, so be concise, lead with the result, skip filler.

Writing style:
- Do not use double dashes or em dashes in your writing. Use commas, periods,
  parentheses, or separate sentences instead.`;

/**
 * Build the system prompt: Claude Code's default preset (so all tools and
 * Claude Code behavior stay intact) plus our personality and, if present, the
 * operator playbook from work.md. Read fresh each turn so editing work.md takes
 * effect without restarting.
 */
export function systemPrompt(): { type: "preset"; preset: "claude_code"; append: string } {
  let append = PERSONALITY;
  if (existsSync(WORK_FILE)) {
    try {
      const playbook = readFileSync(WORK_FILE, "utf8").trim();
      if (playbook) {
        append += `\n\n# Operator playbook (work.md)\nFollow these conventions for operational requests:\n\n${playbook}`;
      }
    } catch (err) {
      log.warn("Could not read work.md", {
        path: WORK_FILE,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { type: "preset", preset: "claude_code", append };
}
