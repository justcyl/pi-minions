import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentTree } from "../../src/tree.js";
import type { ChildProcess } from "node:child_process";

// Mock the modules that make external calls
vi.mock("../../src/agents.js", () => ({
  discoverAgents: vi.fn(),
}));
vi.mock("../../src/spawn.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/spawn.js")>();
  return {
    ...actual,
    spawnAgent: vi.fn(),
  };
});

import { discoverAgents } from "../../src/agents.js";
import { spawnAgent } from "../../src/spawn.js";
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
  return { cwd } as any;
}

beforeEach(() => {
  vi.mocked(discoverAgents).mockReturnValue({ agents: [mockAgent], projectAgentsDir: null });
  vi.mocked(spawnAgent).mockResolvedValue({
    exitCode: 0,
    finalOutput: "done",
    usage: { ...emptyUsage(), input: 100, output: 20, turns: 1 },
  });
  delete process.env["PI_MINIONS_DEPTH"];
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env["PI_MINIONS_DEPTH"];
});

describe("makeSpawnExecute", () => {
  it("throws when at maxDepth", async () => {
    process.env["PI_MINIONS_DEPTH"] = "3";
    const tree = new AgentTree();
    const handles = new Map<string, ChildProcess | null>();
    const execute = makeSpawnExecute(tree, handles);

    await expect(
      execute("tc-1", { agent: "scout", task: "find auth" }, undefined, undefined, makeCtx()),
    ).rejects.toThrow(/depth/i);
  });

  it("throws for unknown agent and message lists available agents", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, ChildProcess | null>();
    const execute = makeSpawnExecute(tree, handles);

    await expect(
      execute("tc-1", { agent: "unknown-agent", task: "do thing" }, undefined, undefined, makeCtx()),
    ).rejects.toThrow(/scout/); // lists available
  });

  it("adds node to tree with status running, then completed on success", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, ChildProcess | null>();
    const execute = makeSpawnExecute(tree, handles);

    await execute("tc-1", { agent: "scout", task: "find auth" }, undefined, undefined, makeCtx());

    const roots = tree.getRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0]!.status).toBe("completed");
    expect(roots[0]!.task).toBe("find auth");
  });

  it("sets node to failed and throws when spawnAgent returns non-zero exit", async () => {
    vi.mocked(spawnAgent).mockResolvedValue({ exitCode: 1, finalOutput: "", usage: emptyUsage(), error: "exit 1" });
    const tree = new AgentTree();
    const handles = new Map<string, ChildProcess | null>();
    const execute = makeSpawnExecute(tree, handles);

    await expect(
      execute("tc-1", { agent: "scout", task: "fail" }, undefined, undefined, makeCtx()),
    ).rejects.toThrow();

    expect(tree.getRoots()[0]!.status).toBe("failed");
  });

  it("passes model override to spawnAgent", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, ChildProcess | null>();
    const execute = makeSpawnExecute(tree, handles);

    await execute("tc-1", { agent: "scout", task: "t", model: "claude-haiku-4-5" }, undefined, undefined, makeCtx());

    expect(vi.mocked(spawnAgent)).toHaveBeenCalledWith(
      expect.anything(),
      "t",
      expect.objectContaining({ overrideModel: "claude-haiku-4-5" }),
    );
  });

  it("passes parentModel from ctx to spawnAgent", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, ChildProcess | null>();
    const execute = makeSpawnExecute(tree, handles);
    const ctx = { cwd: "/tmp", model: { provider: "anthropic", id: "claude-haiku-4-5" } } as any;

    await execute("tc-1", { agent: "scout", task: "t" }, undefined, undefined, ctx);

    expect(vi.mocked(spawnAgent)).toHaveBeenCalledWith(
      expect.anything(),
      "t",
      expect.objectContaining({ parentModel: "anthropic/claude-haiku-4-5" }),
    );
  });

  it("uses undefined overrideModel when no model param", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, ChildProcess | null>();
    const execute = makeSpawnExecute(tree, handles);

    await execute("tc-1", { agent: "scout", task: "t" }, undefined, undefined, makeCtx());

    expect(vi.mocked(spawnAgent)).toHaveBeenCalledWith(
      expect.anything(),
      "t",
      expect.objectContaining({ overrideModel: undefined }),
    );
  });

  it("returns final output as content text", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, ChildProcess | null>();
    const execute = makeSpawnExecute(tree, handles);

    const result = await execute("tc-1", { agent: "scout", task: "t" }, undefined, undefined, makeCtx());
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toBe("done");
  });
});
