import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { AgentTree } from "../tree.js";
import type { ResultQueue } from "../queue.js";
import type { MinionSession } from "../spawn.js";
import type { DetachHandle } from "../tools/spawn.js";
import { buildListMinionsText, buildShowMinionText, validateSteerTarget, executeSteering } from "../tools/minions.js";
import { logger } from "../logger.js";

type ParsedArgs =
  | { action: "list" }
  | { action: "show" | "bg"; target: string }
  | { action: "steer"; target: string; message: string }
  | { error: string };

export function parseMinionArgs(args: string): ParsedArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) return { action: "list" };

  const action = tokens[0]!;

  if (action === "list") return { action: "list" };

  if (action === "show" || action === "bg") {
    const target = tokens.slice(1).join(" ").trim();
    if (!target) {
      return { error: `Usage: /minions ${action} <id | name>` };
    }
    return { action, target };
  }

  if (action === "steer") {
    if (tokens.length < 3) {
      return { error: "Usage: /minions steer <id | name> <message>" };
    }
    const target = tokens[1]!;
    const message = tokens.slice(2).join(" ");
    return { action: "steer", target, message };
  }

  return { error: `Unknown subcommand: ${action}. Use list, show, bg, or steer.` };
}

export function createMinionsHandler(
  tree: AgentTree,
  detachHandles: Map<string, DetachHandle>,
  queue: ResultQueue,
  sessions: Map<string, MinionSession>,
) {
  return async function handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const parsed = parseMinionArgs(args);

    if ("error" in parsed) {
      ctx.ui.notify(parsed.error, "error");
      return;
    }

    // list, show, steer → always act immediately (instantaneous response)
    if (parsed.action === "list") {
      const text = buildListMinionsText(tree, queue, detachHandles);
      ctx.ui.notify(text, "info");
      return;
    }

    if (parsed.action === "show") {
      const text = buildShowMinionText(tree, queue, parsed.target);
      if (text === null) {
        ctx.ui.notify(`Minion not found: ${parsed.target}`, "error");
      } else {
        ctx.ui.notify(text, "info");
      }
      return;
    }

    if (parsed.action === "steer") {
      const validation = validateSteerTarget(tree, sessions, parsed.target);
      if (!validation.success) {
        ctx.ui.notify(validation.error, validation.errorType);
        return;
      }

      const successMessage = await executeSteering(validation.node, validation.session, parsed.message);
      ctx.ui.notify(successMessage, "info");
      return;
    }

    // bg → must act directly because the parent is blocked by the foreground
    // spawn tool. The spawn tool's detach path returns a visible result.
    if (parsed.action === "bg") {
      logger.debug("minions:cmd", "bg", { target: parsed.target });
      const node = tree.resolve(parsed.target);
      if (!node) {
        logger.debug("minions:cmd", "bg-not-found", { target: parsed.target });
        ctx.ui.notify(`Minion not found: ${parsed.target}`, "error");
        return;
      }
      if (node.status !== "running") {
        ctx.ui.notify(`Minion ${node.name} (${node.id}) is not running (status: ${node.status}).`, "info");
        return;
      }
      const handle = detachHandles.get(node.id);
      if (!handle) {
        ctx.ui.notify(`Minion ${node.name} (${node.id}) is already running in background.`, "info");
        return;
      }
      logger.debug("minions:cmd", "bg-detaching", { id: node.id, name: node.name });
      handle.resolve();
      logger.debug("minions:cmd", "bg-detached", { id: node.id, name: node.name });
      ctx.ui.notify(`Sent ${node.name} (${node.id}) to background.`, "info");
      return;
    }
  };
}
