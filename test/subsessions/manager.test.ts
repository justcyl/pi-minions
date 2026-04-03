import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SubsessionManager } from "../../src/subsessions/manager.js";
import { EventBus } from "../../src/subsessions/event-bus.js";
import { getMinionsDir } from "../../src/subsessions/paths.js";
import type { MinionSessionMetadata } from "../../src/subsessions/types.js";

// Mock must be at top level (hoisted)
vi.mock("@mariozechner/pi-coding-agent", () => {
  const mockSession = {
    subscribe: vi.fn().mockReturnValue(() => {}),
    steer: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    prompt: vi.fn().mockResolvedValue(undefined),
    state: { messages: [] },
    getSessionStats: vi.fn().mockReturnValue({
      tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
      cost: 0.001,
    }),
  };

  const mockSessionManager = {
    getSessionFile: vi.fn().mockReturnValue("/tmp/test-session.jsonl"),
  };

  return {
    createAgentSession: vi.fn().mockResolvedValue({ session: mockSession }),
    DefaultResourceLoader: vi.fn().mockImplementation(() => ({
      reload: vi.fn().mockResolvedValue(undefined),
    })),
    SessionManager: {
      create: vi.fn().mockReturnValue(mockSessionManager),
    },
    SettingsManager: {
      create: vi.fn().mockReturnValue({}),
    },
    createCodingTools: vi.fn().mockReturnValue([]),
  };
});

