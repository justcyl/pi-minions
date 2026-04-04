import { describe, expect, it, vi } from "vitest";

// Mock fs before importing the module
const mockReadFileSync = vi.fn();
vi.mock("node:fs", () => ({
  readFileSync: mockReadFileSync,
}));

// Mock logger
vi.mock("../src/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("version module", () => {
  it("exports VERSION from package.json", async () => {
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({ version: "1.2.3-test" }));

    // Re-import to trigger module initialization
    const { VERSION } = await import("../src/version.js");
    expect(VERSION).toBe("1.2.3-test");
  });

  it("exports CHANGELOG_PATH", async () => {
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({ version: "1.0.0" }));

    const { CHANGELOG_PATH } = await import("../src/version.js");
    expect(CHANGELOG_PATH).toContain("CHANGELOG.md");
  });
});
