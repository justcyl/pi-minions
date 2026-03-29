import { describe, it, expect, vi } from "vitest";
import { AgentTree } from "../../src/tree.js";
import { validateSteerTarget, executeSteering } from "../../src/tools/minions.js";
import type { MinionSession } from "../../src/spawn.js";

describe("validateSteerTarget", () => {
  it("returns error when minion not found", () => {
    const tree = new AgentTree();
    const sessions = new Map<string, MinionSession>();
    
    const result = validateSteerTarget(tree, sessions, "nonexistent");
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("not found");
      expect(result.errorType).toBe("error");
    }
  });

  it("returns error when minion not running", () => {
    const tree = new AgentTree();
    const sessions = new Map<string, MinionSession>();
    
    tree.add("a", "kevin", "task");
    tree.updateStatus("a", "completed", 0);
    
    const result = validateSteerTarget(tree, sessions, "kevin");
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("not running");
      expect(result.errorType).toBe("info");
    }
  });

  it("returns error when no active session", () => {
    const tree = new AgentTree();
    const sessions = new Map<string, MinionSession>();
    
    tree.add("a", "kevin", "task");
    // No session in sessions map
    
    const result = validateSteerTarget(tree, sessions, "kevin");
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("No active session");
      expect(result.errorType).toBe("error");
    }
  });

  it("returns success with node and session when valid", () => {
    const tree = new AgentTree();
    const sessions = new Map<string, MinionSession>();
    
    tree.add("a", "kevin", "task");
    const mockSession = { steer: vi.fn() } as any;
    sessions.set("a", mockSession);
    
    const result = validateSteerTarget(tree, sessions, "kevin");
    
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.node.name).toBe("kevin");
      expect(result.session).toBe(mockSession);
    }
  });

  it("resolves by ID", () => {
    const tree = new AgentTree();
    const sessions = new Map<string, MinionSession>();
    
    tree.add("abc123", "kevin", "task");
    const mockSession = { steer: vi.fn() } as any;
    sessions.set("abc123", mockSession);
    
    const result = validateSteerTarget(tree, sessions, "abc123");
    
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.node.id).toBe("abc123");
    }
  });
});

describe("executeSteering", () => {
  it("calls session.steer and returns success message", async () => {
    const mockSession = { steer: vi.fn().mockResolvedValue(undefined) } as any;
    const mockNode = { id: "a", name: "kevin" } as any;
    
    const result = await executeSteering(mockNode, mockSession, "restart task");
    
    expect(mockSession.steer).toHaveBeenCalledWith(expect.stringContaining("[USER STEER]"));
    expect(mockSession.steer).toHaveBeenCalledWith(expect.stringContaining("restart task"));
    expect(result).toContain("Steered kevin (a)");
    expect(result).toContain("restart task");
  });
});