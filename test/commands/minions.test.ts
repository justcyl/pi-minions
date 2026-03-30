import { describe, it, expect, vi } from "vitest";
import { parseMinionArgs, createMinionsHandler } from "../../src/commands/minions.js";
import { AgentTree } from "../../src/tree.js";
import { ResultQueue } from "../../src/queue.js";
import type { DetachHandle } from "../../src/tools/spawn.js";
import type { MinionSession } from "../../src/spawn.js";

describe("parseMinionArgs", () => {
  it("empty args defaults to list", () => {
    expect(parseMinionArgs("")).toEqual({ action: "list" });
  });

  it("'list' returns list action", () => {
    expect(parseMinionArgs("list")).toEqual({ action: "list" });
  });

  it("'show abc' returns show with target", () => {
    expect(parseMinionArgs("show abc")).toEqual({ action: "show", target: "abc" });
  });

  it("'bg abc' returns bg with target", () => {
    expect(parseMinionArgs("bg abc")).toEqual({ action: "bg", target: "abc" });
  });

  it("'bg' without target returns error", () => {
    expect(parseMinionArgs("bg")).toHaveProperty("error");
  });

  it("'steer bob restart the count' parses target and message", () => {
    expect(parseMinionArgs("steer bob restart the count")).toEqual({
      action: "steer", target: "bob", message: "restart the count",
    });
  });

  it("'steer' without enough args returns error", () => {
    expect(parseMinionArgs("steer")).toHaveProperty("error");
    expect(parseMinionArgs("steer bob")).toHaveProperty("error");
  });

  it("missing target returns error for show", () => {
    expect(parseMinionArgs("show")).toHaveProperty("error");
  });

  it("unknown subcommand returns error", () => {
    const result = parseMinionArgs("frobnicate abc");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Unknown subcommand");
  });

  it("handles whitespace", () => {
    expect(parseMinionArgs("   ")).toEqual({ action: "list" });
    expect(parseMinionArgs("  show   abc  ")).toEqual({ action: "show", target: "abc" });
  });
});

function makeCtx() {
  return {
    isIdle: vi.fn().mockReturnValue(true),
    hasPendingMessages: vi.fn().mockReturnValue(false),
    ui: {
      notify: vi.fn(),
    },
  } as any;
}

describe("createMinionsHandler — instantaneous path", () => {
  it("list calls ctx.ui.notify directly (no LLM delegation)", async () => {
    const tree = new AgentTree();
    const detachHandles = new Map<string, DetachHandle>();
    const queue = new ResultQueue();
    const sessions = new Map<string, MinionSession>();
    const ctx = makeCtx();
    
    tree.add("a", "kevin", "task A");
    
    const handler = createMinionsHandler(tree, detachHandles, queue, sessions);
    await handler("list", ctx);
    
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("kevin"),
      "info"
    );
  });

  it("show calls ctx.ui.notify directly with minion details", async () => {
    const tree = new AgentTree();
    const detachHandles = new Map<string, DetachHandle>();
    const queue = new ResultQueue();
    const sessions = new Map<string, MinionSession>();
    const ctx = makeCtx();
    
    tree.add("a", "kevin", "task A");
    
    const handler = createMinionsHandler(tree, detachHandles, queue, sessions);
    await handler("show kevin", ctx);
    
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("kevin"),
      "info"
    );
  });

  it("steer calls session.steer directly (no LLM delegation)", async () => {
    const tree = new AgentTree();
    const detachHandles = new Map<string, DetachHandle>();
    const queue = new ResultQueue();
    const sessions = new Map<string, MinionSession>();
    const ctx = makeCtx();
    
    const steerFn = vi.fn().mockResolvedValue(undefined);
    tree.add("a", "kevin", "task A");
    sessions.set("a", { steer: steerFn } as any);
    
    const handler = createMinionsHandler(tree, detachHandles, queue, sessions);
    await handler("steer kevin restart", ctx);
    
    expect(steerFn).toHaveBeenCalledWith(expect.stringContaining("[USER STEER]"));
    expect(steerFn).toHaveBeenCalledWith(expect.stringContaining("restart"));
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.any(String),
      "info"
    );
  });
});

describe("createMinionsHandler — error cases", () => {
  it("show (unknown target) calls ctx.ui.notify as error", async () => {
    const tree = new AgentTree();
    const detachHandles = new Map<string, DetachHandle>();
    const queue = new ResultQueue();
    const sessions = new Map<string, MinionSession>();
    const ctx = makeCtx();
    
    const handler = createMinionsHandler(tree, detachHandles, queue, sessions);
    await handler("show nope", ctx);
    
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.any(String),
      "error"
    );
  });

  it("steer (not found) calls notify as error", async () => {
    const tree = new AgentTree();
    const detachHandles = new Map<string, DetachHandle>();
    const queue = new ResultQueue();
    const sessions = new Map<string, MinionSession>();
    const ctx = makeCtx();
    
    const handler = createMinionsHandler(tree, detachHandles, queue, sessions);
    await handler("steer nope restart", ctx);
    
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.any(String),
      "error"
    );
  });

  it("steer (not running) calls notify as info containing 'not running'", async () => {
    const tree = new AgentTree();
    const detachHandles = new Map<string, DetachHandle>();
    const queue = new ResultQueue();
    const sessions = new Map<string, MinionSession>();
    const ctx = makeCtx();
    
    tree.add("a", "kevin", "task A");
    tree.updateStatus("a", "completed", 0);
    
    const handler = createMinionsHandler(tree, detachHandles, queue, sessions);
    await handler("steer kevin restart", ctx);
    
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("not running"),
      "info"
    );
  });

  it("steer (no session) calls notify as error", async () => {
    const tree = new AgentTree();
    const detachHandles = new Map<string, DetachHandle>();
    const queue = new ResultQueue();
    const sessions = new Map<string, MinionSession>();
    const ctx = makeCtx();
    
    tree.add("a", "kevin", "task A");
    // No session in sessions map
    
    const handler = createMinionsHandler(tree, detachHandles, queue, sessions);
    await handler("steer kevin restart", ctx);
    
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.any(String),
      "error"
    );
  });
});
