import { describe, expect, it, vi } from "vitest";
import { ResultQueue } from "../../src/queue.js";
import type { SubsessionManager } from "../../src/subsessions/manager.js";
import {
  buildShowMinionText,
  executeSteering,
  listMinions,
  showMinion,
  steerMinion,
  validateSteerTarget,
} from "../../src/tools/minions.js";
import { AgentTree } from "../../src/tree.js";
import { emptyUsage } from "../../src/types.js";

// Mock the agents module
vi.mock("../../src/agents.js", () => ({
  discoverAgents: vi.fn().mockReturnValue({ agents: [], projectAgentsDir: null }),
}));

function createMockSubsessionManager(sessions: Map<string, any> = new Map()) {
  return {
    getSession: vi.fn().mockImplementation((id: string) => sessions.get(id)),
    updateStatus: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    getMetadata: vi.fn(),
    activeSessions: sessions,
  } as unknown as SubsessionManager;
}

function mockSession() {
  return {
    abort: vi.fn(),
    steer: vi.fn().mockResolvedValue(undefined),
    state: { messages: [] },
    getSessionStats: vi.fn().mockReturnValue({
      tokens: {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        total: 150,
      },
      cost: 0.001,
    }),
  };
}

function createCtx() {
  return {
    cwd: "/tmp",
    modelRegistry: {},
    model: undefined,
    ui: { setWorkingMessage: vi.fn() },
  } as any;
}

describe("listMinions", () => {
  it("returns 'No active minions.' when tree and queue are empty", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const execute = listMinions(tree, queue);
    const result = await execute("tc-1", {}, undefined, undefined, createCtx());
    const text = (result.content[0] as any).text;
    expect(text).toBe("No active minions.");
  });

  it("lists a running foreground minion with [fg] tag and task", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    tree.add("a1", "alice", "analyze code");
    const execute = listMinions(tree, queue);
    const result = await execute("tc-1", {}, undefined, undefined, createCtx());
    const text = (result.content[0] as any).text;
    expect(text).toContain("[fg]");
    expect(text).toContain("alice (a1)");
    expect(text).toContain("analyze code");
  });

  it("lists a running background minion with [bg] tag", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    tree.add("b1", "bob", "write tests");
    tree.markDetached("b1");
    const execute = listMinions(tree, queue);
    const result = await execute("tc-1", {}, undefined, undefined, createCtx());
    const text = (result.content[0] as any).text;
    expect(text).toContain("[bg]");
    expect(text).toContain("bob (b1)");
  });

  it("lists a pending queue result in the completed section", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    queue.add({
      id: "c1",
      name: "carol",
      task: "generate docs",
      output: "docs written",
      usage: emptyUsage(),
      status: "pending",
      completedAt: Date.now(),
      duration: 3000,
      exitCode: 0,
    });
    const execute = listMinions(tree, queue);
    const result = await execute("tc-1", {}, undefined, undefined, createCtx());
    const text = (result.content[0] as any).text;
    expect(text).toContain("carol (c1)");
    expect(text).toContain("exit 0");
    expect(text).toContain("Completed");
  });

  it("details field contains running and pending arrays with correct shapes", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    tree.add("d1", "dave", "run tests");
    queue.add({
      id: "e1",
      name: "eve",
      task: "lint code",
      output: "",
      usage: emptyUsage(),
      status: "pending",
      completedAt: 1000,
      duration: 1000,
      exitCode: 1,
    });
    const execute = listMinions(tree, queue);
    const result = await execute("tc-1", {}, undefined, undefined, createCtx());
    const details = result.details as { running: any[]; pending: any[] };
    expect(details.running).toHaveLength(1);
    expect(details.running[0]).toMatchObject({
      id: "d1",
      name: "dave",
      status: "running",
      mode: "foreground",
    });
    expect(details.pending).toHaveLength(1);
    expect(details.pending[0]).toMatchObject({ id: "e1", name: "eve", exitCode: 1 });
  });

  it("includes lastActivity when present", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    tree.add("f1", "frank", "search files");
    tree.updateActivity("f1", "→ $ grep -r TODO");
    const execute = listMinions(tree, queue);
    const result = await execute("tc-1", {}, undefined, undefined, createCtx());
    const text = (result.content[0] as any).text;
    expect(text).toContain("-- → $ grep -r TODO");
  });
});

