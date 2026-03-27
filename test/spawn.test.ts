import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseJsonEvent,
  extractFinalOutput,
  extractUsage,
  buildSpawnArgs,
  getCurrentDepth,
  isAtMaxDepth,
} from "../src/spawn.js";
import type { AgentConfig } from "../src/types.js";

const EVENTS_DIR = join(import.meta.dirname, "fixtures", "events");

function loadEvents(filename: string) {
  return readFileSync(join(EVENTS_DIR, filename), "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => parseJsonEvent(line))
    .filter((e) => e !== null);
}

const baseAgent: AgentConfig = {
  name: "test-agent",
  description: "Test",
  systemPrompt: "You are a test agent.",
  source: "user",
  filePath: "/tmp/test.md",
};

describe("parseJsonEvent", () => {
  it("returns null for empty line", () => {
    expect(parseJsonEvent("")).toBeNull();
    expect(parseJsonEvent("   ")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseJsonEvent("{bad json")).toBeNull();
  });

  it("parses message_end event", () => {
    const line = readFileSync(join(EVENTS_DIR, "simple.jsonl"), "utf-8")
      .split("\n")
      .find((l) => l.includes('"message_end"'))!;
    const event = parseJsonEvent(line);
    expect(event?.type).toBe("message_end");
  });

  it("parses tool_start event from tool_execution_start", () => {
    const line = readFileSync(join(EVENTS_DIR, "with-tools.jsonl"), "utf-8")
      .split("\n")
      .find((l) => l.includes('"tool_execution_start"'))!;
    const event = parseJsonEvent(line);
    expect(event?.type).toBe("tool_start");
    if (event?.type === "tool_start") {
      expect(event.toolName).toBe("bash");
      expect(event.toolCallId).toBe("tc-1");
    }
  });

  it("parses tool_end event from tool_execution_end", () => {
    const line = readFileSync(join(EVENTS_DIR, "with-tools.jsonl"), "utf-8")
      .split("\n")
      .find((l) => l.includes('"tool_execution_end"'))!;
    const event = parseJsonEvent(line);
    expect(event?.type).toBe("tool_end");
    if (event?.type === "tool_end") {
      expect(event.isError).toBe(false);
    }
  });

  it("returns null for non-interesting event types (session, turn_start, etc.)", () => {
    expect(parseJsonEvent('{"type":"turn_start"}')).toBeNull();
    expect(parseJsonEvent('{"type":"session","version":3}')).toBeNull();
    expect(parseJsonEvent('{"type":"agent_start"}')).toBeNull();
  });
});

describe("extractFinalOutput", () => {
  it("returns text from last assistant message_end", () => {
    const events = loadEvents("simple.jsonl");
    expect(extractFinalOutput(events)).toBe("Hello from minion");
  });

  it("returns text from with-tools fixture", () => {
    const events = loadEvents("with-tools.jsonl");
    expect(extractFinalOutput(events)).toBe("Found 2 files");
  });

  it("returns empty string when no message_end events", () => {
    expect(extractFinalOutput([])).toBe("");
  });
});

describe("extractUsage", () => {
  it("accumulates usage from simple fixture", () => {
    const events = loadEvents("simple.jsonl");
    const usage = extractUsage(events);
    expect(usage.input).toBe(100);
    expect(usage.output).toBe(20);
    expect(usage.contextTokens).toBe(120);
    expect(usage.turns).toBe(1);
  });

  it("accumulates cacheRead and cacheWrite from with-tools fixture", () => {
    const events = loadEvents("with-tools.jsonl");
    const usage = extractUsage(events);
    expect(usage.cacheRead).toBe(50);
    expect(usage.cacheWrite).toBe(10);
  });

  it("returns zero usage for no events", () => {
    const usage = extractUsage([]);
    expect(usage.input).toBe(0);
    expect(usage.turns).toBe(0);
  });
});

describe("buildSpawnArgs", () => {
  it("includes task as last positional arg", () => {
    const { args } = buildSpawnArgs(baseAgent, "do the thing");
    expect(args[args.length - 1]).toBe("do the thing");
  });

  it("includes --mode json -p --no-session flags", () => {
    const { args } = buildSpawnArgs(baseAgent, "task");
    expect(args).toContain("--mode");
    expect(args).toContain("json");
    expect(args).toContain("-p");
    expect(args).toContain("--no-session");
  });

  it("includes --model when agent has model", () => {
    const agent = { ...baseAgent, model: "claude-haiku-4-5" };
    const { args } = buildSpawnArgs(agent, "task");
    const idx = args.indexOf("--model");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("claude-haiku-4-5");
  });

  it("appends :thinking suffix to model when thinking is set", () => {
    const agent = { ...baseAgent, model: "claude-haiku-4-5", thinking: "low" as const };
    const { args } = buildSpawnArgs(agent, "task");
    const idx = args.indexOf("--model");
    expect(args[idx + 1]).toBe("claude-haiku-4-5:low");
  });

  it("falls back to parentModel when agent has no model", () => {
    const { args } = buildSpawnArgs(baseAgent, "task", { parentModel: "anthropic/claude-haiku-4-5" });
    const idx = args.indexOf("--model");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("anthropic/claude-haiku-4-5");
  });

  it("overrideModel takes precedence over agent model and parentModel", () => {
    const agent = { ...baseAgent, model: "claude-haiku-4-5" };
    const { args } = buildSpawnArgs(agent, "task", {
      overrideModel: "claude-sonnet-4-5",
      parentModel: "anthropic/claude-haiku-4-5",
    });
    const idx = args.indexOf("--model");
    expect(args[idx + 1]).toBe("claude-sonnet-4-5");
  });

  it("does not apply :thinking when overrideModel is set", () => {
    const agent = { ...baseAgent, model: "claude-haiku-4-5", thinking: "high" as const };
    const { args } = buildSpawnArgs(agent, "task", { overrideModel: "claude-sonnet-4-5" });
    const idx = args.indexOf("--model");
    expect(args[idx + 1]).toBe("claude-sonnet-4-5"); // no :high suffix
  });

  it("includes --tools when agent has tools", () => {
    const agent = { ...baseAgent, tools: ["read", "bash"] };
    const { args } = buildSpawnArgs(agent, "task");
    const idx = args.indexOf("--tools");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("read,bash");
  });

  it("omits --tools when agent has no tools", () => {
    const { args } = buildSpawnArgs(baseAgent, "task");
    expect(args).not.toContain("--tools");
  });

  it("sets PI_MINIONS_DEPTH=currentDepth+1 in env", () => {
    const currentDepth = getCurrentDepth();
    const { env } = buildSpawnArgs(baseAgent, "task");
    expect(env["PI_MINIONS_DEPTH"]).toBe(String(currentDepth + 1));
  });
});

describe("getCurrentDepth / isAtMaxDepth", () => {
  beforeEach(() => {
    delete process.env["PI_MINIONS_DEPTH"];
  });
  afterEach(() => {
    delete process.env["PI_MINIONS_DEPTH"];
  });

  it("getCurrentDepth defaults to 0 when env var not set", () => {
    expect(getCurrentDepth()).toBe(0);
  });

  it("getCurrentDepth reads PI_MINIONS_DEPTH env var", () => {
    process.env["PI_MINIONS_DEPTH"] = "2";
    expect(getCurrentDepth()).toBe(2);
  });

  it("isAtMaxDepth returns false when below limit", () => {
    process.env["PI_MINIONS_DEPTH"] = "1";
    expect(isAtMaxDepth(3)).toBe(false);
  });

  it("isAtMaxDepth returns true when at limit", () => {
    process.env["PI_MINIONS_DEPTH"] = "3";
    expect(isAtMaxDepth(3)).toBe(true);
  });

  it("isAtMaxDepth returns true when above limit", () => {
    process.env["PI_MINIONS_DEPTH"] = "5";
    expect(isAtMaxDepth(3)).toBe(true);
  });
});
