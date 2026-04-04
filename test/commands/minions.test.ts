import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMinionsHandler, parseMinionArgs } from "../../src/commands/minions.js";
import { ResultQueue } from "../../src/queue.js";
import { EventBus } from "../../src/subsessions/event-bus.js";
import type { SubsessionManager } from "../../src/subsessions/manager.js";
import { AgentTree } from "../../src/tree.js";

// Mock the observability module
vi.mock("../../src/subsessions/observability.js", () => ({
  showMinionObservability: vi.fn(),
  getMinionHistory: vi.fn().mockReturnValue([]),
}));

import { showMinionObservability } from "../../src/subsessions/observability.js";

function createMockEventBus(): EventBus {
  return new EventBus();
}

function createMockSubsessionManager(sessions: Map<string, any> = new Map()): SubsessionManager {
  return {
    getSession: vi.fn().mockImplementation((id: string) => sessions.get(id)),
    getMetadata: vi.fn().mockImplementation((id: string) => ({
      sessionId: id,
      parentSession: "/mock/parent.jsonl",
      name: `minion-${id}`,
      task: "test task",
      status: "running",
      createdAt: Date.now(),
    })),
    getSessionPath: vi.fn().mockImplementation((id: string) => `/mock/path/${id}.jsonl`),
    getMinionIdFromPath: vi.fn().mockImplementation((path: string) => {
      if (path.includes("minion-")) {
        return path.match(/minion-[^/]+/)?.[0];
      }
      return undefined;
    }),
    updateStatus: vi.fn(),
    list: vi.fn().mockReturnValue([]),
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

function createMockContext(overrides?: Partial<ExtensionCommandContext>): ExtensionCommandContext {
  return {
    ui: {
      notify: vi.fn(),
    },
    sessionManager: {
      getSessionFile: vi.fn().mockReturnValue("/mock/parent.jsonl"),
    } as unknown as ExtensionCommandContext["sessionManager"],
    switchSession: vi.fn().mockResolvedValue({ cancelled: false }),
    isIdle: vi.fn().mockReturnValue(true),
    hasPendingMessages: vi.fn().mockReturnValue(false),
    ...overrides,
  } as unknown as ExtensionCommandContext;
}

describe("parseMinionArgs", () => {
  it("empty args defaults to list", () => {
    expect(parseMinionArgs("")).toEqual({ action: "list" });
  });

  it("'list' returns list action", () => {
    expect(parseMinionArgs("list")).toEqual({ action: "list" });
  });

  it("'show abc' returns show with target", () => {
    expect(parseMinionArgs("show abc")).toEqual({
      action: "show",
      target: "abc",
    });
  });

  it("'s abc' returns show with target (shorthand)", () => {
    expect(parseMinionArgs("s abc")).toEqual({ action: "show", target: "abc" });
  });

  it("'show' without target returns error", () => {
    expect(parseMinionArgs("show")).toHaveProperty("error");
  });

  it("'bg abc' returns bg with target", () => {
    expect(parseMinionArgs("bg abc")).toEqual({ action: "bg", target: "abc" });
  });

  it("'bg' without target returns error", () => {
    expect(parseMinionArgs("bg")).toHaveProperty("error");
  });

  it("'steer bob restart the count' parses target and message", () => {
    expect(parseMinionArgs("steer bob restart the count")).toEqual({
      action: "steer",
      target: "bob",
      message: "restart the count",
    });
  });

  it("'steer' without enough args returns error", () => {
    expect(parseMinionArgs("steer")).toHaveProperty("error");
    expect(parseMinionArgs("steer bob")).toHaveProperty("error");
  });

  it("unknown subcommand returns error", () => {
    const result = parseMinionArgs("frobnicate abc");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Unknown subcommand");
  });

  it("handles whitespace", () => {
    expect(parseMinionArgs("   ")).toEqual({ action: "list" });
    expect(parseMinionArgs("  bg   abc  ")).toEqual({
      action: "bg",
      target: "abc",
    });
  });
});

describe("list action with no minions", () => {
  it("shows info message when no minions are running", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const subsessionManager = createMockSubsessionManager();
    const ctx = createMockContext();
    const eventBus = createMockEventBus();

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus);
    await handler("list", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "No active minions. Spawn one with /spawn or the spawn tool.",
      "info",
    );
    expect(showMinionObservability).not.toHaveBeenCalled();
  });
});