describe("showMinion", () => {
  it("throws for unknown minion", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const execute = showMinion(tree, queue);

    await expect(
      execute("tc-1", { target: "nope" }, undefined, undefined, createCtx()),
    ).rejects.toThrow(/not found/);
  });

  it("shows running minion with activity", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    tree.add("a", "kevin", "analyze code");
    tree.updateActivity("a", "→ $ grep -r TODO");

    const execute = showMinion(tree, queue);
    const result = await execute("tc-1", { target: "kevin" }, undefined, undefined, createCtx());
    const text = (result.content[0] as any).text;

    expect(text).toContain("kevin");
    expect(text).toContain("running");
    expect(text).toContain("→ $ grep -r TODO");
    expect(text).toContain("Running:");
  });

  it("shows completed minion with queue output", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    tree.add("a", "kevin", "analyze code");
    tree.updateStatus("a", "completed", 0);

    queue.add({
      id: "a",
      name: "kevin",
      task: "analyze code",
      output: "found 3 TODOs",
      usage: emptyUsage(),
      status: "pending",
      completedAt: Date.now(),
      duration: 5000,
      exitCode: 0,
    });

    const execute = showMinion(tree, queue);
    const result = await execute("tc-1", { target: "a" }, undefined, undefined, createCtx());
    const text = (result.content[0] as any).text;

    expect(text).toContain("completed");
    expect(text).toContain("found 3 TODOs");
  });

  it("shows queue output when resolving by name", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    tree.add("abc123", "kevin", "analyze code");
    tree.updateStatus("abc123", "completed", 0);

    queue.add({
      id: "abc123",
      name: "kevin",
      task: "analyze code",
      output: "found 3 TODOs",
      usage: emptyUsage(),
      status: "pending",
      completedAt: Date.now(),
      duration: 5000,
      exitCode: 0,
    });

    const execute = showMinion(tree, queue);
    const result = await execute("tc-1", { target: "kevin" }, undefined, undefined, createCtx());
    const text = (result.content[0] as any).text;

    expect(text).toContain("completed");
    expect(text).toContain("found 3 TODOs");
  });

  it("resolves by name via tree.resolve", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    tree.add("abc123", "kevin", "task");

    const execute = showMinion(tree, queue);
    const result = await execute("tc-1", { target: "kevin" }, undefined, undefined, createCtx());
    const text = (result.content[0] as any).text;
    expect(text).toContain("abc123");
  });
});

describe("steerMinion", () => {
  it("throws for unknown minion", async () => {
    const tree = new AgentTree();
    const sessions = new Map<string, any>();
    const subsessionManager = createMockSubsessionManager(sessions);
    const execute = steerMinion(tree, subsessionManager);

    await expect(
      execute("tc-1", { target: "nope", message: "hello" }, undefined, undefined, createCtx()),
    ).rejects.toThrow(/not found/);
  });

  it("throws for non-running minion", async () => {
    const tree = new AgentTree();
    const sessions = new Map<string, any>();
    const subsessionManager = createMockSubsessionManager(sessions);
    tree.add("a", "kevin", "task");
    tree.updateStatus("a", "completed", 0);

    const execute = steerMinion(tree, subsessionManager);
    await expect(
      execute("tc-1", { target: "a", message: "hello" }, undefined, undefined, createCtx()),
    ).rejects.toThrow(/not running/);
  });

  it("throws when no active session", async () => {
    const tree = new AgentTree();
    const sessions = new Map<string, any>();
    const subsessionManager = createMockSubsessionManager(sessions);
    tree.add("a", "kevin", "task");

    const execute = steerMinion(tree, subsessionManager);
    await expect(
      execute("tc-1", { target: "a", message: "hello" }, undefined, undefined, createCtx()),
    ).rejects.toThrow(/No active session/);
  });

  it("calls session.steer with the message", async () => {
    const tree = new AgentTree();
    const sessions = new Map<string, any>();
    const mockSessionObj = mockSession();
    tree.add("a", "kevin", "task");
    sessions.set("a", mockSessionObj);
    const subsessionManager = createMockSubsessionManager(sessions);

    const execute = steerMinion(tree, subsessionManager);
    const result = await execute(
      "tc-1",
      { target: "kevin", message: "restart the count" },
      undefined,
      undefined,
      createCtx(),
    );
    const text = (result.content[0] as any).text;

    expect(mockSessionObj.steer).toHaveBeenCalledWith(expect.stringContaining("[USER STEER]"));
    expect(mockSessionObj.steer).toHaveBeenCalledWith(expect.stringContaining("restart the count"));
    expect(text).toContain("Steered kevin");
    expect(text).toContain("restart the count");
  });
});

