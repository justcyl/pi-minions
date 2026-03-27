import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { discoverAgents } from "../agents.js";
import { runMinionSession } from "../spawn.js";
import { formatToolCall } from "../render.js";
import { AgentTree } from "../tree.js";
import { generateId, pickMinionName, defaultMinionTemplate } from "../minions.js";
import { logger } from "../logger.js";
import type { AgentConfig, UsageStats } from "../types.js";
import { emptyUsage } from "../types.js";

export const SpawnToolParams = Type.Object({
  agent: Type.Optional(Type.String({
    description: "Name of the agent to invoke. If omitted, spawns an ephemeral minion with default capabilities.",
  })),
  task: Type.String({ description: "Task to delegate to the agent" }),
  model: Type.Optional(Type.String({ description: "Override the agent's model" })),
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
  activity?: string;
  spinnerFrame?: number;
}

export function makeSpawnExecute(
  tree: AgentTree,
  handles: Map<string, AbortController>,
) {
  return async function execute(
    _toolCallId: string,
    params: SpawnToolParams,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<SpawnToolDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<SpawnToolDetails>> {
    const id = generateId();
    const name = pickMinionName(tree, id);

    let config: AgentConfig;
    if (params.agent) {
      const { agents } = discoverAgents(ctx.cwd, "both");
      const found = agents.find((a) => a.name === params.agent);
      if (!found) {
        const available = agents.map((a) => a.name).join(", ") || "none";
        logger.debug("spawn:tool", "agent not found", { requested: params.agent, available });
        throw new Error(`Agent "${params.agent}" not found. Available: ${available}`);
      }
      config = found;
    } else {
      config = defaultMinionTemplate(name, {
        model: params.model,
      });
    }

    logger.debug("spawn:tool", "start", { id, name, agent: params.agent ?? "ephemeral", task: params.task });

    tree.add(id, name, params.task);
    const controller = new AbortController();
    handles.set(id, controller);

    // Forward parent signal to our controller
    if (signal) {
      const onAbort = () => controller.abort();
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    // Track last known streaming state so spinner ticks don't clobber it
    let lastActivity: string | undefined;
    let lastOutput = "";
    let spinnerFrame = 0;

    const emitUpdate = (partial?: Partial<SpawnToolDetails>) => {
      if (partial?.activity !== undefined) lastActivity = partial.activity;
      if (partial?.finalOutput !== undefined) lastOutput = partial.finalOutput;
      const node = tree.get(id);
      onUpdate?.({
        content: [{ type: "text", text: lastOutput }],
        details: {
          id, name, agentName: params.agent ?? config.name, task: params.task,
          status: node?.status ?? "running",
          usage: node?.usage ?? emptyUsage(),
          model: params.model ?? config.model,
          finalOutput: lastOutput,
          activity: lastActivity,
          spinnerFrame,
        },
      });
    };

    // Animate spinner at ~80ms for smooth braille rotation
    const spinnerInterval = setInterval(() => {
      spinnerFrame++;
      emitUpdate();
    }, 80);

    try {
      ctx.ui.setWorkingMessage(`minion ${name} working…`);

      const result = await runMinionSession(config, params.task, {
        id,
        name,
        signal: controller.signal,
        modelRegistry: ctx.modelRegistry,
        parentModel: ctx.model,
        cwd: ctx.cwd,
        onToolActivity: (activity) => {
          if (activity.type === "start") {
            const desc = formatToolCall(activity.toolName, {});
            ctx.ui.setWorkingMessage(`${name}: ${desc}`);
            emitUpdate({ activity: `→ ${desc}` });
          }
          if (activity.type === "end") {
            ctx.ui.setWorkingMessage(`${name} working…`);
          }
        },
        onToolOutput: (toolName, delta) => {
          const line = delta.trimEnd().split("\n").filter(Boolean).at(-1)?.slice(0, 80) ?? "";
          if (line) {
            emitUpdate({ activity: `${toolName}: ${line}` });
          }
        },
        onTextDelta: (_delta, fullText) => {
          const preview = fullText.split("\n").filter(Boolean).at(-1)?.slice(0, 80) ?? "";
          emitUpdate({ activity: preview, finalOutput: preview });
        },
        onTurnEnd: (turnCount) => {
          ctx.ui.setWorkingMessage(`${name}: turn ${turnCount}`);
          // Don't emit "turn X" as activity — it overwrites the last
          // meaningful status (tool call or text preview). The turn count
          // shows in the working message instead.
        },
      });

      // Don't overwrite "aborted" status — halt already set it
      const currentNode = tree.get(id);
      const status = currentNode?.status === "aborted"
        ? "aborted"
        : result.exitCode === 0 ? "completed" : "failed";

      if (status !== "aborted") {
        logger.debug("spawn:tool", status, { id, exitCode: result.exitCode, outputLen: result.finalOutput.length });
        tree.updateStatus(id, status, result.exitCode, result.error);
      }
      tree.updateUsage(id, result.usage);

      const node = tree.get(id);
      const details: SpawnToolDetails = {
        id, name, agentName: params.agent ?? config.name, task: params.task,
        status, usage: node?.usage ?? result.usage,
        model: params.model ?? config.model,
        finalOutput: result.finalOutput,
      };

      if (status === "aborted") {
        throw new Error(`[HALTED] Minion ${name} was stopped by the user. This is intentional — do NOT retry or re-spawn.`);
      }

      if (result.exitCode !== 0) {
        throw new Error(result.error ?? `Agent exited with code ${result.exitCode}`);
      }

      return {
        content: [{ type: "text", text: result.finalOutput || "(no output)" }],
        details,
      };
    } finally {
      clearInterval(spinnerInterval);
      ctx.ui.setWorkingMessage();
      handles.delete(id);
    }
  };
}
