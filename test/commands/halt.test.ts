import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentTree } from "../../src/tree.js";
import { makeHaltHandler } from "../../src/commands/halt.js";

function makeCtx(notifyFn = vi.fn()) {
  return { ui: { notify: notifyFn }, cwd: "/tmp" } as any;
}

describe("makeHaltHandler", () => {
  let tree: AgentTree;
  let handles: Map<string, AbortController>;

  beforeEach(() => {
    tree = new AgentTree();
    handles = new Map();
  });

  it("shows usage error when args is empty", async () => {
    const notify = vi.fn();
    const handler = makeHaltHandler(tree, handles);
    await handler("", makeCtx(notify));
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "error");
  });

  it("shows usage error when args is whitespace", async () => {
    const notify = vi.fn();
    const handler = makeHaltHandler(tree, handles);
    await handler("   ", makeCtx(notify));
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "error");
  });

  it("notifies 'No running minions' when 'all' and none running", async () => {
    const notify = vi.fn();
    const handler = makeHaltHandler(tree, handles);
    await handler("all", makeCtx(notify));
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/[Nn]o.*minion/), "info");
  });

  it("halts all running agents when 'all'", async () => {
    tree.add("a", "bob", "t1");
    tree.add("b", "kevin", "t2");
    handles.set("a", new AbortController());
    handles.set("b", new AbortController());
    const notify = vi.fn();
    const handler = makeHaltHandler(tree, handles);

    await handler("all", makeCtx(notify));

    expect(tree.get("a")!.status).toBe("aborted");
    expect(tree.get("b")!.status).toBe("aborted");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("2"), "info");
  });

  it("halts specific agent by id", async () => {
    tree.add("abc123", "bob", "task");
    handles.set("abc123", new AbortController());
    const notify = vi.fn();
    const handler = makeHaltHandler(tree, handles);

    await handler("abc123", makeCtx(notify));

    expect(tree.get("abc123")!.status).toBe("aborted");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("abc123"), "info");
  });

  it("shows error for unknown id", async () => {
    const notify = vi.fn();
    const handler = makeHaltHandler(tree, handles);
    await handler("notreal", makeCtx(notify));
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("notreal"), "error");
  });

  it("shows info (not error) when agent already completed", async () => {
    tree.add("done1", "bob", "task");
    tree.updateStatus("done1", "completed", 0);
    const notify = vi.fn();
    const handler = makeHaltHandler(tree, handles);

    await handler("done1", makeCtx(notify));

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("completed"), "info");
  });
});
