import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ChildProcess } from "node:child_process";
import { discoverAgents } from "../agents.js";
import { spawnAgent, getCurrentDepth, isAtMaxDepth } from "../spawn.js";
import { AgentTree } from "../tree.js";
import { generateId, pickMinionName } from "../minions.js";
import { logger } from "../logger.js";
import type { UsageStats } from "../types.js";
import { emptyUsage } from "../types.js";

export const SpawnToolParams = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke (must exist in ~/.pi/agent/agents/ or .pi/agents/)" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent (defaults to current)" })),
  model: Type.Optional(Type.String({ description: "Override the agent's model" })),
  maxDepth: Type.Optional(Type.Number({ description: "Max recursion depth (default: 3)" })),
});

export type SpawnToolParams = Static<typeof SpawnToolParams>;

export interface SpawnToolDetails {
  id: string;
  name: string;
  agentName: string;
  task: string;
  status: string;
  usage: UsageStats;
  model?: string;
  finalOutput: string;
}

const DEFAULT_MAX_DEPTH = 3;

export function makeSpawnExecute(
  tree: AgentTree,
  handles: Map<string, ChildProcess | null>,
) {
  return async function execute(
    _toolCallId: string,
    params: SpawnToolParams,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<SpawnToolDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<SpawnToolDetails>> {
    const maxDepth = params.maxDepth ?? DEFAULT_MAX_DEPTH;

    if (isAtMaxDepth(maxDepth)) {
      logger.debug("spawn:tool", "depth limit", { current: getCurrentDepth(), max: maxDepth });
      throw new Error(`Max depth reached (${getCurrentDepth()}/${maxDepth}). Cannot spawn more minions.`);
    }

    const { agents } = discoverAgents(ctx.cwd, "both");
    const config = agents.find((a) => a.name === params.agent);

    if (!config) {
      const available = agents.map((a) => a.name).join(", ") || "none";
      logger.debug("spawn:tool", "agent not found", { requested: params.agent, available });
      throw new Error(`Agent "${params.agent}" not found. Available: ${available}`);
    }

    const id = generateId();
    const name = pickMinionName(tree, id);
    logger.debug("spawn:tool", "start", { id, name, agent: params.agent, task: params.task });

    tree.add(id, name, params.task);
    handles.set(id, null);

    const emitPartial = (partial: Partial<SpawnToolDetails>) => {
      const node = tree.get(id);
      onUpdate?.({
        content: [{ type: "text", text: partial.finalOutput ?? "" }],
        details: {
          id, name, agentName: params.agent, task: params.task,
          status: node?.status ?? "running",
          usage: node?.usage ?? emptyUsage(),
          model: params.model ?? config.model,
          finalOutput: partial.finalOutput ?? "",
          ...partial,
        },
      });
    };

    const parentModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;

    const result = await spawnAgent(config, params.task, {
      signal,
      overrideModel: params.model,
      parentModel,
      onProcess: (proc) => handles.set(id, proc),
      onEvent: (e) => {
        if (e.type === "message_end") {
          tree.updateUsage(id, {
            input: (tree.get(id)?.usage.input ?? 0) + (e.usage.input ?? 0),
            output: (tree.get(id)?.usage.output ?? 0) + (e.usage.output ?? 0),
            cacheRead: (tree.get(id)?.usage.cacheRead ?? 0) + (e.usage.cacheRead ?? 0),
            cacheWrite: (tree.get(id)?.usage.cacheWrite ?? 0) + (e.usage.cacheWrite ?? 0),
            cost: (tree.get(id)?.usage.cost ?? 0) + (e.usage.cost ?? 0),
            contextTokens: e.usage.contextTokens ?? 0,
            turns: (tree.get(id)?.usage.turns ?? 0) + 1,
          });
          emitPartial({ finalOutput: e.text });
        }
      },
    });

    const status = result.exitCode === 0 ? "completed" : "failed";
    logger.debug("spawn:tool", status, { id, exitCode: result.exitCode, outputLen: result.finalOutput.length });
    tree.updateStatus(id, status === "completed" ? "completed" : "failed", result.exitCode, result.error);
    handles.delete(id);

    const node = tree.get(id);
    const details: SpawnToolDetails = {
      id, name, agentName: params.agent, task: params.task,
      status, usage: node?.usage ?? result.usage,
      model: params.model ?? config.model,
      finalOutput: result.finalOutput,
    };

    if (result.exitCode !== 0) {
      throw new Error(result.error ?? `Agent exited with code ${result.exitCode}`);
    }

    return {
      content: [{ type: "text", text: result.finalOutput || "(no output)" }],
      details,
    };
  };
}
