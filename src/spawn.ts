import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentConfig, ParsedEvent, SpawnResult, UsageStats } from "./types.js";
import { emptyUsage } from "./types.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// JSON event parsing
// ---------------------------------------------------------------------------

export function parseJsonEvent(line: string): ParsedEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const type = raw["type"];

  if (type === "message_end") {
    const message = raw["message"] as Record<string, unknown> | undefined;
    if (!message || message["role"] !== "assistant") return null;

    const content = message["content"] as Array<Record<string, unknown>> | undefined;
    const text =
      content
        ?.filter((b) => b["type"] === "text")
        .map((b) => b["text"] as string)
        .join("") ?? "";

    const rawUsage = message["usage"] as Record<string, unknown> | undefined;
    const usage: Partial<UsageStats> = rawUsage
      ? {
          input: (rawUsage["input"] as number) ?? 0,
          output: (rawUsage["output"] as number) ?? 0,
          cacheRead: (rawUsage["cacheRead"] as number) ?? 0,
          cacheWrite: (rawUsage["cacheWrite"] as number) ?? 0,
          contextTokens: (rawUsage["totalTokens"] as number) ?? 0,
          cost: ((rawUsage["cost"] as Record<string, number> | undefined)?.["total"]) ?? 0,
        }
      : {};

    return { type: "message_end", role: "assistant", text, usage };
  }

  if (type === "tool_execution_start") {
    return {
      type: "tool_start",
      toolCallId: raw["toolCallId"] as string,
      toolName: raw["toolName"] as string,
      args: (raw["args"] as Record<string, unknown>) ?? {},
    };
  }

  if (type === "tool_execution_end") {
    return {
      type: "tool_end",
      toolCallId: raw["toolCallId"] as string,
      toolName: raw["toolName"] as string,
      isError: Boolean(raw["isError"]),
    };
  }

  return null;
}

export function extractFinalOutput(events: ParsedEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "message_end") return e.text;
  }
  return "";
}

export function extractUsage(events: ParsedEvent[]): UsageStats {
  const acc = emptyUsage();
  for (const e of events) {
    if (e.type === "message_end") {
      acc.input += e.usage.input ?? 0;
      acc.output += e.usage.output ?? 0;
      acc.cacheRead += e.usage.cacheRead ?? 0;
      acc.cacheWrite += e.usage.cacheWrite ?? 0;
      acc.cost += e.usage.cost ?? 0;
      acc.contextTokens = e.usage.contextTokens ?? acc.contextTokens;
      acc.turns += 1;
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Depth tracking
// ---------------------------------------------------------------------------

export function getCurrentDepth(): number {
  const val = process.env["PI_MINIONS_DEPTH"];
  return val ? parseInt(val, 10) || 0 : 0;
}

export function isAtMaxDepth(maxDepth: number): boolean {
  return getCurrentDepth() >= maxDepth;
}

// ---------------------------------------------------------------------------
// Subprocess args
// ---------------------------------------------------------------------------

export function buildSpawnArgs(
  config: AgentConfig,
  task: string,
  opts: { overrideModel?: string; parentModel?: string } = {},
): { args: string[]; env: NodeJS.ProcessEnv } {
  const args: string[] = ["--mode", "json", "-p", "--no-session"];

  // Resolution order: explicit user override > agent frontmatter model > parent session model
  const baseModel = opts.overrideModel ?? config.model ?? opts.parentModel;
  if (baseModel) {
    // Apply thinking suffix when no explicit user override -- preserve agent/parent thinking
    const modelArg =
      config.thinking && !opts.overrideModel
        ? `${baseModel}:${config.thinking}`
        : baseModel;
    args.push("--model", modelArg);
  }

  if (config.tools && config.tools.length > 0) {
    args.push("--tools", config.tools.join(","));
  }

  args.push(task);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PI_MINIONS_DEPTH: String(getCurrentDepth() + 1),
  };

  return { args, env };
}

// ---------------------------------------------------------------------------
// Subprocess spawning
// ---------------------------------------------------------------------------

function writeTempSystemPrompt(systemPrompt: string): string {
  const dir = join(tmpdir(), "pi-minions");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(file, systemPrompt, { encoding: "utf-8", mode: 0o600 });
  return file;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  // When pi is the current process executable, re-use it
  const script = process.argv[1];
  if (script && existsSync(script)) {
    return { command: process.execPath, args: [script, ...args] };
  }
  return { command: "pi", args };
}

export async function spawnAgent(
  config: AgentConfig,
  task: string,
  opts: {
    signal?: AbortSignal;
    overrideModel?: string;
    parentModel?: string;
    onEvent?: (e: ParsedEvent) => void;
    onProcess?: (proc: import("node:child_process").ChildProcess) => void;
  } = {},
): Promise<SpawnResult> {
  const { args, env } = buildSpawnArgs(config, task, {
    overrideModel: opts.overrideModel,
    parentModel: opts.parentModel,
  });

  let promptFile: string | null = null;
  if (config.systemPrompt) {
    promptFile = writeTempSystemPrompt(config.systemPrompt);
    // Insert --append-system-prompt before the task (last arg)
    const task = args.pop()!;
    args.push("--append-system-prompt", promptFile);
    args.push(task);
  }

  const events: ParsedEvent[] = [];
  let stderr = "";

  const exitCode = await new Promise<number>((resolve) => {
    const { command, args: finalArgs } = getPiInvocation(args);
    logger.debug("spawn", "subprocess", { command, args: finalArgs, depth: env["PI_MINIONS_DEPTH"] });
    const proc = spawn(command, finalArgs, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    opts.onProcess?.(proc);

    let buffer = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseJsonEvent(line);
        if (event) {
          if (event.type === "message_end") {
            // Log text preview AND content block structure so we can see empty-content issues
            const rawMsg = (() => { try { return JSON.parse(line); } catch { return null; } })();
            const blocks = (rawMsg?.message?.content ?? []) as Array<{type: string}>;
            const blockTypes = blocks.map((b) => b.type);
            const stopReason = rawMsg?.message?.stopReason;
            logger.debug("spawn:event", "message_end", {
              text: event.text ? event.text.slice(0, 120) : "(empty)",
              blockTypes,
              stopReason,
            });
          } else if (event.type === "tool_start") {
            logger.debug("spawn:event", "tool_start", { toolName: event.toolName, args: event.args });
          } else {
            logger.debug("spawn:event", event.type);
          }
          events.push(event);
          opts.onEvent?.(event);
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      // Log stderr live so we catch it even if process crashes before close
      logger.debug("spawn", "stderr", text.trim().slice(0, 300));
    });

    proc.on("close", (code) => {
      logger.debug("spawn", "exit", { code, totalEvents: events.length, hasOutput: events.some(e => e.type === "message_end" && e.text.length > 0) });
      resolve(code ?? 1);
    });
    proc.on("error", () => resolve(1));

    if (opts.signal) {
      const kill = () => {
        proc.kill("SIGTERM");
        setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
      };
      if (opts.signal.aborted) kill();
      else opts.signal.addEventListener("abort", kill, { once: true });
    }
  });

  if (promptFile) {
    try { unlinkSync(promptFile); } catch { /* ignore */ }
  }

  return {
    exitCode,
    finalOutput: extractFinalOutput(events),
    usage: extractUsage(events),
    error: exitCode !== 0 ? `Process exited with code ${exitCode}` : undefined,
    stderr: stderr || undefined,
  };
}
