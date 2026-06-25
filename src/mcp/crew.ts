import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runTurn, AUTO_ALLOWED_TOOLS } from "../claude/runner.js";
import { memoryMcp } from "./memory.js";
import { tasksMcp } from "./tasks.js";
import { skillsMcp } from "./skills.js";
import { workers } from "../core/workers.js";
import { getSkill } from "../core/skills.js";
import { getProvider } from "../core/providers.js";
import { resolveSecret } from "../core/vault.js";
import { config } from "../config.js";
import { log } from "../logger.js";
import { registerAsk } from "../core/crewAsk.js";

const DELEGATIONS_FILE = join(config.WORKDIR, "..", "delegations.jsonl");

/** Append one record to the delegation log. */
function logDelegation(record: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(DELEGATIONS_FILE), { recursive: true });
    appendFileSync(DELEGATIONS_FILE, JSON.stringify({ ts: Date.now(), ...record }) + "\n");
  } catch (err) {
    log.warn("Failed to write delegation log", { error: err instanceof Error ? err.message : String(err) });
  }
}

export interface CrewMcpOptions {
  /** Called to send a message to all allowed user chats (president). */
  notify: (text: string) => Promise<void>;
  /** Chat id of the primary operator (for crew_ask). */
  primaryChatId: number;
  /** Id of the agent running these tools (for delegation log). */
  fromAgentId?: string;
}

/**
 * In-process MCP server giving agents crew coordination tools.
 * crew_delegate — hand off a task to a named Lead worker and get the output.
 * crew_report   — log a summary and optionally push it to the president over Telegram.
 * crew_ask_president — send the president a question and wait for a reply.
 */
export function createCrewMcp(opts: CrewMcpOptions) {
  return createSdkMcpServer({
    name: "crew",
    version: "1.0.0",
    tools: [
      tool(
        "crew_delegate",
        "Hand off a task to a Lead worker by id and receive its output. " +
          "Use this to leverage a specialist instead of doing the work yourself.",
        {
          leadId: z.string().describe("The id of the Lead worker to delegate to."),
          task: z.string().describe("Clear description of the task for the Lead to perform."),
          context: z.string().optional().describe("Optional extra context to pass to the Lead."),
        },
        async (args) => {
          const lead = workers.get(args.leadId);
          if (!lead) {
            return { content: [{ type: "text", text: `No worker found with id ${args.leadId}.` }] };
          }
          const skill = lead.skillId ? getSkill(lead.skillId) : undefined;
          const append = [skill?.prompt, lead.systemPrompt].filter(Boolean).join("\n\n") || undefined;
          const provider = lead.providerId ? getProvider(lead.providerId) : undefined;
          const env = provider
            ? {
                ANTHROPIC_BASE_URL: provider.baseUrl,
                ANTHROPIC_AUTH_TOKEN: resolveSecret(provider.authToken),
                ANTHROPIC_API_KEY: undefined,
              }
            : undefined;
          const prompt = args.context
            ? `${args.task}\n\nContext:\n${args.context}`
            : args.task;
          const abort = new AbortController();
          const startedAt = Date.now();
          let output = "";
          try {
            const res = await runTurn({
              prompt,
              cwd: lead.cwd,
              model: lead.model,
              env,
              systemPromptAppend: append,
              persona: lead.persona,
              permissionMode: "bypassPermissions",
              abortController: abort,
              mcpServers: { memory: memoryMcp, tasks: tasksMcp, skills: skillsMcp },
              canUseTool: async (name, input) => {
                if (AUTO_ALLOWED_TOOLS.has(name)) return { behavior: "allow", updatedInput: input };
                return { behavior: "deny", message: "Tool not permitted for delegated lead." };
              },
              onText: (delta) => { output += delta; },
              onToolUse: () => {},
              onSessionId: () => {},
            });
            const durationMs = Date.now() - startedAt;
            logDelegation({
              fromAgentId: opts.fromAgentId ?? "atlas",
              toAgentId: args.leadId,
              leadName: lead.name,
              task: args.task,
              outputTail: output.slice(-500),
              durationMs,
              costUsd: res.costUsd,
            });
            return { content: [{ type: "text", text: output || "(no output)" }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error("crew_delegate failed", { leadId: args.leadId, error: msg });
            return { content: [{ type: "text", text: `Delegation failed: ${msg}` }] };
          }
        },
      ),

      tool(
        "crew_report",
        "Record a summary of completed work in the delegation log and optionally " +
          "send it to the president over Telegram.",
        {
          summary: z.string().describe("Concise summary of the work done or outcome."),
          toPresident: z
            .boolean()
            .optional()
            .describe("If true, also sends the summary to the president via Telegram."),
        },
        async (args) => {
          logDelegation({
            fromAgentId: opts.fromAgentId ?? "atlas",
            type: "report",
            summary: args.summary,
          });
          if (args.toPresident) {
            try {
              await opts.notify(args.summary);
            } catch (err) {
              log.warn("crew_report notify failed", { error: err instanceof Error ? err.message : String(err) });
            }
          }
          return { content: [{ type: "text", text: "Report logged." + (args.toPresident ? " Sent to president." : "") }] };
        },
      ),

      tool(
        "crew_ask_president",
        "Send the president a question over Telegram and wait for their reply. " +
          "Blocks until the user responds or the approval timeout elapses.",
        {
          question: z.string().describe("The question to ask the president."),
        },
        async (args) => {
          const { id, promise } = registerAsk(opts.primaryChatId, config.APPROVAL_TIMEOUT_MS);
          log.info("crew_ask_president registered", { id, chatId: opts.primaryChatId });
          try {
            await opts.notify(`❓ Agent question (id ${id}):\n${args.question}`);
          } catch (err) {
            log.warn("crew_ask_president notify failed", { error: err instanceof Error ? err.message : String(err) });
          }
          try {
            const reply = await promise;
            return { content: [{ type: "text", text: reply }] };
          } catch (reason) {
            return { content: [{ type: "text", text: `No reply received: ${reason}` }] };
          }
        },
      ),
    ],
  });
}
