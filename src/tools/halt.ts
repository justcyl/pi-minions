import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@mariozechner/pi-coding-agent";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ChildProcess } from "node:child_process";
import { AgentTree } from "../tree.js";
import { logger } from "../logger.js";

export const HaltToolParams = Type.Object({
  id: Type.String({ description: "Agent ID to halt, or 'all' to halt all running minions" }),
});

export type HaltToolParams = Static<typeof HaltToolParams>;

export async function abortAgents(
  ids: string[],
  tree: AgentTree,
  handles: Map<string, ChildProcess | null>,
): Promise<number> {
  let count = 0;
  for (const id of ids) {
    const proc = handles.get(id);
    logger.debug("halt", "aborting", { id, hasProc: proc !== null && proc !== undefined });
    if (proc) {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 5000);
    }
    tree.updateStatus(id, "aborted");
    handles.delete(id);
    count++;
  }
  return count;
}

export function makeHaltExecute(
  tree: AgentTree,
  handles: Map<string, ChildProcess | null>,
) {
  return async function execute(
    _toolCallId: string,
    params: HaltToolParams,
    _signal: AbortSignal | undefined,
    _onUpdate: undefined,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<Record<string, never>>> {
    if (params.id === "all") {
      const running = tree.getRunning();
      if (running.length === 0) {
        return { content: [{ type: "text", text: "No running minions to halt." }], details: {} };
      }
      const count = await abortAgents(running.map((n) => n.id), tree, handles);
      return { content: [{ type: "text", text: `Halted ${count} minion${count !== 1 ? "s" : ""}.` }], details: {} };
    }

    const node = tree.get(params.id);
    if (!node) {
      throw new Error(`Minion not found: ${params.id}`);
    }

    if (node.status !== "running") {
      return {
        content: [{ type: "text", text: `Minion ${node.name} (${params.id}) is not running (status: ${node.status}).` }],
        details: {},
      };
    }

    await abortAgents([params.id], tree, handles);
    return { content: [{ type: "text", text: `Halted minion ${node.name} (${params.id}).` }], details: {} };
  };
}
