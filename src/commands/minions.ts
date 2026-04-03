import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { AgentTree } from "../tree.js";
import type { ResultQueue } from "../queue.js";
import { validateSteerTarget, executeSteering } from "../tools/minions.js";
import { detachMinion } from "../tools/spawn.js";
import { logger } from "../logger.js";
import type { SubsessionManager } from "../subsessions/manager.js";
import type { EventBus } from "../subsessions/event-bus.js";
import { showMinionObservability } from "../subsessions/observability.js";

type ParsedArgs =
  | { action: "list" }
  | { action: "show"; target: string }
  | { action: "bg"; target: string }
  | { action: "steer"; target: string; message: string }
  | { error: string };

export function parseMinionArgs(args: string): ParsedArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) return { action: "list" };

  const action = tokens[0]!;

  if (action === "list") return { action: "list" };

  if (action === "show" || action === "s") {
    const target = tokens.slice(1).join(" ").trim();
    if (!target) {
      return { error: `Usage: /minions show <id | name>` };
    }
    return { action: "show", target };
  }

  if (action === "bg") {
    const target = tokens.slice(1).join(" ").trim();
    if (!target) {
      return { error: `Usage: /minions bg <id | name>` };
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

// Get alphabetically sorted list of running minions
function getSortedMinionIds(tree: AgentTree): string[] {
  const running = tree.getRunning();
  return running
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(m => m.id);
}

// Show minion observability with cycling support
async function showMinionWithCycling(
  ctx: ExtensionCommandContext,
  tree: AgentTree,
  eventBus: EventBus,
  startMinionId: string,
): Promise<void> {
  let currentId: string | null = startMinionId;

  const cycleToMinion = (currentId: string, direction: "next" | "prev"): string | null => {
    const sortedIds = getSortedMinionIds(tree);
    if (sortedIds.length === 0) return null;

    const currentIndex = sortedIds.indexOf(currentId);
    if (currentIndex === -1) {
      return sortedIds[0] ?? null;
    }

    if (direction === "next") {
      return sortedIds[(currentIndex + 1) % sortedIds.length] ?? null;
    } else {
      return sortedIds[(currentIndex - 1 + sortedIds.length) % sortedIds.length] ?? null;
    }
  };

  while (currentId) {
    logger.debug("minions:cmd", "opening-observability", { currentId });

    let nextId: string | null = null;
    const result = await showMinionObservability(
      ctx,
      tree,
      eventBus,
      currentId,
      (direction) => {
        nextId = cycleToMinion(currentId!, direction);
      }
    );

    if (result.action === "close") {
      logger.debug("minions:cmd", "observability-closed");
      return;
    }

    if (result.action === "back") {
      return;
    }

    // result.action === "cycle" - user pressed tab/shift+tab
    if (nextId) {
      currentId = nextId;
    } else {
      return;
    }
  }
}

export function createMinionsHandler(
  tree: AgentTree,
  _queue: ResultQueue,
  subsessionManager: SubsessionManager,
  eventBus: EventBus,
) {
  return async function handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const parsed = parseMinionArgs(args);

    if ("error" in parsed) {
      ctx.ui.notify(parsed.error, "error");
      return;
    }

    // list → open first minion view directly (alphabetically sorted)
    if (parsed.action === "list") {
      const sortedIds = getSortedMinionIds(tree);

      if (sortedIds.length === 0) {
        ctx.ui.notify("No active minions. Spawn one with /spawn or the spawn tool.", "info");
        return;
      }

      await showMinionWithCycling(ctx, tree, eventBus, sortedIds[0]!);
      return;
    }

    // show → open specific minion view with cycling
    if (parsed.action === "show") {
      const node = tree.resolve(parsed.target);
      if (!node) {
        ctx.ui.notify(`Minion not found: ${parsed.target}`, "error");
        return;
      }

      await showMinionWithCycling(ctx, tree, eventBus, node.id);
      return;
    }

    if (parsed.action === "steer") {
      const validation = validateSteerTarget(tree, subsessionManager, parsed.target);
      if (validation.success === false) {
        ctx.ui.notify(validation.error, validation.errorType);
        return;
      }

      const successMessage = await executeSteering(validation.node, validation.steer, parsed.message);
      ctx.ui.notify(successMessage, "info");
      return;
    }

    // bg → signals the foreground spawn to detach
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

      // Check if session exists (foreground) or just metadata (background)
      const session = subsessionManager.getSession(node.id);
      if (!session) {
        ctx.ui.notify(`Minion ${node.name} (${node.id}) is already running in background.`, "info");
        return;
      }

      logger.debug("minions:cmd", "bg-detaching", { id: node.id, name: node.name });
      detachMinion(node.id);
      // Mark as detached for [fg]/[bg] badge (deviation 10)
      tree.markDetached(node.id);
      logger.debug("minions:cmd", "bg-detached", { id: node.id, name: node.name });
      ctx.ui.notify(`Sent ${node.name} (${node.id}) to background.`, "info");
      return;
    }
  };
}