describe("list action opens observability", () => {
  let tree: AgentTree;
  let queue: ResultQueue;
  let subsessionManager: SubsessionManager;
  let ctx: ExtensionCommandContext;
  let eventBus: EventBus;

  beforeEach(() => {
    tree = new AgentTree();
    queue = new ResultQueue();
    subsessionManager = createMockSubsessionManager();
    ctx = createMockContext();
    eventBus = createMockEventBus();
    vi.clearAllMocks();
  });

  it("opens observability for first minion alphabetically", async () => {
    tree.add("id-zebra", "zebra", "test");
    tree.add("id-alpha", "alpha", "test");

    vi.mocked(showMinionObservability).mockResolvedValue({ action: "close" });

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus);
    await handler("list", ctx);

    expect(showMinionObservability).toHaveBeenCalledWith(
      ctx,
      tree,
      eventBus,
      "id-alpha",
      expect.any(Function),
    );
  });

  it("exits when user closes observability", async () => {
    tree.add("id-test", "test", "test");

    vi.mocked(showMinionObservability).mockResolvedValue({ action: "close" });

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus);
    await handler("list", ctx);

    expect(showMinionObservability).toHaveBeenCalledTimes(1);
  });

  it("exits when user presses back", async () => {
    tree.add("id-test", "test", "test");

    vi.mocked(showMinionObservability).mockResolvedValue({ action: "back" });

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus);
    await handler("list", ctx);

    expect(showMinionObservability).toHaveBeenCalledTimes(1);
  });

  it("does not switch parent session", async () => {
    tree.add("id-test", "test", "test");

    vi.mocked(showMinionObservability).mockResolvedValue({ action: "close" });

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus);
    await handler("list", ctx);

    expect(ctx.switchSession).not.toHaveBeenCalled();
  });
});

describe("show action opens specific minion", () => {
  let tree: AgentTree;
  let queue: ResultQueue;
  let subsessionManager: SubsessionManager;
  let ctx: ExtensionCommandContext;
  let eventBus: EventBus;

  beforeEach(() => {
    tree = new AgentTree();
    queue = new ResultQueue();
    subsessionManager = createMockSubsessionManager();
    ctx = createMockContext();
    eventBus = createMockEventBus();
    vi.clearAllMocks();
  });

  it("opens observability for specified minion by name", async () => {
    tree.add("id-alpha", "alpha", "test");
    tree.add("id-beta", "beta", "test");

    vi.mocked(showMinionObservability).mockResolvedValue({ action: "close" });

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus);
    await handler("show beta", ctx);

    expect(showMinionObservability).toHaveBeenCalledWith(
      ctx,
      tree,
      eventBus,
      "id-beta",
      expect.any(Function),
    );
  });

  it("opens observability for specified minion by id", async () => {
    tree.add("id-alpha", "alpha", "test");

    vi.mocked(showMinionObservability).mockResolvedValue({ action: "close" });

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus);
    await handler("show id-alpha", ctx);

    expect(showMinionObservability).toHaveBeenCalledWith(
      ctx,
      tree,
      eventBus,
      "id-alpha",
      expect.any(Function),
    );
  });

  it("shows error when minion not found", async () => {
    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus);
    await handler("show nonexistent", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Minion not found: nonexistent", "error");
    expect(showMinionObservability).not.toHaveBeenCalled();
  });

  it("supports 's' shorthand", async () => {
    tree.add("id-test", "test", "test");

    vi.mocked(showMinionObservability).mockResolvedValue({ action: "close" });

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus);
    await handler("s test", ctx);

    expect(showMinionObservability).toHaveBeenCalledWith(
      ctx,
      tree,
      eventBus,
      "id-test",
      expect.any(Function),
    );
  });
});

describe("steer action injects message into running minion", () => {
  it("calls session.steer with wrapped message", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const sessions = new Map<string, any>();
    const subsessionManager = createMockSubsessionManager(sessions);
    const ctx = createMockContext();

    const mockSessionObj = mockSession();
    tree.add("a", "kevin", "task A");
    sessions.set("a", mockSessionObj);

    const eventBus = createMockEventBus();
    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus);
    await handler("steer kevin restart", ctx);

    expect(mockSessionObj.steer).toHaveBeenCalledWith(expect.stringContaining("[USER STEER]"));
    expect(mockSessionObj.steer).toHaveBeenCalledWith(expect.stringContaining("restart"));
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.any(String), "info");
  });

  it("shows error when minion not found", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const subsessionManager = createMockSubsessionManager();
    const ctx = createMockContext();

    const eventBus = createMockEventBus();
    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus);
    await handler("steer nope restart", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("shows info when minion not running", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const subsessionManager = createMockSubsessionManager();
    const ctx = createMockContext();

    tree.add("a", "kevin", "task A");
    tree.updateStatus("a", "completed", 0);

    const eventBus = createMockEventBus();
    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus);
    await handler("steer kevin restart", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("not running"), "info");
  });

  it("shows error when no active session", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const subsessionManager = createMockSubsessionManager();
    const ctx = createMockContext();

    tree.add("a", "kevin", "task A");

    const eventBus = createMockEventBus();
    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus);
    await handler("steer kevin restart", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.any(String), "error");
  });
});
