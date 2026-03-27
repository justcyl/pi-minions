import { describe, it, expect } from "vitest";
import { generateId, pickMinionName, defaultMinionTemplate, DEFAULT_MINION_PROMPT } from "../src/minions.js";
import { AgentTree } from "../src/tree.js";

describe("defaultMinionTemplate", () => {
  it("returns AgentConfig with given name and ephemeral source", () => {
    const c = defaultMinionTemplate("kevin");
    expect(c.name).toBe("kevin");
    expect(c.source).toBe("ephemeral");
    expect(c.systemPrompt).toBe(DEFAULT_MINION_PROMPT);
    expect(c.filePath).toBe("");
  });

  it("system prompt establishes isolation context", () => {
    const c = defaultMinionTemplate("kevin");
    expect(c.systemPrompt).toContain("autonomous subagent");
    expect(c.systemPrompt).toContain("isolated context");
  });

  it("system prompt includes fail-fast rules", () => {
    const c = defaultMinionTemplate("kevin");
    expect(c.systemPrompt).toContain("STOP");
    expect(c.systemPrompt).toContain("Do NOT fabricate");
    expect(c.systemPrompt).toContain("Do NOT silently retry");
  });

  it("system prompt includes structured output format", () => {
    const c = defaultMinionTemplate("kevin");
    expect(c.systemPrompt).toContain("## Result");
    expect(c.systemPrompt).toContain("## Files");
    expect(c.systemPrompt).toContain("## Notes");
  });

  it("applies model override", () => {
    const c = defaultMinionTemplate("bob", { model: "claude-haiku-4-5" });
    expect(c.model).toBe("claude-haiku-4-5");
  });

  it("applies thinking override", () => {
    const c = defaultMinionTemplate("dave", { thinking: "low" });
    expect(c.thinking).toBe("low");
  });

  it("applies tools override", () => {
    const c = defaultMinionTemplate("stuart", { tools: ["read", "bash"] });
    expect(c.tools).toEqual(["read", "bash"]);
  });

  it("leaves optional fields undefined when no overrides", () => {
    const c = defaultMinionTemplate("jerry");
    expect(c.model).toBeUndefined();
    expect(c.thinking).toBeUndefined();
    expect(c.tools).toBeUndefined();
  });
});

describe("generateId", () => {
  it("returns 8-char hex string", () => {
    const id = generateId();
    expect(id).toHaveLength(8);
    expect(id).toMatch(/^[a-f0-9]+$/);
  });
});

describe("pickMinionName", () => {
  it("returns a name when available", () => {
    const tree = new AgentTree();
    expect(pickMinionName(tree, "x")).toBeTruthy();
  });
});
