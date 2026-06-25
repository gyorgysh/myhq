import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { runTurn, AUTO_ALLOWED_TOOLS } from "../claude/runner.js";
import { memoryMcp } from "../mcp/memory.js";
import { workers } from "./workers.js";
import { getSkill } from "./skills.js";
import { getProvider } from "./providers.js";
import { resolveSecret } from "./vault.js";
import { config } from "../config.js";
import { log } from "../logger.js";

const COUNCIL_FILE = join(config.WORKDIR, "..", "council.jsonl");

export interface CouncilVote {
  leadId: string;
  leadName: string;
  portfolio?: string;
  vote: "support" | "oppose" | "abstain";
  reason: string;
  concern: string;
}

export interface CouncilSession {
  id: string;
  proposal: string;
  votes: CouncilVote[];
  supportCount: number;
  opposeCount: number;
  abstainCount: number;
  createdAt: number;
}

/** Parse structured VOTE/REASON/CONCERN from a lead's free-form reply. */
function parseVote(text: string): Pick<CouncilVote, "vote" | "reason" | "concern"> {
  const voteMatch = /VOTE\s*:\s*(SUPPORT|OPPOSE|ABSTAIN)/i.exec(text);
  const reasonMatch = /REASON\s*:\s*(.+)/i.exec(text);
  const concernMatch = /CONCERN\s*:\s*(.+)/i.exec(text);

  const voteRaw = (voteMatch?.[1] ?? "").toUpperCase();
  const vote: CouncilVote["vote"] =
    voteRaw === "SUPPORT" ? "support" : voteRaw === "OPPOSE" ? "oppose" : "abstain";

  return {
    vote,
    reason: reasonMatch?.[1]?.trim() ?? "(no reason given)",
    concern: concernMatch?.[1]?.trim() ?? "(no concern stated)",
  };
}

/**
 * Run a council vote on a proposal. Calls every enabled Lead worker in
 * parallel (bypassPermissions, fast haiku-level prompt) and collects their
 * structured SUPPORT/OPPOSE votes with reasoning.
 */
export async function runCouncil(proposal: string): Promise<CouncilSession> {
  const leads = workers.list().filter((w) => w.role === "lead" && w.enabled);

  if (leads.length === 0) {
    const session: CouncilSession = {
      id: randomBytes(4).toString("hex"),
      proposal,
      votes: [],
      supportCount: 0,
      opposeCount: 0,
      abstainCount: 0,
      createdAt: Date.now(),
    };
    persistSession(session);
    return session;
  }

  const votePromises = leads.map(async (lead): Promise<CouncilVote> => {
    const skill = lead.skillId ? getSkill(lead.skillId) : undefined;
    const domainContext = [skill?.prompt, lead.systemPrompt].filter(Boolean).join("\n\n") || undefined;
    const provider = lead.providerId ? getProvider(lead.providerId) : undefined;
    const env = provider
      ? {
          ANTHROPIC_BASE_URL: provider.baseUrl,
          ANTHROPIC_AUTH_TOKEN: resolveSecret(provider.authToken),
          ANTHROPIC_API_KEY: undefined,
        }
      : undefined;

    const portfolio = lead.portfolio ?? "General";
    const prompt =
      `You are ${lead.name}, the ${portfolio} Lead.\n\n` +
      `The President is putting this proposal to a council vote:\n\n` +
      `"${proposal}"\n\n` +
      `Evaluate it strictly from the ${portfolio} domain perspective.\n\n` +
      `Reply in EXACTLY this format (no other text, no preamble):\n` +
      `VOTE: SUPPORT\n` +
      `REASON: [one sentence — why this benefits ${portfolio}]\n` +
      `CONCERN: [one sentence — biggest risk or caveat from ${portfolio} angle]\n\n` +
      `or replace SUPPORT with OPPOSE or ABSTAIN.`;

    const abort = new AbortController();
    let output = "";
    try {
      await runTurn({
        prompt,
        cwd: lead.cwd || config.WORKDIR,
        model: lead.model,
        env,
        systemPromptAppend: domainContext,
        persona: lead.persona,
        permissionMode: "bypassPermissions",
        abortController: abort,
        mcpServers: { memory: memoryMcp },
        canUseTool: async (name, input) => {
          if (AUTO_ALLOWED_TOOLS.has(name)) return { behavior: "allow", updatedInput: input };
          return { behavior: "deny", message: "Council vote is read-only." };
        },
        onText: (delta) => { output += delta; },
        onToolUse: () => {},
        onSessionId: () => {},
      });
    } catch (err) {
      log.warn("Council vote failed for lead", { lead: lead.name, error: err instanceof Error ? err.message : String(err) });
      return { leadId: lead.id, leadName: lead.name, portfolio: lead.portfolio, vote: "abstain", reason: "Error during vote.", concern: "Could not complete the council turn." };
    }

    const parsed = parseVote(output);
    return { leadId: lead.id, leadName: lead.name, portfolio: lead.portfolio, ...parsed };
  });

  const votes = await Promise.all(votePromises);

  const session: CouncilSession = {
    id: randomBytes(4).toString("hex"),
    proposal,
    votes,
    supportCount: votes.filter((v) => v.vote === "support").length,
    opposeCount: votes.filter((v) => v.vote === "oppose").length,
    abstainCount: votes.filter((v) => v.vote === "abstain").length,
    createdAt: Date.now(),
  };

  persistSession(session);
  log.info("Council vote complete", { id: session.id, support: session.supportCount, oppose: session.opposeCount });
  return session;
}

function persistSession(session: CouncilSession): void {
  try {
    mkdirSync(dirname(COUNCIL_FILE), { recursive: true });
    appendFileSync(COUNCIL_FILE, JSON.stringify(session) + "\n");
  } catch (err) {
    log.warn("Failed to persist council session", { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Format a council session for Telegram. */
export function formatCouncilTelegram(s: CouncilSession): string {
  const total = s.votes.length;
  const result =
    total === 0
      ? "No leads to vote."
      : s.supportCount > s.opposeCount
      ? `✅ SUPPORT wins (${s.supportCount}–${s.opposeCount})`
      : s.opposeCount > s.supportCount
      ? `❌ OPPOSE wins (${s.opposeCount}–${s.supportCount})`
      : `⚖️ Tied (${s.supportCount}–${s.opposeCount})`;

  const lines: string[] = [
    `🗳 **Council vote** on: _${s.proposal}_`,
    ``,
    result,
    ``,
  ];

  for (const v of s.votes) {
    const icon = v.vote === "support" ? "✅" : v.vote === "oppose" ? "❌" : "⬜";
    lines.push(`${icon} **${v.leadName}**${v.portfolio ? ` (${v.portfolio})` : ""}`);
    lines.push(`→ ${v.reason}`);
    lines.push(`⚠ ${v.concern}`);
    lines.push(``);
  }

  return lines.join("\n").trim();
}
