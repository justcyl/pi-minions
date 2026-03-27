import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import { AgentTree } from "../../src/tree.js";
import { makeHaltExecute, abortAgents } from "../../src/tools/halt.js";

function makeCtx() {
  return { cwd: "/tmp" } as any;
}

function mockProc(): ChildProcess {
  return { kill: vi.fn(), killed: false } as unknown as ChildProcess;
}

describe("abortAgents", () => {
  it("sends SIGTERM to process and marks tree as aborted", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, ChildProcess | null>();
    tree.add("id1", "bob", "task");
    const proc = mockProc();
    handles.set("id1", proc);

    await abortAgents(["id1"], tree, handles);

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(tree.get("id1")!.status).toBe("aborted");
    expect(handles.has("id1")).toBe(false);
  });

  it("still aborts tree node when no process handle exists", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, ChildProcess | null>();
    tree.add("id1", "bob", "task");
    handles.set("id1", null); // null handle

    await abortAgents(["id1"], tree, handles);

    expect(tree.get("id1")!.status).toBe("aborted");
  });

  it("returns count of aborted agents", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, ChildProcess | null>();
    tree.add("a", "bob", "t1");
    tree.add("b", "kevin", "t2");
    handles.set("a", null);
    handles.set("b", null);

    const count = await abortAgents(["a", "b"], tree, handles);
    expect(count).toBe(2);
  });
});

describe("makeHaltExecute", () => {
  let tree: AgentTree;
  let handles: Map<string, ChildProcess | null>;

  beforeEach(() => {
    tree = new AgentTree();
    handles = new Map();
  });

  it("halts a specific running agent by id", async () => {
    tree.add("id1", "bob", "task");
    handles.set("id1", mockProc());
    const execute = makeHaltExecute(tree, handles);

    const result = await execute("tc", { id: "id1" }, undefined, undefined, makeCtx());

    expect(tree.get("id1")!.status).toBe("aborted");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("id1");
  });

  it("halts all running agents when id is 'all'", async () => {
    tree.add("a", "bob", "t1");
    tree.add("b", "kevin", "t2");
    handles.set("a", mockProc());
    handles.set("b", mockProc());
    const execute = makeHaltExecute(tree, handles);

    const result = await execute("tc", { id: "all" }, undefined, undefined, makeCtx());

    expect(tree.get("a")!.status).toBe("aborted");
    expect(tree.get("b")!.status).toBe("aborted");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("2");
  });

  it("throws for unknown agent id", async () => {
    const execute = makeHaltExecute(tree, handles);

    await expect(
      execute("tc", { id: "nope" }, undefined, undefined, makeCtx()),
    ).rejects.toThrow(/nope/);
  });

  it("returns info (not error) for already-completed agent", async () => {
    tree.add("id1", "bob", "task");
    tree.updateStatus("id1", "completed", 0);
    const execute = makeHaltExecute(tree, handles);

    const result = await execute("tc", { id: "id1" }, undefined, undefined, makeCtx());

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("completed");
  });

  it("returns info when 'all' but nothing is running", async () => {
    const execute = makeHaltExecute(tree, handles);

    const result = await execute("tc", { id: "all" }, undefined, undefined, makeCtx());

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("No");
  });
});