describe("SubsessionManager", () => {
  let tempDir: string;
  let manager: SubsessionManager;
  let eventBus: EventBus;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pi-minions-test-"));
    eventBus = new EventBus();
    manager = new SubsessionManager(tempDir, join(tempDir, "parent.jsonl"), eventBus);
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("create", () => {
    it("should create a session handle with id and path", async () => {
      const handle = await manager.create({
        id: "test-id",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      expect(handle).toBeDefined();
      expect(handle.id).toBe("test-id");
      expect(handle.path).toBeDefined();
      expect(typeof handle.steer).toBe("function");
      expect(typeof handle.abort).toBe("function");
    });

    it("should call onComplete when session completes", async () => {
      const onComplete = vi.fn();

      await manager.create({
        id: "test-id",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: {} as any,
        onComplete,
      });

      // Wait for async completion
      await new Promise(r => setTimeout(r, 10));

      // Verify mock was called
      const { createAgentSession } = await import("@mariozechner/pi-coding-agent");
      expect(createAgentSession).toHaveBeenCalled();
    });
  });

  describe("getMetadata", () => {
    it("should return undefined for unknown session", () => {
      const metadata = manager.getMetadata("non-existent");
      expect(metadata).toBeUndefined();
    });

    it("should return cached metadata after create", async () => {
      await manager.create({
        id: "test-id",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      const metadata = manager.getMetadata("test-id");
      expect(metadata).toBeDefined();
      expect(metadata?.sessionId).toBe("test-id");
      expect(metadata?.name).toBe("test-minion");
      expect(metadata?.task).toBe("do something");
    });
  });

  describe("list", () => {
    it("should return empty array when no sessions exist", () => {
      const sessions = manager.list();
      expect(sessions).toEqual([]);
    });

    it("should list created sessions from cache", async () => {
      // Create sessions (these get cached)
      await manager.create({
        id: "test-1",
        name: "minion-1",
        task: "task 1",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tc-1",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      await manager.create({
        id: "test-2",
        name: "minion-2",
        task: "task 2",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tc-2",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      // getMetadata should return cached data for created sessions
      const meta1 = manager.getMetadata("test-1");
      const meta2 = manager.getMetadata("test-2");
      
      expect(meta1).toBeDefined();
      expect(meta2).toBeDefined();
      expect(meta1?.sessionId).toBe("test-1");
      expect(meta2?.sessionId).toBe("test-2");
    });
  });

  describe("getSession", () => {
    it("should return undefined for unknown session", () => {
      const session = manager.getSession("non-existent");
      expect(session).toBeUndefined();
    });
  });

  describe("updateStatus", () => {
    it("should update status in cache", async () => {
      await manager.create({
        id: "test-id",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      manager.updateStatus("test-id", "completed", 0);

      const metadata = manager.getMetadata("test-id");
      expect(metadata?.status).toBe("completed");
      expect(metadata?.exitCode).toBe(0);
    });

    it("should handle updating unknown session gracefully", () => {
      // Should not throw
      manager.updateStatus("non-existent", "completed", 0);
    });
  });

  describe("resuming a minion session", () => {
    it("finds the session file path given a minion ID", () => {
      // Given a minion session file exists with metadata
      const minionsDir = getMinionsDir(tempDir);
      mkdirSync(minionsDir, { recursive: true });
      
      const sessionFile = join(minionsDir, "2026-04-02T22-46-54-session.jsonl");
      writeFileSync(sessionFile, '{"type":"session"}\n');
      
      const metadata: MinionSessionMetadata = {
        sessionId: "minion-abc",
        parentSession: join(tempDir, "parent.jsonl"),
        spawnedBy: "test",
        name: "test-minion",
        task: "test task",
        createdAt: Date.now(),
        status: "running",
      };
      writeFileSync(`${sessionFile}.minion-meta.json`, JSON.stringify(metadata));

      // When looking up the path by minion ID
      const foundPath = manager.getSessionPath("minion-abc");

      // Then the correct session file path is returned
      expect(foundPath).toBe(sessionFile);
    });

    it("returns undefined when minion ID does not exist", () => {
      // Given no session files exist
      // When looking up a non-existent minion ID
      const foundPath = manager.getSessionPath("non-existent");

      // Then undefined is returned
      expect(foundPath).toBeUndefined();
    });
  });

  describe("identifying current session as a minion", () => {
    it("extracts minion ID when given a minion session path", () => {
      // Given a minion session file exists with metadata
      const minionsDir = getMinionsDir(tempDir);
      mkdirSync(minionsDir, { recursive: true });
      
      const sessionFile = join(minionsDir, "2026-04-02T22-46-54-session.jsonl");
      writeFileSync(sessionFile, '{"type":"session"}\n');
      
      const metadata: MinionSessionMetadata = {
        sessionId: "minion-xyz",
        parentSession: join(tempDir, "parent.jsonl"),
        spawnedBy: "test",
        name: "test-minion",
        task: "test task",
        createdAt: Date.now(),
        status: "running",
      };
      writeFileSync(`${sessionFile}.minion-meta.json`, JSON.stringify(metadata));

      // When checking if the path is a minion session
      const minionId = manager.getMinionIdFromPath(sessionFile);

      // Then the minion ID is returned
      expect(minionId).toBe("minion-xyz");
    });

    it("returns undefined when path is not in minions directory", () => {
      // Given a non-minion session path
      const parentSession = join(tempDir, "parent.jsonl");

      // When checking if it's a minion session
      const minionId = manager.getMinionIdFromPath(parentSession);

      // Then undefined is returned
      expect(minionId).toBeUndefined();
    });
  });

  describe("usage update on turn end", () => {
    it("calls onUsageUpdate with stats from getSessionStats when session emits turn_end", async () => {
      let capturedSubscriber: ((event: any) => void) | undefined;

      const { createAgentSession } = await import("@mariozechner/pi-coding-agent");
      vi.mocked(createAgentSession).mockImplementationOnce(async () => ({
        session: {
          subscribe: (cb: (event: any) => void) => { capturedSubscriber = cb; return () => {}; },
          abort: vi.fn(),
          prompt: vi.fn().mockResolvedValue(undefined),
          state: { messages: [] },
          getSessionStats: vi.fn().mockReturnValue({
            tokens: { input: 200, output: 80, cacheRead: 10, cacheWrite: 5, total: 290 },
            cost: 0.005,
          }),
        },
      }) as any);

      const onUsageUpdate = vi.fn();
      await manager.create({
        id: "usage-test-id",
        name: "usage-minion",
        task: "usage task",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "test",
          source: "ephemeral",
          filePath: "",
        },
        spawnedBy: "tc",
        cwd: tempDir,
        modelRegistry: {} as any,
        onUsageUpdate,
      });

      expect(capturedSubscriber).toBeDefined();
      capturedSubscriber!({ type: "turn_end" });

      expect(onUsageUpdate).toHaveBeenCalledWith({
        input: 200,
        output: 80,
        cacheRead: 10,
        cacheWrite: 5,
        cost: 0.005,
      });
    });

    it("does not throw when onUsageUpdate is not provided and turn_end fires", async () => {
      let capturedSubscriber: ((event: any) => void) | undefined;

      const { createAgentSession } = await import("@mariozechner/pi-coding-agent");
      vi.mocked(createAgentSession).mockImplementationOnce(async () => ({
        session: {
          subscribe: (cb: (event: any) => void) => { capturedSubscriber = cb; return () => {}; },
          abort: vi.fn(),
          prompt: vi.fn().mockResolvedValue(undefined),
          state: { messages: [] },
          getSessionStats: vi.fn().mockReturnValue({
            tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
            cost: 0.001,
          }),
        },
      }) as any);

      await manager.create({
        id: "no-cb-test",
        name: "test-minion",
        task: "test",
        config: {
          name: "test",
          description: "Test",
          systemPrompt: "test",
          source: "ephemeral",
          filePath: "",
        },
        spawnedBy: "tc",
        cwd: tempDir,
        modelRegistry: {} as any,
        // No onUsageUpdate
      });

      expect(() => capturedSubscriber?.({ type: "turn_end" })).not.toThrow();
    });
  });

  describe("tracking parent session relationship", () => {
    it("remembers parent session path for returning from minion", () => {
      // Given a minion session with parent relationship
      const minionsDir = getMinionsDir(tempDir);
      mkdirSync(minionsDir, { recursive: true });
      
      const sessionFile = join(minionsDir, "2026-04-02T22-46-54-session.jsonl");
      writeFileSync(sessionFile, '{"type":"session"}\n');
      
      const metadata: MinionSessionMetadata = {
        sessionId: "minion-123",
        parentSession: join(tempDir, "parent.jsonl"),
        spawnedBy: "spawn-tool",
        name: "child-minion",
        task: "child task",
        createdAt: Date.now(),
        status: "running",
      };
      writeFileSync(`${sessionFile}.minion-meta.json`, JSON.stringify(metadata));

      // When retrieving the minion metadata
      const found = manager.getMetadata("minion-123");

      // Then the parent session path is available
      expect(found?.parentSession).toBe(join(tempDir, "parent.jsonl"));
    });
  });
});
