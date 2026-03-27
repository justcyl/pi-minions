export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type AgentSource = "user" | "project" | "ephemeral";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  systemPrompt: string;
  source: AgentSource;
  filePath: string;
}

export type AgentStatus = "pending" | "running" | "completed" | "failed" | "aborted";

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export function emptyUsage(): UsageStats {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

// Only the subset of pi JSON events we care about
export type ParsedEvent =
  | { type: "message_end"; role: "assistant"; text: string; usage: Partial<UsageStats> }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_end"; toolCallId: string; toolName: string; isError: boolean };

export interface SpawnResult {
  exitCode: number;
  finalOutput: string;
  usage: UsageStats;
  error?: string;
  stderr?: string;
}

export interface AgentNode {
  id: string;
  name: string;
  task: string;
  status: AgentStatus;
  parentId?: string;
  children: string[];
  usage: UsageStats;
  startTime: number;
  endTime?: number;
  exitCode?: number;
  error?: string;
}
