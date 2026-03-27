import { describe, it, expect } from "vitest";
import { parseSpawnArgs } from "../../src/commands/spawn.js";

describe("parseSpawnArgs", () => {
  it("parses plain task with no flags", () => {
    const result = parseSpawnArgs("do the thing");
    expect(result).toEqual({ task: "do the thing", model: undefined });
  });

  it("extracts --model flag and leaves rest as task", () => {
    const result = parseSpawnArgs("do it --model claude-haiku-4-5");
    expect(result).toEqual({ task: "do it", model: "claude-haiku-4-5" });
  });

  it("handles --model at the start", () => {
    const result = parseSpawnArgs("--model sonnet do the thing");
    expect(result).toEqual({ task: "do the thing", model: "sonnet" });
  });

  it("handles --model in the middle", () => {
    const result = parseSpawnArgs("find all --model haiku files");
    expect(result).toEqual({ task: "find all files", model: "haiku" });
  });

  it("returns error for empty input", () => {
    const result = parseSpawnArgs("");
    expect(result).toHaveProperty("error");
  });

  it("returns error for whitespace-only input", () => {
    const result = parseSpawnArgs("   ");
    expect(result).toHaveProperty("error");
  });

  it("returns error when --model flag has no value", () => {
    const result = parseSpawnArgs("do thing --model");
    expect(result).toHaveProperty("error");
  });

  it("returns error when task is empty after stripping --model", () => {
    const result = parseSpawnArgs("--model haiku");
    expect(result).toHaveProperty("error");
  });
});