describe("buildShowMinionText", () => {
  it("returns null for unknown target", () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();

    const text = buildShowMinionText(tree, queue, "nope");
    expect(text).toBeNull();
  });

  it("shows activityHistory when present", () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();

    tree.add("a", "kevin", "analyze code");
    tree.setActivityHistory("a", ["turn 1", "→ $ grep -r TODO"]);

    const text = buildShowMinionText(tree, queue, "kevin");
    expect(text).not.toBeNull();
    expect(text).toContain("turn 1");
    expect(text).toContain("→ $ grep -r TODO");
  });

  it("returns string with name, status, and activity for known running minion", () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();

    tree.add("a", "kevin", "analyze code");
    tree.updateActivity("a", "→ $ grep -r TODO");

    const text = buildShowMinionText(tree, queue, "kevin");
    expect(text).not.toBeNull();
    expect(text).toContain("kevin");
    expect(text).toContain("running");
    expect(text).toContain("→ $ grep -r TODO");
  });

  it("finds completed minion and queue output when called by name", () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();

    tree.add("abc123", "kevin", "analyze code");
    tree.updateStatus("abc123", "completed", 0);
    queue.add({
      id: "abc123",
      name: "kevin",
      task: "analyze code",
      output: "found 3 TODOs",
      usage: emptyUsage(),
      status: "pending",
      completedAt: Date.now(),
      duration: 5000,
      exitCode: 0,
    });

    const text = buildShowMinionText(tree, queue, "kevin");
    expect(text).not.toBeNull();
    expect(text).toContain("completed");
    expect(text).toContain("found 3 TODOs");
  });

  it("resolves target by ID", () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();

    tree.add("abc123", "kevin", "task");

    const text = buildShowMinionText(tree, queue, "abc123");
    expect(text).not.toBeNull();
    expect(text).toContain("abc123");
  });
});

// validateSteerTarget helper

describe("validateSteerTarget", () => {
  it("returns error when minion not found", () => {
    const tree = new AgentTree();
    const subsessionManager = createMockSubsessionManager();
    const result = validateSteerTarget(tree, subsessionManager, "nonexistent");
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("not found");
      expect(result.errorType).toBe("error");
    }
  });

  it("returns info error when minion exists but is not running", () => {
    const tree = new AgentTree();
    const subsessionManager = createMockSubsessionManager();
    tree.add("a", "kevin", "task");
    tree.updateStatus("a", "completed", 0);
    const result = validateSteerTarget(tree, subsessionManager, "kevin");
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("not running");
      expect(result.errorType).toBe("info");
    }
  });

  it("returns error when minion is running but has no active session", () => {
    const tree = new AgentTree();
    const subsessionManager = createMockSubsessionManager(); // empty sessions
    tree.add("a", "kevin", "task");
    const result = validateSteerTarget(tree, subsessionManager, "kevin");
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("No active session");
      expect(result.errorType).toBe("error");
    }
  });

  it("returns success with node and steer function when valid", () => {
    const tree = new AgentTree();
    const sessions = new Map<string, any>();
    sessions.set("a", mockSession());
    const subsessionManager = createMockSubsessionManager(sessions);
    tree.add("a", "kevin", "task");
    const result = validateSteerTarget(tree, subsessionManager, "kevin");
    expect(result.success).toBe(true);
    if (result.success === true) {
      expect(result.node.name).toBe("kevin");
      expect(typeof result.steer).toBe("function");
    }
  });

  it("resolves target by ID as well as name", () => {
    const tree = new AgentTree();
    const sessions = new Map<string, any>();
    sessions.set("abc123", mockSession());
    const subsessionManager = createMockSubsessionManager(sessions);
    tree.add("abc123", "kevin", "task");
    const result = validateSteerTarget(tree, subsessionManager, "abc123");
    expect(result.success).toBe(true);
    if (result.success === true) expect(result.node.id).toBe("abc123");
  });
});

// executeSteering helper

describe("executeSteering", () => {
  it("wraps message in USER STEER context and calls steer", async () => {
    const steer = vi.fn().mockResolvedValue(undefined);
    const node = { id: "a", name: "kevin" } as any;
    const result = await executeSteering(node, steer, "restart task");
    expect(steer).toHaveBeenCalledWith(expect.stringContaining("[USER STEER]"));
    expect(steer).toHaveBeenCalledWith(expect.stringContaining("restart task"));
    expect(result).toContain("Steered kevin (a)");
    expect(result).toContain("restart task");
  });
});
