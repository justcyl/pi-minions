import { describe, it, expect } from "vitest";

describe("Config Inheritance", () => {
  it("filters pi-minions from extension list", () => {
    const mockExtensions = [
      { path: "other", resolvedPath: "/path/to/other" },
      { path: "pi-minions", resolvedPath: "/node_modules/pi-minions" },
    ];
    const filtered = mockExtensions.filter(ext => !ext.resolvedPath.includes("pi-minions"));
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.path).toBe("other");
  });
});
