import type { AgentToolResult, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { ResultQueue } from "../queue.js";
import { formatDuration, formatUsage } from "../render.js";
import type { SubsessionManager } from "../subsessions/manager.js";
import { getMinionHistory } from "../subsessions/observability.js";
import type { AgentTree } from "../tree.js";
import type { AgentNode } from "../types.js";

// Shared validation helpers

/**
 * Result of validating a minion for steering operations
 */
export type SteerValidationResult =
  | { success: false; error: string; errorType: "error" | "info" }
  | { success: true; node: AgentNode; steer: (text: string) => Promise<void> };

/**
 * Validates that a target can be steered and returns the node/steer function or error details
 */
export function validateSteerTarget(
  tree: AgentTree,
  subsessionManager: SubsessionManager,
  target: string,
): SteerValidationResult {
  const node = tree.resolve(target);
  if (!node) {
    return {
      success: false,
      error: `Minion not found: ${target}`,
      errorType: "error",
    };
  }

  if (node.status !== "running") {
    return {
      success: false,
      error: `Minion ${node.name} (${node.id}) is not running (status: ${node.status}).`,
      errorType: "info",
    };
  }

  const session = subsessionManager.getSession(node.id);
  if (!session) {
    return {
      success: false,
      error: `No active session for ${node.name} (${node.id}).`,
      errorType: "error",
    };
  }

  return { success: true, node, steer: (text) => session.steer(text) };
}

/**
 * Executes steering operation and returns success message
 */
export async function executeSteering(
  node: AgentNode,
  steer: (text: string) => Promise<void>,
  message: string,
): Promise<string> {
  const wrappedMessage =
    `[USER STEER] The user has provided an additional directive while you are working.\n` +
    `DO NOT abandon or restart your current task. Continue where you left off.\n` +
    `Treat this steer as a supplementary task to handle alongside your original assignment.\n` +
    `When you deliver your final output, include results from both your original task AND this steer directive.\n` +
    `Explicitly note that you received a user steer and include the steer task verbatim.\n\n` +
    `User's steer message: ${message}`;
  await steer(wrappedMessage);
  return `Steered ${node.name} (${node.id}): ${message}`;
}

// list_minions

export const ListMinionsParams = Type.Object(
  {
    target: Type.Optional(
      Type.String({ description: "Minion ID or name to inspect in detail. Omit to list all minions." }),
    ),
  },
  {
    description:
      "List all running and completed minions. Optionally pass a target ID or name to see detailed status and full output.",
  },
);
export type ListMinionsParams = Static<typeof ListMinionsParams>;

export interface MinionInfo {
  id: string;
  name: string;
  task: string;
  status: "running";
  mode: "foreground" | "background";
  lastActivity?: string;
}

export interface PendingMinionInfo {
  id: string;
  name: string;
  task: string;
  completedAt: number;
  exitCode: number;
}

export function listMinions(tree: AgentTree, queue: ResultQueue) {
  return async function execute(
    _toolCallId: string,
    params: ListMinionsParams,
    _signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> {
    // Detail mode: show a specific minion (replaces show_minion)
    if (params.target) {
      const text = buildShowMinionText(tree, queue, params.target);
      if (text === null) {
        throw new Error(`Minion not found: ${params.target}`);
      }
      return { content: [{ type: "text", text }], details: undefined };
    }

    // List mode: show all running + pending
    const running: MinionInfo[] = tree.getRunning().map((n) => ({
      id: n.id,
      name: n.name,
      task: n.task,
      status: "running" as const,
      mode: (n.detached ? "background" : "foreground") as "foreground" | "background",
      lastActivity: n.lastActivity,
    }));
    const pending: PendingMinionInfo[] = queue.getPending().map((r) => ({
      id: r.id,
      name: r.name,
      task: r.task,
      completedAt: r.completedAt,
      exitCode: r.exitCode,
    }));

    const lines: string[] = [];
    if (running.length === 0 && pending.length === 0) {
      lines.push("No active minions.");
    } else {
      lines.push(`Running (${running.length}):`);
      for (const m of running) {
        const mode = m.mode === "background" ? "[bg]" : "[fg]";
        const activity = m.lastActivity ? ` -- ${m.lastActivity}` : "";
        lines.push(`  ${m.name} (${m.id}) ${mode}: ${m.task}${activity}`);
      }
      lines.push(`Completed (${pending.length}):`);
      for (const p of pending) {
        lines.push(`  ${p.name} (${p.id}): exit ${p.exitCode}`);
      }
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { running, pending },
    };
  };
}

// steer_minion

export const SteerMinionParams = Type.Object({
  target: Type.String({ description: "Minion ID or name to steer" }),
  message: Type.String({
    description: "Message to inject into the minion's context before its next LLM call",
  }),
});
export type SteerMinionParams = Static<typeof SteerMinionParams>;

export function steerMinion(tree: AgentTree, subsessionManager: SubsessionManager) {
  return async function execute(
    _toolCallId: string,
    params: SteerMinionParams,
    _signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> {
    const validation = validateSteerTarget(tree, subsessionManager, params.target);
    if (!validation.success) {
      throw new Error(validation.error);
    }

    const successMessage = await executeSteering(validation.node, validation.steer, params.message);
    return {
      content: [{ type: "text", text: successMessage }],
      details: undefined,
    };
  };
}

// show_minion

export function buildShowMinionText(
  tree: AgentTree,
  queue: ResultQueue,
  target: string,
): string | null {
  const node = tree.resolve(target);
  const result = node ? queue.get(node.id) : queue.get(target);

  if (!node && !result) {
    return null;
  }

  const lines: string[] = [];

  if (node) {
    // ── Header ──────────────────────────────────────────────────────────
    const mode = node.detached ? "[bg]" : "[fg]";
    lines.push(`${node.name} (${node.id}) ${mode}`);
    if (node.agentName && node.agentName !== "ephemeral") {
      lines.push(`  Agent:    ${node.agentName}`);
    }
    if (node.model) {
      lines.push(`  Model:    ${node.model}`);
    }
    lines.push(`  Status:   ${node.status}`);
    lines.push(`  Task:     ${node.task}`);

    if (node.status === "running") {
      lines.push(`  Running:  ${formatDuration(Date.now() - node.startTime)}`);
      if (node.lastActivity) lines.push(`  Activity: ${node.lastActivity}`);
    }

    const usageText = formatUsage(node.usage);
    if (usageText) lines.push(`  Usage:    ${usageText}`);
    if (node.error) lines.push(`  Error:    ${node.error}`);

    // ── Session file path ────────────────────────────────────────────────
    if (node.sessionPath) {
      lines.push("");
      lines.push(`  Session file:`);
      lines.push(`    ${node.sessionPath}`);
      lines.push(`  Export:  pi --export ${node.sessionPath}`);
      lines.push(`  Resume:  pi --session ${node.sessionPath}`);
    }

    // ── Activity history ─────────────────────────────────────────────────
    const history = node.activityHistory ?? getMinionHistory(node.id);
    if (history.length > 0) {
      lines.push("");
      lines.push(`  Activity log:`);
      for (const msg of history) {
        lines.push(`    ${msg}`);
      }
    }

    if (node.status === "running") {
      lines.push(`\n  Tip: Use '/minions show ${node.name}' for live activity stream`);
    }

    // ── Final output ─────────────────────────────────────────────────────
    const output = node.output ?? result?.output;
    if (output) {
      lines.push("");
      lines.push(`  Output:`);
      lines.push(output.split("\n").map((l) => `    ${l}`).join("\n"));
    }
  } else if (result) {
    // Fallback: only queue result, no tree node
    lines.push(`${result.name} (${result.id})`);
    lines.push(`  Exit code: ${result.exitCode}`);
    if (result.output) {
      lines.push("");
      lines.push(`  Output:`);
      lines.push(result.output.split("\n").map((l) => `    ${l}`).join("\n"));
    }
  }

  return lines.join("\n");
}

export const ShowMinionParams = Type.Object({
  target: Type.String({ description: "Minion ID or name to inspect" }),
});
export type ShowMinionParams = Static<typeof ShowMinionParams>;

export function showMinion(tree: AgentTree, queue: ResultQueue) {
  return async function execute(
    _toolCallId: string,
    params: ShowMinionParams,
    _signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> {
    const text = buildShowMinionText(tree, queue, params.target);
    if (text === null) {
      throw new Error(`Minion not found: ${params.target}`);
    }
    return { content: [{ type: "text", text }], details: undefined };
  };
}
