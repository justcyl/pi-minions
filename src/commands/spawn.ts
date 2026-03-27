import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import type { ChildProcess } from "node:child_process";
import { spawnAgent, isAtMaxDepth } from "../spawn.js";
import { AgentTree } from "../tree.js";
import { generateId, pickMinionName } from "../minions.js";
import { formatToolCall } from "../render.js";
import { logger } from "../logger.js";
import type { AgentConfig } from "../types.js";

// Stable widget ID -- one slot for all minion activity, cleared on next agent turn
export const MINIONS_WIDGET = "minions";

export function parseSpawnArgs(args: string): { task: string; model?: string } | { error: string } {
  const tokens = args.trim().split(/\s+/);

  if (tokens.length === 0 || tokens[0] === "") {
    return { error: "Usage: /spawn <task> [--model <model>]" };
  }

  const modelFlagIdx = tokens.indexOf("--model");
  let model: string | undefined;
  const remaining: string[] = [];

  if (modelFlagIdx !== -1) {
    const modelValue = tokens[modelFlagIdx + 1];
    if (!modelValue || modelValue.startsWith("--")) {
      return { error: "Usage: /spawn <task> [--model <model>] -- --model requires a value" };
    }
    model = modelValue;
    for (let i = 0; i < tokens.length; i++) {
      if (i === modelFlagIdx || i === modelFlagIdx + 1) continue;
      remaining.push(tokens[i]!);
    }
  } else {
    remaining.push(...tokens);
  }

  const task = remaining.join(" ").trim();
  if (!task) {
    return { error: "Usage: /spawn <task> [--model <model>] -- task cannot be empty" };
  }

  return { task, model };
}

