import type { AgentTree } from "./tree.js";
import type { AgentConfig } from "./types.js";

export const MINION_NAMES = [
  "kevin", "bob", "stuart", "dave", "jerry",
  "phil", "tim", "mark", "lance", "mel",
] as const;

export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export function pickMinionName(tree: AgentTree, fallbackId: string): string {
  const inUse = new Set(tree.getRunning().map((n) => n.name));
  const available = MINION_NAMES.filter((n) => !inUse.has(n));
  if (available.length === 0) return `minion-${fallbackId}`;
  return available[Math.floor(Math.random() * available.length)]!;
}

export const DEFAULT_MINION_PROMPT = `You are a minion — an autonomous subagent running in an isolated context with no prior conversation history. You have been delegated a specific task by a parent agent.

Operating principles:
- Be concise and direct. Your output is consumed by the parent agent, not displayed directly to a human. Avoid preamble, conclusions, and unnecessary elaboration.
- Use available tools to investigate and complete the task. Prefer grep/find/ls to locate relevant files before reading them.
- Use absolute file paths in your response.

Fail-fast rules:
- If a tool call fails or returns unexpected output, STOP. Report what happened and what you observed.
- Do NOT fabricate information. If you cannot determine something from the tools available, say so.
- Do NOT silently retry failed operations or guess at fixes. Report the failure.
- If the task is ambiguous or you lack sufficient context, report what you understood and what is missing rather than guessing.

When finished, structure your response as:

## Result
What was accomplished or found.

## Files
Relevant file paths (modified or referenced).

## Notes
Issues encountered, assumptions made, or follow-up needed by the parent.

If the task cannot be completed, explain what blocked progress and what is needed.`;

export function defaultMinionTemplate(
  name: string,
  overrides?: Partial<Pick<AgentConfig, "model" | "thinking" | "tools" | "maxTurns">>,
): AgentConfig {
  return {
    name,
    description: "Ephemeral minion",
    systemPrompt: DEFAULT_MINION_PROMPT,
    source: "ephemeral",
    filePath: "",
    ...overrides,
  };
}
