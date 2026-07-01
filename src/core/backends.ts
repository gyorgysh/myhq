import { runTurn as claudeAgentSdkRunTurn, type RunOptions, type RunResult } from "../claude/runner.js";

/**
 * One agent runtime this bot can drive a turn through. Today there is exactly
 * one — the real Claude Agent SDK, which spawns the headless `claude` CLI and
 * gets its whole tool belt (Read/Write/Edit/Bash/Glob/Grep/...), permission
 * hook, and resumable sessions for free. This interface is the seam a future
 * backend (a generic OpenAI/xAI-compatible tool-loop adapter, or a Codex CLI
 * adapter) would implement, so every caller below already goes through the
 * registry rather than importing `runTurn` directly.
 */
export interface AgentBackend {
  id: string;
  displayName: string;
  runTurn(opts: RunOptions): Promise<RunResult>;
}

const CLAUDE_AGENT_SDK: AgentBackend = {
  id: "claude-agent-sdk",
  displayName: "Claude (Agent SDK)",
  runTurn: claudeAgentSdkRunTurn,
};

const backends = new Map<string, AgentBackend>([[CLAUDE_AGENT_SDK.id, CLAUDE_AGENT_SDK]]);

/** Look up a backend by id, falling back to the default (Claude Agent SDK)
 *  when the id is unset or doesn't match a registered backend. */
export function getBackend(id?: string): AgentBackend {
  return (id && backends.get(id)) || CLAUDE_AGENT_SDK;
}

/** Every registered backend (for a future model/backend picker). */
export function listBackends(): AgentBackend[] {
  return [...backends.values()];
}
