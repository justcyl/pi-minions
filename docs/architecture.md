# Architecture

## Overview

pi-minions is a pi extension that adds autonomous subagent spawning. The parent agent delegates tasks to minions that run in isolated in-process sessions with their own tools and system prompt.

```
Parent pi session
  └─ spawn tool (LLM-initiated) or /spawn command (user-initiated)
       └─ createAgentSession() — in-process, isolated context
            └─ session.prompt(task) — runs full agent loop
                 └─ built-in tools: read, bash, edit, write, grep, find, ls
```

## Key Components

### `src/spawn.ts` — Session runner

`runMinionSession(config, task, opts)` — creates and runs an in-process agent session.

- Uses pi SDK: `createAgentSession`, `DefaultResourceLoader`, `SessionManager.inMemory()`
- `noExtensions: true` — minions get built-in tools only (no spawn/halt/MCP). Prevents infinite nesting.
- `systemPromptOverride` — injects minion system prompt without temp files
- Subscribes to `session.subscribe()` for streaming events (tool activity, text deltas, turn boundaries)
- Writes transcript to `tmp/logs/minions/<id>-<name>.log`
- Returns `SpawnResult { exitCode, finalOutput, usage }`

### `src/minions.ts` — Template factory

`defaultMinionTemplate(name, overrides?)` — creates ephemeral `AgentConfig` with `DEFAULT_MINION_PROMPT`.

The prompt establishes: isolation context, fail-fast rules (STOP on failure, no fabrication, no silent retry), structured output format (Result/Files/Notes).

### `src/tools/spawn.ts` — Spawn tool

`makeSpawnExecute(tree, handles)` — LLM-callable tool for task delegation.

- `agent` param is optional. Omitted = ephemeral minion via `defaultMinionTemplate`. Provided = discovered from `~/.pi/agent/agents/` or `.pi/agents/`.
- Tracks minions in `AgentTree` for status/usage
- Stores `AbortController` in `handles` map for `/halt` support
- Streams progress via `onUpdate` callback → `renderResult` with `isPartial`
- Sets `ctx.ui.setWorkingMessage()` for status bar updates during execution

### `src/tools/halt.ts` — Halt tool

`abortAgents(ids, tree, handles)` — calls `controller.abort()` which triggers `session.abort()`.

Halt resolves targets by ID or minion name via `tree.resolve()`. Aborted minions throw `[HALTED]` from the spawn tool so pi marks `isError: true` (red banner). The error message instructs the LLM not to retry.

### `src/tools/list-agents.ts` — Agent discovery tool

`makeListAgentsExecute()` — returns the built-in ephemeral minion + all discovered named agents. The LLM calls this to discover what agents are available before spawning by name.

### `src/commands/spawn.ts` — /spawn command

Thin wrapper: parses args → `pi.sendUserMessage(directive)` → LLM calls spawn tool.

The `sendUserMessage` approach is intentional — it runs the spawn as a proper foreground tool call in the parent session. The result lands in conversation context, `/halt` works, and messages queue normally.

### `src/render.ts` — TUI rendering

- `renderCall` — shows agent name (named) or task preview (ephemeral)
- `renderResult` — during streaming (`isPartial`): animated braille spinner + live activity (tool output, text deltas). On completion: ✓ green (success), ✗ red (error/abort) + usage stats.
- `isError` is read from `ctx.isError` (ToolRenderContext), not from the result object.

### `src/tree.ts` — Agent tree

Tracks minion hierarchy, status transitions, and usage aggregation. Supports nested spawning.

## Data Flow

```
/spawn <task>
  → parseSpawnArgs → { task, model? }
  → pi.sendUserMessage("Use the spawn tool to delegate...")
  → LLM calls spawn tool
  → makeSpawnExecute:
      → defaultMinionTemplate(name) or discoverAgents()
      → tree.add(id, name, task)
      → handles.set(id, AbortController)
      → runMinionSession(config, task, { modelRegistry, parentModel, cwd, callbacks })
          → DefaultResourceLoader(noExtensions, systemPromptOverride)
          → createAgentSession({ model, tools, sessionManager: inMemory })
          → session.subscribe(events → onToolActivity, onTextDelta, onTurnEnd)
          → session.prompt(task)
          → extractLastAssistantText → SpawnResult
      → tree.updateStatus, tree.updateUsage
      → return { content: finalOutput, details }
```

## Technical Decisions

### In-process sessions over child processes

Previous: `child_process.spawn("pi", ["--mode", "json", ...])` — parsed JSON stdout, temp files for system prompt, SIGTERM/SIGKILL for abort.

Current: `createAgentSession()` + `session.prompt()` from pi SDK. Advantages:
- No process startup overhead
- Streaming via `session.subscribe()` (typed events, not stdout parsing)
- Clean abort via `session.abort()` (not process signals)
- Access to `ctx.modelRegistry` (not CLI `--model` strings)
- System prompt via `systemPromptOverride` (not temp files)
- Future: `session.steer()` for mid-run interaction, resume via re-prompt

Trade-off: shared process memory (less isolation). Acceptable for coding agents.

### noExtensions: true for minions

Minions run with `noExtensions: true` on the `DefaultResourceLoader`. This means:
- No access to spawn/halt tools (prevents recursive spawning)
- No MCP servers or other extensions
- Only built-in tools via `createCodingTools(cwd)`

This replaces the previous `PI_MINIONS_DEPTH` env var approach. Simpler and more robust.

### sendUserMessage for /spawn

The `/spawn` command uses `pi.sendUserMessage()` to trigger the LLM, which then calls the spawn tool. This adds a small LLM inference delay but ensures:
- Result appears as a proper tool call in conversation
- `/halt` works (tool blocks the parent turn)
- Message queueing works (user can type during execution)

There is no `callTool()` API on `ExtensionAPI` to bypass the LLM. pi-subagents (tintinweb/pi-subagents) also uses this pattern.

### Abort throws (not returns)

When a minion is halted, the spawn tool throws `[HALTED] ... do NOT retry`. This ensures:
- pi sets `isError: true` → red banner/border in TUI
- The error message content tells the LLM not to retry
- A system prompt guideline reinforces: "When a spawn result says [HALTED], do NOT retry"

Returning normally (non-error) was tried first but pi rendered it as green/success, confusing users.

## Logging

- **Debug log**: `tmp/logs/debug.log` — enabled via `PI_MINIONS_DEBUG=1`. Extension lifecycle, spawn start/complete, errors.
- **Transcripts**: `tmp/logs/minions/<id>-<name>.log` — per-minion conversation log. Tool calls with args, tool output (deltas only), assistant messages, turn boundaries.