export function makeSpawnHandler(
  tree: AgentTree,
  handles: Map<string, ChildProcess | null>,
  pi: ExtensionAPI,
) {
  return async function handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const parsed = parseSpawnArgs(args);
    if ("error" in parsed) {
      ctx.ui.notify(parsed.error, "error");
      return;
    }

    if (isAtMaxDepth(3)) {
      ctx.ui.notify("Max depth reached. Cannot spawn more minions.", "error");
      return;
    }

    const id = generateId();
    const name = pickMinionName(tree, id);

    const parentModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
    const thinking = pi.getThinkingLevel();

    // Log raw ctx.model so we can diagnose inheritance issues
    logger.debug("spawn:cmd", "ctx.model", {
      raw: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id, name: ctx.model.name } : null,
      parentModel,
      userOverride: parsed.model,
      thinking,
    });

    const config: AgentConfig = {
      name,
      description: "Ephemeral minion",
      model: parsed.model ?? parentModel,
      thinking: thinking !== "off" ? (thinking as AgentConfig["thinking"]) : undefined,
      systemPrompt: "Complete the task you've been given.",
      source: "ephemeral",
      filePath: "",
    };

    tree.add(id, name, parsed.task);
    logger.debug("spawn:cmd", "start", { id, name, task: parsed.task, resolvedModel: config.model, thinking: config.thinking });

    // Widget state -- captured in closure, updated from background task
    const taskPreview = parsed.task.length > 60 ? `${parsed.task.slice(0, 60)}…` : parsed.task;
    const activity: Array<{ type: "tool" | "text"; line: string }> = [];
    let runStatus: "running" | "completed" | "failed" = "running";
    let resultLines: string[] = [];

    const renderWidget = (_tui: unknown, theme: { fg: (c: string, t: string) => string }) => {
      const lines: string[] = [];
      lines.push(theme.fg("dim", "/spawn ") + theme.fg("toolTitle", taskPreview));
      const icon = runStatus === "running" ? "⟳" : runStatus === "completed" ? "✓" : "✗";
      const iconColor = runStatus === "running" ? "muted" : runStatus === "completed" ? "success" : "error";
      lines.push(theme.fg(iconColor, icon) + " " + theme.fg("accent", name) + theme.fg("dim", ` (${id})`));
      if (runStatus === "running") {
        for (const { type, line } of activity.slice(-5)) {
          lines.push(type === "tool"
            ? theme.fg("muted", "  → ") + theme.fg("toolOutput", line)
            : theme.fg("dim", `  ${line}`));
        }
      } else {
        for (const l of resultLines) lines.push(theme.fg("toolOutput", `  ${l}`));
      }
      return new Text(lines.join("\n"), 0, 0);
    };

    const updateWidget = () =>
      ctx.ui.setWidget(MINIONS_WIDGET, renderWidget as Parameters<typeof ctx.ui.setWidget>[1]);

    // Show immediately -- user sees their command, handler returns, TUI stays interactive
    updateWidget();
    ctx.ui.notify(`Spawned ${name} (${id})`, "info");

    // Fire and forget -- detach from command handler so the TUI is not blocked.
    // ctx.ui.setWidget() and pi.sendMessage() are safe to call from background tasks.
    void (async () => {
      try {
        const result = await spawnAgent(config, parsed.task, {
          overrideModel: parsed.model,
          parentModel,
          onProcess: (proc) => handles.set(id, proc),
          onEvent: (e) => {
            if (e.type === "tool_start") {
              activity.push({ type: "tool", line: formatToolCall(e.toolName, e.args) });
              updateWidget();
            }
            if (e.type === "message_end" && e.text) {
              const preview = e.text.split("\n").filter(Boolean).at(-1) ?? "";
              if (preview) activity.push({ type: "text", line: preview.slice(0, 80) });
              updateWidget();
              const node = tree.get(id);
              if (node) {
                tree.updateUsage(id, {
                  input: node.usage.input + (e.usage.input ?? 0),
                  output: node.usage.output + (e.usage.output ?? 0),
                  cacheRead: node.usage.cacheRead + (e.usage.cacheRead ?? 0),
                  cacheWrite: node.usage.cacheWrite + (e.usage.cacheWrite ?? 0),
                  cost: node.usage.cost + (e.usage.cost ?? 0),
                  contextTokens: e.usage.contextTokens ?? 0,
                  turns: node.usage.turns + 1,
                });
              }
            }
          },
        });

        const status = result.exitCode === 0 ? "completed" : "failed";
        logger.debug("spawn:cmd", status, {
          id, exitCode: result.exitCode,
          outputLen: result.finalOutput.length,
          outputPreview: result.finalOutput.slice(0, 120) || "(empty)",
          stderr: result.stderr?.slice(0, 200),
        });

        tree.updateStatus(id, status === "completed" ? "completed" : "failed", result.exitCode, result.error);
        handles.delete(id);

        // Update widget to final state
        runStatus = status;
        const rawLines = result.finalOutput.split("\n").filter(Boolean);
        resultLines = rawLines.slice(0, 8);
        if (rawLines.length > 8) resultLines.push(`… ${rawLines.length - 8} more lines`);
        if (!result.finalOutput) {
          resultLines = [result.error ? `Error: ${result.error}` : `${status} with no output`];
        }
        updateWidget();

        // Inject into LLM context on next turn
        const contextMsg = result.finalOutput
          ? `Minion ${name} (${id}) ${status}:\n${result.finalOutput}`
          : `Minion ${name} (${id}) ${status}.${result.error ? ` Error: ${result.error}` : ""}`;
        logger.debug("spawn:cmd", "inject-context", { msg: contextMsg.slice(0, 120) });
        pi.sendMessage(
          { customType: "minion-result", content: contextMsg, display: false },
          { deliverAs: "nextTurn" },
        );

        ctx.ui.notify(`${name} (${id}) ${status}`, status === "completed" ? "info" : "error");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.debug("spawn:cmd", "bg-error", { id, error: msg });
        tree.updateStatus(id, "failed", 1, msg);
        handles.delete(id);
        runStatus = "failed";
        resultLines = [`Error: ${msg}`];
        updateWidget();
        ctx.ui.notify(`${name} (${id}) failed`, "error");
      }
    })();
  };
}
