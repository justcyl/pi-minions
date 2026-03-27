import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentTree } from "../../src/tree.js";

// Mock the modules that make external calls
vi.mock("../../src/agents.js", () => ({
  discoverAgents: vi.fn(),
}));
vi.mock("../../src/spawn.js", () => ({
  runMinionSession: vi.fn(),
}));

import { discoverAgents } from "../../src/agents.js";
import { runMinionSession } from "../../src/spawn.js";
import { makeSpawnExecute } from "../../src/tools/spawn.js";
import { emptyUsage } from "../../src/types.js";

const mockAgent = {
  name: "scout",
  description: "Fast recon",
  systemPrompt: "You are a scout.",
  source: "user" as const,
  filePath: "/tmp/scout.md",
};

function makeCtx(cwd = "/tmp") {
  return { cwd, modelRegistry: {}, model: undefined, ui: { setWorkingMessage: vi.fn() } } as any;
}

beforeEach(() => {
  vi.mocked(discoverAgents).mockReturnValue({ agents: [mockAgent], projectAgentsDir: null });
  vi.mocked(runMinionSession).mockResolvedValue({
    exitCode: 0,
    finalOutput: "done",
    usage: { ...emptyUsage(), input: 100, output: 20, turns: 1 },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("makeSpawnExecute", () => {
  it("throws for unknown agent and message lists available agents", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, AbortController>();
    const execute = makeSpawnExecute(tree, handles);

    await expect(
      execute("tc-1", { agent: "unknown-agent", task: "do thing" }, undefined, undefined, makeCtx()),
    ).rejects.toThrow(/scout/); // lists available
  });

  it("adds node to tree with status running, then completed on success", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, AbortController>();
    const execute = makeSpawnExecute(tree, handles);

    await execute("tc-1", { agent: "scout", task: "find auth" }, undefined, undefined, makeCtx());

    const roots = tree.getRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0]!.status).toBe("completed");
    expect(roots[0]!.task).toBe("find auth");
  });

  it("sets node to failed and throws when session returns non-zero exit", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({ exitCode: 1, finalOutput: "", usage: emptyUsage(), error: "exit 1" });
    const tree = new AgentTree();
    const handles = new Map<string, AbortController>();
    const execute = makeSpawnExecute(tree, handles);

    await expect(
      execute("tc-1", { agent: "scout", task: "fail" }, undefined, undefined, makeCtx()),
    ).rejects.toThrow();

    expect(tree.getRoots()[0]!.status).toBe("failed");
  });

  it("passes modelRegistry and parentModel to runMinionSession", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, AbortController>();
    const execute = makeSpawnExecute(tree, handles);
    const ctx = { cwd: "/tmp", modelRegistry: { find: vi.fn() }, model: { provider: "anthropic", id: "claude-haiku-4-5" }, ui: { setWorkingMessage: vi.fn() } } as any;

    await execute("tc-1", { agent: "scout", task: "t" }, undefined, undefined, ctx);

    expect(vi.mocked(runMinionSession)).toHaveBeenCalledWith(
      expect.anything(),
      "t",
      expect.objectContaining({
        modelRegistry: ctx.modelRegistry,
        parentModel: ctx.model,
        cwd: "/tmp",
      }),
    );
  });

  it("returns final output as content text", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, AbortController>();
    const execute = makeSpawnExecute(tree, handles);

    const result = await execute("tc-1", { agent: "scout", task: "t" }, undefined, undefined, makeCtx());
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toBe("done");
  });

  it("spawns ephemeral agent when no agent param", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, AbortController>();
    const execute = makeSpawnExecute(tree, handles);

    const result = await execute(
      "tc-1", { task: "do the thing" }, undefined, undefined, makeCtx(),
    );

    expect(vi.mocked(runMinionSession)).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ephemeral" }),
      "do the thing",
      expect.anything(),
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toBe("done");
  });

  it("ephemeral agent applies model override", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, AbortController>();
    const execute = makeSpawnExecute(tree, handles);

    await execute(
      "tc-1", { task: "t", model: "claude-haiku-4-5" }, undefined, undefined, makeCtx(),
    );

    expect(vi.mocked(runMinionSession)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5", source: "ephemeral" }),
      "t",
      expect.anything(),
    );
  });

  it("still discovers named agent when agent param provided", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, AbortController>();
    const execute = makeSpawnExecute(tree, handles);

    await execute(
      "tc-1", { agent: "scout", task: "find auth" }, undefined, undefined, makeCtx(),
    );

    expect(vi.mocked(runMinionSession)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "scout", source: "user" }),
      "find auth",
      expect.anything(),
    );
  });

  it("cleans up handle after execution", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, AbortController>();
    const execute = makeSpawnExecute(tree, handles);

    await execute("tc-1", { agent: "scout", task: "t" }, undefined, undefined, makeCtx());

    expect(handles.size).toBe(0);
  });

  it("cleans up handle even on failure", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({ exitCode: 1, finalOutput: "", usage: emptyUsage(), error: "fail" });
    const tree = new AgentTree();
    const handles = new Map<string, AbortController>();
    const execute = makeSpawnExecute(tree, handles);

    await expect(
      execute("tc-1", { agent: "scout", task: "t" }, undefined, undefined, makeCtx()),
    ).rejects.toThrow();

    expect(handles.size).toBe(0);
  });
});
