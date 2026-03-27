import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { AgentTree } from "./tree.js";
import { SpawnToolParams, makeSpawnExecute } from "./tools/spawn.js";
import { HaltToolParams, makeHaltExecute } from "./tools/halt.js";
import { ListAgentsParams, makeListAgentsExecute } from "./tools/list-agents.js";
import { makeSpawnHandler } from "./commands/spawn.js";
import { makeHaltHandler } from "./commands/halt.js";
import { renderCall, renderResult } from "./render.js";
import { logger, LOG_FILE } from "./logger.js";

export default function (pi: ExtensionAPI): void {
  logger.debug("extension", "loaded", { logFile: LOG_FILE });

  const tree = new AgentTree();
  const handles = new Map<string, AbortController>();

  pi.registerTool({
    name: "spawn",
    label: "Spawn Minion",
    description:
      "Delegate a task to a named agent or an ephemeral minion with isolated context. " +
      "If no agent name is provided, spawns an ephemeral minion with default capabilities. " +
      "Agents are discovered from ~/.pi/agent/agents/ and .pi/agents/. " +
      "The agent runs as an in-process session with its own context window.",
    promptSnippet: "Spawn a minion for isolated task delegation",
    promptGuidelines: [
      "Use spawn when a task benefits from isolated context or parallel execution.",
      "When the user explicitly requests spawning or delegating a task, always use this tool.",
      "Omit the agent parameter to spawn an ephemeral minion with default capabilities.",
      "Use list_agents to discover available named agents before spawning by name.",
      "When a spawn result says [HALTED], the user intentionally stopped the minion. Do NOT retry, re-spawn, or ask about it. Acknowledge and move on.",
    ],
    parameters: SpawnToolParams,
    execute: makeSpawnExecute(tree, handles),
    renderCall,
    renderResult,
  });

  pi.registerTool({
    name: "list_agents",
    label: "List Agents",
    description: "List available agents that can be spawned as minions.",
    promptSnippet: "List available agents for spawning",
    parameters: ListAgentsParams,
    execute: makeListAgentsExecute(),
  });

  pi.registerTool({
    name: "halt",
    label: "Halt Minion",
    description:
      "Abort a running minion by ID. Use id='all' to halt all running minions.",
    parameters: HaltToolParams,
    execute: makeHaltExecute(tree, handles),
  });

  pi.registerCommand("spawn", {
    description: "Spawn a minion: /spawn <task> [--model <model>]",
    handler: makeSpawnHandler(pi),
  });

  pi.registerCommand("halt", {
    description: "Halt minion(s): /halt <id | name | all>",
    handler: makeHaltHandler(tree, handles),
  });

  // Track model changes so we always know what model is active
  pi.on("session_start", (_event, ctx) => {
    logger.debug("session", "start", {
      model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none",
      cwd: ctx.cwd,
    });
  });

  pi.on("model_select", (event, _ctx) => {
    logger.debug("session", "model_select", {
      model: `${event.model.provider}/${event.model.id}`,
      name: event.model.name,
      source: event.source,
      previous: event.previousModel
        ? `${event.previousModel.provider}/${event.previousModel.id}`
        : "none",
    });
  });
}
