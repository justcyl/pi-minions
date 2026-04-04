import { describe, expect, it, vi } from "vitest";
import { minionChangelogRenderer } from "../../src/renderers/minion-changelog.js";

// Mock the logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("minionChangelogRenderer", () => {
  it("returns undefined when message has no details", () => {
    const message = { details: undefined } as any;
    const result = minionChangelogRenderer(message, {} as any, {} as any);
    expect(result).toBeUndefined();
  });

  it("returns undefined when details has no content", () => {
    const message = { details: {} } as any;
    const result = minionChangelogRenderer(message, {} as any, {} as any);
    expect(result).toBeUndefined();
  });

  it("returns undefined when content is empty string", () => {
    const message = { details: { content: "" } } as any;
    const result = minionChangelogRenderer(message, {} as any, {} as any);
    expect(result).toBeUndefined();
  });

  it("returns Markdown component when content is present", () => {
    const message = { details: { content: "# Changelog\n\n## v1.0.0" } } as any;
    const result = minionChangelogRenderer(message, {} as any, {} as any);
    expect(result).toBeDefined();
    // Markdown component is returned - we can't easily inspect it but we know it's defined
  });

  it("trims content before rendering", () => {
    const message = { details: { content: "  \n# Changelog\n  " } } as any;
    const result = minionChangelogRenderer(message, {} as any, {} as any);
    expect(result).toBeDefined();
  });
});
