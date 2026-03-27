import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import type { ChildProcess } from "node:child_process";
import { AgentTree } from "./tree.js";
import { SpawnToolParams, makeSpawnExecute } from "./tools/spawn.js";
import { HaltToolParams, makeHaltExecute } from "./tools/halt.js";
import { makeSpawnHandler, MINIONS_WIDGET } from "./commands/spawn.js";
import { makeHaltHandler } from "./commands/halt.js";
import { renderCall, renderResult } from "./render.js";
import { logger, LOG_FILE } from "./logger.js";

export default function (pi: ExtensionAPI): void {
  logger.debug("extension", "loaded", { logFile: LOG_FILE });

  const tree = new AgentTree();
  const handles = new Map<string, ChildProcess | null>();

  pi.registerTool({
    name: "spawn",
    label: "Spawn Minion",
    description:
      "Delegate a task to a named agent with isolated context. " +
      "Agents are discovered from ~/.pi/agent/agents/ and .pi/agents/. " +
      "The agent runs as a separate pi process with its own context window.",
    promptSnippet: "Spawn a named agent for isolated task delegation",
    promptGuidelines: [
      "Use spawn when a task benefits from isolated context or parallel execution.",
      "Available agents are user-defined in ~/.pi/agent/agents/ -- use the agent name from its frontmatter.",
      "Check agent availability by trying to spawn; the tool will list available agents if the name is not found.",
    ],
    parameters: SpawnToolParams,
    execute: makeSpawnExecute(tree, handles),
    renderCall,
    renderResult,
  });

  pi.registerTool({
    name: "halt",
    label: "Halt Minion",
    description:
      "Abort a running minion by ID. Use id='all' to halt all running minions. " +
      "The agent process receives SIGTERM, then SIGKILL after 5 seconds.",
    parameters: HaltToolParams,
    execute: makeHaltExecute(tree, handles),
  });

  pi.registerCommand("spawn", {
    description: "Spawn a minion: /spawn <task> [--model <model>]",
    handler: makeSpawnHandler(tree, handles, pi),
  });

  pi.registerCommand("halt", {
    description: "Halt minion(s): /halt <id | all>",
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

  // Clear the minion activity widget when the user sends their next message
  pi.on("before_agent_start", (_event, ctx) => {
    ctx.ui.setWidget(MINIONS_WIDGET, undefined);
  });

  // Render minion-result messages from /spawn so they display cleanly in the TUI
  pi.registerMessageRenderer("minion-result", (message, { expanded }, theme) => {
    const header = theme.fg("accent", "▸ minion") + theme.fg("dim", " result");
    const raw = typeof message.content === "string"
      ? message.content
      : message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const lines = raw.split("\n");
    const body = expanded ? raw : lines.slice(0, 4).join("\n");
    const suffix = !expanded && lines.length > 4
      ? "\n" + theme.fg("dim", `… ${lines.length - 4} more lines`)
      : "";
    return new Text(`${header}\n${theme.fg("toolOutput", body)}${suffix}`, 0, 0);
  });
}
